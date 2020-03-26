/* eslint-disable no-nested-ternary */
// const BN = require('bignumber.js') // allows
const BN = require('bn.js')
const toBalancesKey = require('../toBalancesKey')

function getPayout(channel, ev) {
	if (ev.type === 'IMPRESSION' && ev.publisher) {
		// add the minimum price for the event to the current amount
		const minPrice = new BN(channel.spec.minPerImpression || 1)
		const maxPrice = new BN(channel.spec.maxPerImpression || 1)
		const price = channel.spec.priceMultiplicationRules
			? payout(channel.spec.priceMultiplicationRules, ev, maxPrice, minPrice)
			: new BN(channel.spec.minPerImpression || 1)
		return [toBalancesKey(ev.publisher), new BN(price.toString())]
	}
	if (ev.type === 'CLICK' && ev.publisher) {
		const minPrice = new BN(
			(channel.spec.pricingBounds && channel.spec.pricingBounds.CLICK.min) || 0
		)
		const maxPrice = new BN(
			(channel.spec.pricingBounds && channel.spec.pricingBounds.CLICK.max) || 0
		)
		const price = channel.spec.priceMultiplicationRules
			? payout(channel.spec.priceMultiplicationRules, ev, maxPrice, minPrice)
			: new BN((channel.spec.pricingBounds && channel.spec.pricingBounds.CLICK.min) || 0)
		return [toBalancesKey(ev.publisher), new BN(price.toString())]
	}
	return null
}

function payout(rules, ev, maxPrice, startPrice) {
	const match = isRuleMatching.bind(null, ev)
	const matchingRules = rules.filter(match)
	let finalPrice = startPrice

	if (matchingRules.length > 0) {
		const divisionExponent = new BN(10).pow(new BN(18, 10))
		const firstFixed = matchingRules.find(x => x.amount)
		const priceByRules = firstFixed
			? new BN(firstFixed.amount)
			: startPrice
					.mul(
						new BN(
							(
								matchingRules
									.filter(x => x.multiplier)
									.map(x => x.multiplier)
									.reduce((a, b) => a * b, 1) * 1e18
							).toString()
						)
					)
					.div(divisionExponent)
		finalPrice = BN.min(maxPrice, priceByRules)
	}

	return finalPrice
}

function isRuleMatching(ev, rule) {
	return rule.eventType
		? rule.eventType.includes(ev.type.toLowerCase())
		: true && rule.publisher
		? rule.publisher.includes(ev.publisher.toLowerCase())
		: true && rule.osType
		? rule.osType.includes(ev.os.toLowerCase())
		: true && rule.country
		? rule.country.includes(ev.country.toLowerCase())
		: true
}

module.exports = getPayout
