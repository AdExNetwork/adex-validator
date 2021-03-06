#!/usr/bin/env node
const tape = require('tape-catch')
const fetch = require('node-fetch')
const { getAddress } = require('ethers').utils
const { Channel, MerkleTree } = require('adex-protocol-eth/js')
const { getStateRootHash } = require('../services/validatorWorker/lib')
const SentryInterface = require('../services/validatorWorker/lib/sentryInterface')
const {
	forceTick,
	wait,
	postEvents,
	genEvents,
	getDummySig,
	fetchPost,
	getValidEthChannel,
	randomAddress,
	fetchWithAuth
} = require('./lib')
const cfg = require('../cfg')
const dummyVals = require('./prep-db/mongo')
const constants = require('../services/constants')

const postEvsAsCreator = (url, id, ev, headers = {}) =>
	postEvents(url, id, ev, dummyVals.auth.creator, headers)

const leaderUrl = dummyVals.channel.spec.validators[0].url
const followerUrl = dummyVals.channel.spec.validators[1].url
const defaultPubName = getAddress(dummyVals.ids.publisher)

let dummyAdapter = require('../adapters/dummy')
const { channelExhausted } = require('../services/sentry/lib')

dummyAdapter = new dummyAdapter.Adapter({ dummyIdentity: dummyVals.ids.leader }, cfg)
dummyAdapter.init()
const iface = new SentryInterface(dummyAdapter, dummyVals.channel, { logging: false })

function aggrAndTick() {
	// If we need to run the production config with AGGR_THROTTLE, then we need to wait for cfg.AGGR_THROTTLE + 500
	// the reason is that in production we have a throttle for saving event aggregates
	if (process.env.NODE_ENV === 'production') {
		return wait(cfg.AGGR_THROTTLE + cfg.WAIT_TIME).then(forceTick)
	}
	return forceTick()
}

tape('submit events and ensure they are accounted for', async function(t) {
	// the CLICK is not paid for by default
	// the IMPRESSION, however, pays 1 by default
	// We use .toLowerCase() to also test if the balance tree contains properly checksummed addrs
	const evs = genEvents(200, defaultPubName.toLowerCase())
		.concat(genEvents(1, defaultPubName))
		.concat(genEvents(2, randomAddress()))
		.concat(genEvents(1, randomAddress(), 'CLICK'))

	const expectedBal = '201'
	const expectedBalAfterFees = Math.floor(201 * 0.8).toString(10)

	const channel = dummyVals.channel
	await Promise.all(
		[leaderUrl, followerUrl].map(url =>
			postEvsAsCreator(url, channel.id, evs).then(({ status }) => {
				if (status !== 200) throw new Error(`postEvsAsCreator failed with ${status}`)
			})
		)
	)
	await aggrAndTick()
	const resp = await iface.getOurLatestMsg('Accounting')

	t.ok(resp && resp.balances, 'there is a balances tree')
	const balancesTreePreFees = resp.balancesBeforeFees
	const balancesTree = resp.balances
	t.equal(balancesTreePreFees[defaultPubName], expectedBal, 'balances is right')
	// We will check the leader, cause this means this happened:
	// the NewState was generated, sent to the follower,
	// who generated ApproveState and sent back to the leader
	await aggrAndTick()

	const { lastApproved, heartbeats } = await iface.getLastMsgs()

	t.ok(lastApproved, 'has lastApproved')
	// ensure NewState is in order
	const lastNew = lastApproved.newState
	t.ok(lastNew, 'has NewState')
	t.equal(lastNew.from, dummyVals.ids.leader, 'NewState: is by the leader')
	t.ok(
		typeof lastNew.msg.stateRoot === 'string' && lastNew.msg.stateRoot.length === 64,
		'NewState: stateRoot is sane'
	)
	t.equal(
		lastNew.msg.signature,
		getDummySig(lastNew.msg.stateRoot, lastNew.from),
		'NewState: signature is sane'
	)
	t.equal(
		lastNew.msg.balances[defaultPubName],
		expectedBalAfterFees,
		'NewState: balance is as expected, after fees'
	)
	// Math.floor(204 / channel.depositAmount * channel.spec.validators[0].fee) = Math.floor(204/1000*100)
	t.equal(
		lastNew.msg.balances[channel.spec.validators[0].id],
		'20',
		'NewState: the fee is proportionally assigned to the validator'
	)
	t.deepEqual(
		lastNew.msg.balances,
		balancesTree,
		'NewState: balances is the same as the one in Accounting'
	)
	t.equal(heartbeats.length, 2, 'has correct number of heartbeat messages')
	// there should be one heartbeat from leader & follower
	t.ok(
		heartbeats[0].msg.signature.includes(channel.spec.validators[0].id),
		'should retrieve heartbeat from leader'
	)
	t.ok(
		heartbeats[1].msg.signature.includes(channel.spec.validators[1].id),
		'should retrieve heartbeat from follower'
	)

	// Ensure ApproveState is in order
	const lastApprove = lastApproved.approveState
	t.ok(lastApprove, 'has ApproveState')
	t.equal(lastApprove.from, dummyVals.ids.follower, 'ApproveState: is by the follower')
	t.ok(
		typeof lastApprove.msg.stateRoot === 'string' && lastApprove.msg.stateRoot.length === 64,
		'ApproveState: stateRoot is sane'
	)
	t.equal(
		lastApprove.msg.signature,
		getDummySig(lastApprove.msg.stateRoot, lastApprove.from),
		'ApproveState: signature is sane'
	)
	t.equal(
		lastNew.msg.stateRoot,
		lastApprove.msg.stateRoot,
		'stateRoot is the same between latest NewState and ApproveState'
	)
	t.equal(lastApprove.msg.isHealthy, true, 'ApproveState: health value is true')

	// Check inclusion proofs of the balance
	// stateRoot = keccak256(channelId, balanceRoot)
	const allLeafs = Object.keys(balancesTree).map(k => Channel.getBalanceLeaf(k, balancesTree[k]))
	const mTree = new MerkleTree(allLeafs)
	const stateRootRaw = Channel.getSignableStateRoot(channel.id, mTree.getRoot()).toString('hex')
	const { stateRoot } = lastNew.msg
	t.equals(stateRootRaw, stateRoot, 'stateRoot matches merkle tree root')

	// this is a bit out of scope, looks like a test of the MerkleTree lib,
	// but better be safe than sorry
	const leaf = Channel.getBalanceLeaf(defaultPubName, expectedBalAfterFees)
	const proof = mTree.proof(leaf)
	t.ok(mTree.verify(proof, leaf), 'balance leaf is in stateRoot')
	t.end()
})

tape('new states are not produced when there are no new aggregates', async function(t) {
	const url = `${leaderUrl}/channel/${dummyVals.channel.id}/validator-messages`
	const { validatorMessages } = await fetch(url).then(res => res.json())
	t.ok(Array.isArray(validatorMessages), 'has validatorMessages')
	// Force it two times, which should technically produce two new aggregates,
	// 50ms apart (by their created timestamp)
	await forceTick()
	await wait(50)
	await forceTick()
	const newResp = await fetch(url).then(res => res.json())
	t.deepEqual(validatorMessages, newResp.validatorMessages, 'validatorMessages should be the same')
	t.end()
})

tape('heartbeat has been emitted', async function(t) {
	// This also checks if the propagation works, cause it tries to get the followers
	// message through the leader Sentry
	await forceTick()
	const results = await Promise.all([
		iface.getLatestMsg(dummyVals.ids.leader, 'Heartbeat'),
		iface.getLatestMsg(dummyVals.ids.follower, 'Heartbeat')
	])
	results.forEach((hb, idx) => {
		if (!hb) throw new Error(`should propagate heartbeat notification for ${idx}`)
		t.ok(hb.signature, 'heartbeat has signature')
		t.ok(hb.timestamp, 'heartbeat has timestamp')
		t.ok(hb.stateRoot, 'heartbeat has stateRoot')
		// @TODO should we test the validity of the signature?
	})

	t.end()
})

async function testRejectState(t, expectedReason, makeNewState) {
	const lastApproved = await iface.getLastApproved('NewState')
	const maliciousNewState = makeNewState(lastApproved.newState.msg)
	await iface.propagate([maliciousNewState])
	await forceTick()
	const [approve, reject] = await Promise.all([
		iface.getLatestMsg(dummyVals.ids.follower, 'ApproveState'),
		iface.getLatestMsg(dummyVals.ids.follower, 'RejectState')
	])
	if (approve)
		t.notEqual(
			approve.stateRoot,
			maliciousNewState.stateRoot,
			'we have not approved the malicious NewState'
		)

	t.ok(reject, 'has a RejectState')
	if (reject) {
		t.equal(
			reject.stateRoot,
			maliciousNewState.stateRoot,
			'we have rejected the malicious NewState'
		)
		t.equal(reject.reason, expectedReason, `reason for rejection is ${expectedReason}`)
	}
}

tape('RejectState: wrong signature (InvalidSignature)', async function(t) {
	await testRejectState(t, 'InvalidSignature', function(newState) {
		// increase the balance, so we effectively end up with a new state
		const balances = { ...newState.balances, [randomAddress()]: '1' }
		const stateRoot = getStateRootHash(dummyAdapter, dummyVals.channel, balances).toString('hex')
		return {
			...newState,
			balances,
			stateRoot,
			signature: getDummySig(stateRoot, 'awesomeLeader12')
		}
	})
	t.end()
})

tape('RejectState: deceptive stateRoot (InvalidRootHash)', async function(t) {
	await testRejectState(t, 'InvalidRootHash', function(newState) {
		// This attack is: we give the follower a valid `balances`,
		// but a `stateRoot` that represents a totally different tree; with a valid signature
		const fakeBalances = { [randomAddress()]: '33333' }
		const deceptiveStateRoot = getStateRootHash(
			dummyAdapter,
			dummyVals.channel,
			fakeBalances
		).toString('hex')
		return {
			...newState,
			stateRoot: deceptiveStateRoot,
			signature: getDummySig(deceptiveStateRoot, dummyVals.ids.leader)
		}
	})
	t.end()
})

tape('RejectState: invalid OUTPACE transition', async function(t) {
	await testRejectState(t, 'InvalidTransition', function(newState) {
		// Send a fully valid message, but violating the OUTPACE rules by reducing someone's balance
		const balances = { ...newState.balances, [defaultPubName]: '0' }
		const stateRoot = getStateRootHash(dummyAdapter, dummyVals.channel, balances).toString('hex')
		return {
			...newState,
			balances,
			stateRoot,
			signature: getDummySig(stateRoot, dummyVals.ids.leader)
		}
	})
	t.end()
})

tape('RejectState: invalid OUTPACE transition: exceed deposit', async function(t) {
	await testRejectState(t, 'InvalidTransition', function(newState) {
		// Send a fully valid message, but violating the OUTPACe rules by reducing someone's balance
		const balances = {
			...newState.balances,
			[defaultPubName]: (parseInt(dummyVals.channel.depositAmount, 10) + 1).toString()
		}
		const stateRoot = getStateRootHash(dummyAdapter, dummyVals.channel, balances).toString('hex')
		return {
			...newState,
			balances,
			stateRoot,
			signature: getDummySig(stateRoot, dummyVals.ids.leader)
		}
	})
	t.end()
})

tape('cannot exceed channel deposit', async function(t) {
	const channel = getValidEthChannel()
	const channelIface = new SentryInterface(dummyAdapter, channel, { logging: false })

	// Submit a new channel; we submit it to both sentries to avoid 404 when propagating messages
	await Promise.all([
		fetchPost(`${leaderUrl}/channel`, dummyVals.auth.leader, channel),
		fetchPost(`${followerUrl}/channel`, dummyVals.auth.follower, channel)
	])

	// 1 event pays 1 token for now; we can change that via spec.minPerImpression
	const expectDeposit = parseInt(channel.depositAmount, 10)
	const evCount = expectDeposit + 1
	await postEvsAsCreator(leaderUrl, channel.id, genEvents(evCount))
	await aggrAndTick()
	await forceTick()

	const { balances } = await channelIface.getOurLatestMsg('Accounting')
	const sum = Object.keys(balances)
		.map(k => parseInt(balances[k], 10))
		.reduce((a, b) => a + b, 0)
	t.equal(sum, expectDeposit, 'balance does not exceed the deposit, but equals it')
	t.end()
})

tape('health works correctly', async function(t) {
	const channel = getValidEthChannel()
	const channelIface = new SentryInterface(dummyAdapter, channel, { logging: false })

	// Submit a new channel; we submit it to both sentries to avoid 404 when propagating messages
	await Promise.all([
		fetchPost(`${leaderUrl}/channel`, dummyVals.auth.leader, channel),
		fetchPost(`${followerUrl}/channel`, dummyVals.auth.follower, channel)
	])
	const toFollower = 60
	const toLeader = 1
	const diff = toFollower - toLeader

	await Promise.all(
		[leaderUrl, followerUrl].map(url =>
			postEvsAsCreator(url, channel.id, genEvents(url === followerUrl ? toFollower : toLeader))
		)
	)

	// wait for the events to be aggregated and new states to be issued
	await aggrAndTick()
	await forceTick()

	const lastApprove = await channelIface.getLatestMsg(dummyVals.ids.follower, 'ApproveState')
	// @TODO: Should we assert balances numbers?
	// @TODO assert number of messages; this will be easy once we create a separate channel for each test
	t.equal(lastApprove.isHealthy, false, 'channel is registered as unhealthy')

	// send events to the leader so it catches up
	await postEvsAsCreator(leaderUrl, channel.id, genEvents(diff))
	await aggrAndTick()
	await forceTick()

	// check if healthy
	const lastApproveHealthy = await channelIface.getLatestMsg(dummyVals.ids.follower, 'ApproveState')
	t.equal(lastApproveHealthy.isHealthy, true, 'channel is registered as healthy')
	t.end()
})

tape('health works correctly: should reject state if health is too different', async function(t) {
	const channel = getValidEthChannel()
	const channelIface = new SentryInterface(dummyAdapter, channel, { logging: false })

	// Submit a new channel; we submit it to both sentries to avoid 404 when propagating messages
	await Promise.all([
		fetchPost(`${leaderUrl}/channel`, dummyVals.auth.leader, channel),
		fetchPost(`${followerUrl}/channel`, dummyVals.auth.follower, channel)
	])
	const toFollower = 300
	const toLeader = 3
	const diff = toFollower - toLeader

	await Promise.all(
		[leaderUrl, followerUrl].map(url =>
			postEvsAsCreator(url, channel.id, genEvents(url === followerUrl ? toFollower : toLeader))
		)
	)

	// wait for the events to be aggregated and new states to be issued
	await aggrAndTick()
	await forceTick()

	const [firstNewState, approve, reject] = await Promise.all([
		channelIface.getLatestMsg(dummyVals.ids.leader, 'NewState'),
		channelIface.getLatestMsg(dummyVals.ids.follower, 'ApproveState'),
		channelIface.getLatestMsg(dummyVals.ids.follower, 'RejectState')
	])
	if (approve)
		t.notEqual(
			firstNewState.stateRoot,
			approve.stateRoot,
			'we are not approving the malicious NewState'
		)
	t.ok(reject, 'has a RejectState')
	if (reject) {
		t.equal(reject.stateRoot, firstNewState.stateRoot, 'we have rejected the malicious NewState')
		t.equal(reject.reason, 'TooLowHealth', `reason for rejection is TooLowHealth`)
	}

	// send events to the leader so it catches up
	await postEvsAsCreator(leaderUrl, channel.id, genEvents(diff))
	await aggrAndTick()
	await forceTick()

	// check if healthy
	const lastApproveHealthy = await channelIface.getLatestMsg(dummyVals.ids.follower, 'ApproveState')
	t.notEqual(
		lastApproveHealthy.stateRoot,
		firstNewState.stateRoot,
		'we are not approving the malicious NewState'
	)
	t.equal(lastApproveHealthy.isHealthy, true, 'channel is registered as healthy')
	t.end()
})

tape('should close channel', async function(t) {
	const channel = getValidEthChannel()
	const channelIface = new SentryInterface(dummyAdapter, channel, { logging: false })

	// Submit a new channel; we submit it to both sentries to avoid 404 when propagating messages
	await Promise.all([
		fetchPost(`${leaderUrl}/channel`, dummyVals.auth.leader, channel),
		fetchPost(`${followerUrl}/channel`, dummyVals.auth.follower, channel)
	])

	// 1 event pays 1 token for now; we can change that via spec.minPerImpression
	const expectDeposit = parseInt(channel.depositAmount, 10)
	await postEvsAsCreator(leaderUrl, channel.id, genEvents(10))

	// close channel event
	// Do not use genEvents  as it 	adds default publisher to the event
	// which will result to event with publisher and no payout
	// That will return return { success: false, statusCode: 469, message: 'no event payout' }
	const closeCall = await fetchPost(
		`${leaderUrl}/channel/${channel.id}/events`,
		dummyVals.auth.creator,
		{
			events: [{ type: constants.eventTypes.close }]
		}
	)

	const invalidCloseCall = await fetchPost(
		`${leaderUrl}/channel/${channel.id}/events`,
		dummyVals.auth.creator,
		{
			events: genEvents(1, null, constants.eventTypes.close)
		}
	)

	// 2 ticks to get last approved state
	await aggrAndTick()
	await aggrAndTick()

	// check the creator is awarded the remaining token balance
	const lastApproved = await channelIface.getLastApproved()
	const { balances } = lastApproved.newState.msg
	t.equal(closeCall.status, 200, 'close call should return 200')
	t.equal(invalidCloseCall.status, 469, 'invalid close call should return 469')
	t.equal(
		balances[getAddress(dummyVals.auth.creator)],
		'792',
		'creator balance should be remaining channel deposit minus fees'
	)
	t.equal(
		balances[channel.spec.validators[0].id],
		channel.spec.validators[0].fee,
		'validator 0 fee is OK'
	)
	t.equal(
		balances[channel.spec.validators[1].id],
		channel.spec.validators[1].fee,
		'validator 1 fee is OK'
	)

	const sum = Object.keys(balances)
		.map(k => parseInt(balances[k], 10))
		.reduce((a, b) => a + b, 0)
	t.equal(sum, expectDeposit, 'balance does not exceed the deposit, but equals it')
	t.end()
})

tape('should record clicks', async function(t) {
	const channel = getValidEthChannel()
	const num = 66
	const evs = genEvents(num, randomAddress(), 'CLICK')

	// Submit a new channel; we submit it to both sentries to avoid 404 when propagating messages
	await Promise.all([
		fetchPost(`${leaderUrl}/channel`, dummyVals.auth.leader, channel),
		fetchPost(`${followerUrl}/channel`, dummyVals.auth.follower, channel)
	])

	await postEvsAsCreator(leaderUrl, channel.id, evs)
	// Technically we don't need to tick, since the events should be reflected immediately
	const analytics = await fetchWithAuth(
		`${leaderUrl}/analytics/${channel.id}?eventType=CLICK`,
		dummyVals.auth.creator,
		{}
	).then(r => r.json())
	t.equal(analytics.aggr[0].value, num.toString(), 'proper number of CLICK events')

	t.end()
})

tape('should record: correct payout with targetingRules, consistent with balances', async function(
	t
) {
	const channel = getValidEthChannel()
	channel.spec = {
		...channel.spec,
		pricingBounds: {
			CLICK: {
				min: '1',
				max: '3'
			}
		},
		targetingRules: [
			{ if: [{ eq: [{ get: 'country' }, 'US'] }, { set: ['price.CLICK', { bn: '2' }] }] }
		]
	}
	const num = 66
	const addr = randomAddress()
	const evs = genEvents(num, addr, 'CLICK')
	// Submit a new channel; we submit it to both sentries to avoid 404 when propagating messages
	await Promise.all([
		fetchPost(`${leaderUrl}/channel`, dummyVals.auth.leader, channel),
		fetchPost(`${followerUrl}/channel`, dummyVals.auth.follower, channel)
	])

	// Those should be counted as '2' by virtue of the targetingRules
	await postEvsAsCreator(leaderUrl, channel.id, evs, { 'cf-ipcountry': 'US' })
	// Send some w/o country: US, to see if we count those as '1'
	await postEvsAsCreator(leaderUrl, channel.id, evs)

	// Technically we don't need to tick, since the events should be reflected immediately
	const analytics = await fetchWithAuth(
		`${leaderUrl}/analytics/${channel.id}?eventType=CLICK&metric=eventPayouts`,
		dummyVals.auth.creator,
		{}
	).then(r => r.json())

	t.equal(analytics.aggr[0].value, (num * 2 + num).toString(), 'proper payout amount')

	// Check if balances is consistent
	await aggrAndTick()
	await forceTick()
	const channelIface = new SentryInterface(dummyAdapter, channel, { logging: false })
	const { balances } = await channelIface.getOurLatestMsg('Accounting')
	const expectedAfterFees = Math.floor((num * 2 + num) * 0.8).toString(10)
	t.equal(balances[addr], expectedAfterFees, 'proper amount in balances')

	t.end()
})

tape('analytics routes return correct values', async function(t) {
	const channel = getValidEthChannel()
	// Submit a new channel; we submit it to both sentries to avoid 404 when propagating messages
	await Promise.all([
		fetchPost(`${leaderUrl}/channel`, dummyVals.auth.leader, channel),
		fetchPost(`${followerUrl}/channel`, dummyVals.auth.follower, channel)
	])
	// publisher = defaultPublisher
	const evs = genEvents(10).concat(genEvents(10, randomAddress()))

	// post events
	await Promise.all([
		postEvsAsCreator(leaderUrl, channel.id, evs, { 'cf-ipcountry': 'US' }),
		postEvsAsCreator(followerUrl, channel.id, evs, { 'cf-ipcountry': 'US' })
	])

	const sumValues = vals => vals.map(x => parseInt(x.value, 10)).reduce((a, b) => a + b, 0)
	const urls = [
		['', null, resp => sumValues(resp.aggr) >= 20],
		[`/${channel.id}`, dummyVals.auth.creator, resp => sumValues(resp.aggr) === 20],
		['/for-publisher', dummyVals.auth.publisher, resp => sumValues(resp.aggr) >= 10],
		['/for-advertiser', dummyVals.auth.creator, resp => sumValues(resp.aggr) >= 20],
		[`/for-publisher/${channel.id}`, dummyVals.auth.publisher, resp => sumValues(resp.aggr) === 10],
		[
			`/for-publisher/${channel.id}?segmentByChannel=true`,
			dummyVals.auth.publisher,
			resp => sumValues(resp.aggr) === 10 && Object.keys(resp.aggr[0]).includes('channelId')
		],
		[
			'/advanced',
			dummyVals.auth.creator,
			resp => Object.keys(resp.byChannelStats).includes(channel.id)
		],
		[
			`/for-admin?channels=${channel.id}&earner=${
				dummyVals.ids.publisher
			}&eventType=IMPRESSION&metric=eventCounts`,
			dummyVals.auth.leader,
			resp => sumValues(resp.aggr) === 10
		],
		[
			`/for-admin?channels=${channel.id}&eventType=IMPRESSION&metric=eventCounts`,
			dummyVals.auth.leader,
			resp => sumValues(resp.aggr) >= 20
		]
	]

	await Promise.all(
		urls.map(([url, auth, testFn]) =>
			fetch(`${leaderUrl}/analytics${url}`, {
				method: 'GET',
				headers: {
					authorization: auth ? `Bearer ${auth}` : '',
					'content-type': 'application/json'
				}
			})
				.then(res => res.json())
				.then(function(resp) {
					t.equal(testFn(resp), true, `/analytics${url}`)
				})
		)
	)
	t.end()
})

tape('targetingRules: event to update them works', async function(t) {
	const channel = getValidEthChannel()
	channel.spec = {
		...channel.spec,
		pricingBounds: {
			IMPRESSION: {
				min: '10',
				max: '30'
			}
		}
	}

	// Submit a new channel; we submit it to both sentries to avoid 404 when propagating messages
	await Promise.all([
		fetchPost(`${leaderUrl}/channel`, dummyVals.auth.leader, channel),
		fetchPost(`${followerUrl}/channel`, dummyVals.auth.follower, channel)
	])

	// update targetingRules, and then try to see if the new values apply
	await fetchPost(`${leaderUrl}/channel/${channel.id}/events`, dummyVals.auth.creator, {
		events: [
			{
				type: constants.eventTypes.update_targeting,
				targetingRules: [
					{ if: [{ eq: [{ get: 'country' }, 'US'] }, { set: ['price.IMPRESSION', { bn: '30' }] }] }
				]
			}
		]
	})

	// sleep to give some time for the channel to be updated
	await wait(cfg.CHANNEL_REFRESH_INTERVAL)

	const num = 66
	const evs = genEvents(num, randomAddress(), 'IMPRESSION')
	await postEvsAsCreator(leaderUrl, channel.id, evs, { 'cf-ipcountry': 'US' })
	// Technically we don't need to tick, since the events should be reflected immediately
	const analytics = await fetchWithAuth(
		`${leaderUrl}/analytics/${channel.id}?eventType=IMPRESSION&metric=eventPayouts`,
		dummyVals.auth.creator,
		{}
	).then(r => r.json())
	t.equal(analytics.aggr[0].value, (num * 30).toString(), 'proper payout amount')

	t.end()
})

tape('targetingRules: onlyShowIf is respected and returns a HTTP error code', async function(t) {
	const channel = getValidEthChannel()
	const specialPublisher = randomAddress()
	channel.spec = {
		...channel.spec,
		targetingRules: [{ onlyShowIf: { eq: [{ get: 'publisherId' }, specialPublisher] } }]
	}

	// Submit a new channel; we submit it to both sentries to avoid 404 when propagating messages
	await Promise.all([
		fetchPost(`${leaderUrl}/channel`, dummyVals.auth.leader, channel),
		fetchPost(`${followerUrl}/channel`, dummyVals.auth.follower, channel)
	])

	const num = 55
	const evs = genEvents(num, specialPublisher, 'IMPRESSION').concat(
		genEvents(num, randomAddress(), 'IMPRESSION')
	)
	await postEvsAsCreator(leaderUrl, channel.id, evs, {})

	// If it's only one event, it will return an error code
	const postOneResp = await postEvsAsCreator(
		leaderUrl,
		channel.id,
		genEvents(1, randomAddress(), 'IMPRESSION')
	)
	t.equal(postOneResp.status, 469, 'returned proper HTTP response code')

	// Technically we don't need to tick, since the events should be reflected immediately
	const analytics = await fetchWithAuth(
		`${leaderUrl}/analytics/${channel.id}?eventType=IMPRESSION&metric=eventPayouts`,
		dummyVals.auth.creator,
		{}
	).then(r => r.json())
	t.equal(analytics.aggr[0].value, num.toString(), 'proper payout amount')

	t.end()
})

tape('targetingRules: multiple rules are applied, pricingBounds are honored', async function(t) {
	const channel = getValidEthChannel()
	channel.spec = {
		...channel.spec,
		pricingBounds: {
			IMPRESSION: {
				min: '10',
				max: '30'
			}
		},
		targetingRules: [
			// To make sure we can't set a price, considering the default pricingBounds is max 0
			{ if: [{ eq: [{ get: 'eventType' }, 'CLICK'] }, { set: ['price.CLICK', { bn: '10' }] }] },
			{
				if: [
					{ eq: [{ get: 'adUnitId' }, 'underpriced'] },
					{ set: ['price.IMPRESSION', { bn: '5' }] }
				]
			},
			{
				if: [
					{ eq: [{ get: 'adUnitId' }, 'overpriced'] },
					{ set: ['price.IMPRESSION', { bn: '35' }] }
				]
			},
			{ onlyShowIf: { startsWith: [{ get: 'adSlotId' }, 'goodSlot_'] } }
		]
	}

	// Submit a new channel; we submit it to both sentries to avoid 404 when propagating messages
	await Promise.all([
		fetchPost(`${leaderUrl}/channel`, dummyVals.auth.leader, channel),
		fetchPost(`${followerUrl}/channel`, dummyVals.auth.follower, channel)
	])

	// Send the events
	const publisher = randomAddress()
	const expectedPayout = 20 + 30 + 30 + 10
	await postEvsAsCreator(
		leaderUrl,
		channel.id,
		[
			// those two would be paid normally
			{ type: 'IMPRESSION', adSlot: 'goodSlot_1', publisher },
			{ type: 'IMPRESSION', adSlot: 'goodSlot_2', publisher },

			// try to exploit with two overpriced, 1 underpriced, but should result in 30 + 30 + 10
			{ type: 'IMPRESSION', adSlot: 'goodSlot_1', adUnit: 'overpriced', publisher },
			{ type: 'IMPRESSION', adSlot: 'goodSlot_2', adUnit: 'overpriced', publisher },
			{ type: 'IMPRESSION', adSlot: 'goodSlot_3', adUnit: 'underpriced', publisher },

			// send one without adSlotId to make sure we can't exploit it by sending an undefined var
			{ type: 'IMPRESSION', publisher },

			// two clicks, none of which should be paid
			{ type: 'CLICK', adSlot: 'goodSlot_1', publisher },
			{ type: 'CLICK', adSlot: 'goodSlot_2', publisher }
		],
		{}
	)

	const getLastAnalytics = async (ev, metric) => {
		const resp = await fetchWithAuth(
			`${leaderUrl}/analytics/${channel.id}?eventType=${ev}&metric=${metric}`,
			dummyVals.auth.creator,
			{}
		)
		const { aggr } = await resp.json()
		return aggr[0] ? aggr[0].value : '0'
	}

	t.equal(
		await getLastAnalytics('IMPRESSION', 'eventPayouts'),
		expectedPayout.toString(10),
		'proper payout amount for IMPRESSION'
	)
	t.equal(await getLastAnalytics('CLICK', 'eventPayouts'), '0', 'zero payout amount for CLICK')
	t.equal(await getLastAnalytics('CLICK', 'eventCounts'), '2', 'proper count for CLICK')

	t.end()
})

tape('validatorWorker: does not apply empty aggr', async function(t) {
	const channel = getValidEthChannel()
	channel.spec = {
		...channel.spec,
		targetingRules: []
	}

	// Submit a new channel; we submit it to both sentries to avoid 404 when propagating messages
	await Promise.all([
		fetchPost(`${leaderUrl}/channel`, dummyVals.auth.leader, channel),
		fetchPost(`${followerUrl}/channel`, dummyVals.auth.follower, channel)
	])

	// update targetingRules
	await fetchPost(`${leaderUrl}/channel/${channel.id}/events`, dummyVals.auth.creator, {
		events: [
			{
				type: constants.eventTypes.update_targeting,
				targetingRules: []
			}
		]
	})

	// sleep to give some time for the channel to be updated
	await wait(cfg.CHANNEL_REFRESH_INTERVAL)

	// wait for the events to be aggregated and new states to be issued
	await aggrAndTick()
	await forceTick()

	const sentry = new SentryInterface(dummyAdapter, channel, { logging: false })

	const aggrs = await sentry.getEventAggrs()
	t.equal(aggrs.length, 0, 'no aggrs were produced')

	const data = await sentry.getLatestMsg(dummyVals.ids.leader, 'Accounting')
	t.equal(data, null, 'shoud not produce new Accounting aggregate with empty event aggregate')

	t.end()
})

tape('/validator-messages: reject Accounting/NewState messages with empty balances', async function(
	t
) {
	const channel = getValidEthChannel()
	channel.spec = {
		...channel.spec,
		targetingRules: []
	}

	// Submit a new channel; we submit it to both sentries to avoid 404 when propagating messages
	await Promise.all([
		fetchPost(`${leaderUrl}/channel`, dummyVals.auth.leader, channel),
		fetchPost(`${followerUrl}/channel`, dummyVals.auth.follower, channel)
	])

	await Promise.all(
		[
			[
				{
					type: 'Accounting',
					balancesBeforeFees: {},
					balances: {},
					lastEvAggr: new Date().toISOString()
				}
			],
			[
				{
					type: 'NewState',
					balancesBeforeFees: {},
					balances: {},
					stateRoot: '1648231285e69677531ffe70719f67a07f3d4393b8425a5a1c84b0c72434c77b',
					signature:
						'0x0583e008087dbe1f8162ffa6d8da3663ae8e044c7ef4defe007ec237c0a016cc2a8054c391087b9970c155b8711f01422709cfb3c48595ed66c8823be4f6c3391c'
				}
			]
		].map(async messages => {
			const result = await (await fetchPost(
				`${followerUrl}/channel/${channel.id}/validator-messages`,
				dummyVals.auth.leader,
				{ messages }
			)).json()
			const { type } = messages[0]
			t.equal(result.statusCode, 400, `should reject ${type} with empty balances`)
			t.deepEqual(
				result.validation.keys,
				['messages.0.balances'],
				`should reject empty ${type} with [required keys] message`
			)
		})
	)

	t.end()
})

tape(
	`/channel: reject channel spec greater than ${cfg.MAX_CHANNEL_SPEC_BYTES_SIZE}`,
	async function(t) {
		const channel = getValidEthChannel()
		// eslint-disable-next-line global-require
		Object.assign(channel.spec, require('./resources/invalid_spec.json'))

		const res = await fetchPost(`${leaderUrl}/channel`, dummyVals.auth.leader, channel)
		t.equal(
			res.status,
			400,
			`should reject channel spec greater than ${cfg.MAX_CHANNEL_SPEC_BYTES_SIZE}`
		)
		const errMsg = await res.json()
		t.equal(
			errMsg.message,
			`spec byte size exceeds allowed ${cfg.MAX_CHANNEL_SPEC_BYTES_SIZE} bytes size limit`,
			`should reject channel spec greater than ${cfg.MAX_CHANNEL_SPEC_BYTES_SIZE}`
		)
		t.end()
	}
)

tape(
	'should reject posting event on an exhausted channel and post no additional heartbeats',
	async function(t) {
		const channel = getValidEthChannel()
		const channelIface = new SentryInterface(dummyAdapter, channel, { logging: false })

		// Submit a new channel; we submit it to both sentries to avoid 404 when propagating messages
		await Promise.all([
			fetchPost(`${leaderUrl}/channel`, dummyVals.auth.leader, channel),
			fetchPost(`${followerUrl}/channel`, dummyVals.auth.follower, channel)
		])

		// 1 event pays 1 token for now; we can change that via spec.minPerImpression
		const expectDeposit = parseInt(channel.depositAmount, 10)
		const evCount = expectDeposit + 1
		await postEvsAsCreator(leaderUrl, channel.id, genEvents(evCount))
		await aggrAndTick()
		await forceTick()

		const { balances } = await channelIface.getOurLatestMsg('Accounting')
		const sum = Object.keys(balances)
			.map(k => parseInt(balances[k], 10))
			.reduce((a, b) => a + b, 0)
		t.equal(sum, expectDeposit, 'balance does not exceed the deposit, but equals it')

		// channel should be marked exhausted
		const channelStatus = await fetch(`${leaderUrl}/channel/${channel.id}/status`).then(res =>
			res.json()
		)
		t.ok(
			channelExhausted(channelStatus.channel),
			'channel should be exhausted and have exhausted param set'
		)
		// sleep to give some time for the channel to be updated
		await wait(cfg.CHANNEL_REFRESH_INTERVAL)
		//
		const postOneResp = await postEvsAsCreator(leaderUrl, channel.id, genEvents(1)).then(res =>
			res.json()
		)
		t.equal(postOneResp.statusCode, 410, 'returned proper response statusCode')
		t.equal(postOneResp.message, 'channel is exhausted', 'returned proper error response')

		await aggrAndTick()
		await forceTick()

		const leaderHeartbeat = await channelIface.getLastMsgs(dummyVals.ids.leader, 'Heartbeat')
		const followerHeartbeat = await channelIface.getLastMsgs(dummyVals.ids.follower, 'Heartbeat')

		t.equal(
			leaderHeartbeat.heartbeats.length,
			2,
			'leader: should not post Heartbeat on an exhausted channel'
		)
		t.equal(
			followerHeartbeat.heartbeats.length,
			2,
			'follower: should not post Heartbeat on an exhausted channel'
		)

		t.end()
	}
)

// @TODO sentry tests: ensure every middleware case is accounted for: channelIfExists, channelIfActive, auth
// @TODO tests for the adapters and especially ewt
