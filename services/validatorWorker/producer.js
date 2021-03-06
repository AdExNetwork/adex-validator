const { mergeAggrs } = require('./lib/mergeAggrs')
const logger = require('../logger')('validatorWorker(producer)')

async function tick(iface, channel) {
	const accounting = (await iface.getOurLatestMsg('Accounting')) || {
		balancesBeforeFees: {},
		balances: {},
		lastEvAggr: new Date(0)
	}

	// Process eventAggregates, from old to new, newer than the lastEvAggr time
	const aggrs = await iface.getEventAggrs({ after: accounting.lastEvAggr })

	// mergeAggr will add all eventPayouts from aggrs to the balancesBeforeFees
	// and produce a new accounting message
	if (aggrs.length) {
		logMerge(aggrs, channel)
		const newAccounting = mergeAggrs(accounting, aggrs, channel)
		await iface.propagate([newAccounting])
		return { accounting, newAccounting }
	}
	return { accounting }
}

function logMerge(aggrs, channel) {
	logger.info(`channel ${channel.id}: processing ${aggrs.length} event aggregates`)
}

module.exports = { tick }
