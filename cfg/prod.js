module.exports = {
	MAX_CHANNELS: 512,
	WAIT_TIME: 40000,
	// 60000/AGGR_THROTTLE must be an integer!
	// otherwise by-minute analytics charts would look jagged cause every Nth minute will have more aggrs
	AGGR_THROTTLE: 30000,
	HEARTBEAT_TIME: 60000,
	CHANNELS_FIND_LIMIT: 512,
	EVENTS_FIND_LIMIT: 100,
	ANALYTICS_FIND_LIMIT: 500,
	ANALYTICS_FIND_LIMIT_BY_CHANNEL_SEGMENT: 100 * 25, // Market `maxChannelsEarningFrom=25`
	MSGS_FIND_LIMIT: 10,
	HEALTH_THRESHOLD_PROMILLES: 970,
	HEALTH_UNSIGNABLE_PROMILLES: 770,
	PROPAGATION_TIMEOUT: 3000,
	FETCH_TIMEOUT: 10000,
	LIST_TIMEOUT: 10000,
	VALIDATOR_TICK_TIMEOUT: 10000,
	IP_RATE_LIMIT: { type: 'ip', timeframe: 7200000 },
	CREATORS_WHITELIST: [],
	TOKEN_ADDRESS_WHITELIST: {
		// DAI
		'0x6b175474e89094c44da98b954eedeac495271d0f': {
			MINIMUM_DEPOSIT: '100000000',
			MINIMAL_FEE: '100000000',
			DECIMALS: 18
		},
		// SAI
		'0x89d24A6b4CcB1B6fAA2625fE562bDD9a23260359': {
			MINIMUM_DEPOSIT: '100000000',
			MINIMAL_FEE: '100000000',
			DECIMALS: 18
		},
		// USDT
		'0xdac17f958d2ee523a2206206994597c13d831ec7': {
			MINIMUM_DEPOSIT: '1000000',
			MINIMAL_FEE: '1000',
			DECIMALS: 6
		},
		// USDC
		'0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48': {
			MINIMUM_DEPOSIT: '100000000',
			MINIMAL_FEE: '1000',
			DECIMALS: 6
		}
	},
	ETHEREUM_CORE_ADDR: '0x333420fc6a897356e69b62417cd17ff012177d2b',
	ETHEREUM_NETWORK: 'homestead',
	ETHEREUM_ADAPTER_RELAYER: 'https://relayer.adex.network',
	VALIDATORS_WHITELIST: [],
	CHANNEL_REFRESH_INTERVAL: 40000,
	MAX_CHANNEL_SPEC_BYTES_SIZE: 35000,
	admins: [],
	V4_VALIDATOR_URL: 'https://jerry.adex.network',
	SWEEPER_ADDRESS: '0x872e239332d13d6b29bf58283906d92fb2a7209b'
}
