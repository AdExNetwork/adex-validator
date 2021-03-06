# API

## Channel

#### Get a list of all channels

- URL

/channel/list

- METHOD

`GET`

- Query Params

`page=[integer]` (optional) default: 0

`validUntil=[timestamp]` (optional) filters per `channel.validUntil` > `validUntil`

- Response

    * Success
    ```javascript
        {
            channels: [
                {
                    id: 'awesomeTestChannel',
                    depositAsset: 'DAI',
                    depositAmount: '1000',
                    creator: 'awesomeCreator',
                    validUntil: 4102444800,
                    spec: {
                        minPerImpression: '1',
                        validators: [
                            { id: 'awesomeLeader', url: 'http://localhost:8005', fee: '100' },
                            { id: 'awesomeFollower', url: 'http://localhost:8006', fee: '100' },
                        ]
                    }
                }
            ]
        }
    ```


#### Get channel status

Get channel status, and the validator sig(s); should each node maintain all sigs? also, remaining funds in the channel and remaining funds that are not claimed on chain (useful past validUntil); AND the health, perceived by each validator

- URL

/channel/:id/status

- METHOD

`GET`

- Response

    * Success

    ```javascript
        {
            id: 'awesomeTestChannel',
            depositAsset: 'DAI',
            depositAmount: '1000',
            creator: 'awesomeCreator',
            validUntil: 4102444800,
            spec: {
                minPerImpression: '1',
                validators: [
                    { id: 'awesomeLeader', url: 'http://localhost:8005', fee: '100' },
                    { id: 'awesomeFollower', url: 'http://localhost:8006', fee: '100' },
                ]
            }
        }
    ```

---

## Validator Messages

#### Get chanel validator messages

- URL

/:id/validator-messages/:uid?/:type

- METHOD

`GET`

- URL Params

`uid=[string] (optional)`

`type=[string] (optional)`

- Query

`limit=[integer] (e.g. ?limit=10)`

- Response

    * Success

    ```javascript
    {
        validatorMessages: [
            {

            }
        ]
    }
    ```

    * Error

        * Code: 401
        Message: Unauthorized

#### Submit channel validator messages

- URL

/:id/validator-messages

- METHOD

`POST`

- HEADERS
    `authorization [ eg. 'Bearer xxx']`

    `content-type [application/json]`

- Data Params

`type=[string] [Required in ('NewState', 'ApproveState', 'Heartbeat', 'Accounting', 'RejectState')]`

`signature=[string]  [Required in ('NewState', 'ApproveState', 'Heartbeat')]`

`stateRoot=[string]  [Required in ('NewState', 'ApproveState', 'Heartbeat')]`

`isHealthy=[boolean] [Required in ('ApproveState)]`

`reason=[string] [Required in ('RejectState')]`

`balancesBeforeFees=[object] [Required in ('Accounting')]`

`balances=[object] [Required in ('Accounting')]`

`timestamp=[ISODate] [Required in ('Heartbeat')]`

`lastEvAggr=[ISODate] [Required in ('Accounting')]`


- Response

    * Success 

        ```javascript
        {
            success: true
        }
        ```

    * Error

        * Code: 401
            Message: Unauthorized
        * Code: 400
        Message:Error occurred

#### Validator Last Approved Messages

Get chanel validator last approved `NewState` and `ApproveState` messages

- URL

/:id/validator-messages/:uid?/:type?

- METHOD

`GET`

- URL Params

`uid=[string] (optional)`

`type=[string] (optional)`

- Response

    * Success

        ```javascript
        {
            lastApproved: {
                'newState': {},
                'approveState': {}
            }
        }
        ```

    * Error

        * Code: 401
        Message: Unauthorized

---

## Events

#### Event Aggregates
Get event aggregates received by a validator

- URL

/channel/events-aggregates

- METHOD

`GET`

- URL Params

`uid=[string] (optional)`

`type=[string] (optional)`

- Response

    * Success

    ```javascript
        {
            channel: {}
            events: {}
        }
    ```

    * Error 

        * Code: 401
        Message: Unauthorized

#### Event Aggregates by Timeframe
Get event aggregates received by a earner

- URL
/:id/events-aggregates/:earner

- METHOD

`GET`

- URL Params

`id=[string] channel id`

`earner=[string] earner id`

- Query Params

`eventType=[string] (default='IMPRESSION')`

`metric=[string] (default='eventCounts') can be either eventCounts|eventPayouts`

`timeframe=[string] (default='year') timeframe=day|week|year|month|minute|hour`

`limit=[number] (default= 100)`

- Response

    * Success

    ```javascript
        [
            {
                channel: {}
                aggr: [
                    {_id: {year: 2019 } value: 100},
                    {_id: {year: 2018 } value: 100},
                ]
            }
        ]
    ```

#### POST Events

Submit channel events to a validator sentry

- URL

/channel/:id/events

- METHOD

`POST`

- HEADERS
    
    `authorization [ eg. 'Bearer xxx']`
    
    `content-type [application/json]`

- Data Params

`events=[array] [Required] 
    Example: [
        {
            'type': 'IMPRESSION',
            'publisher': 'test'
        }
    ]
`

- Response

    * Success
        ```js
        {
            success: true 
        }
        ```

    * Error
        * Code: 401
        Message: Unauthorized

--

## Analytics

All routes take `timeframe` (string, can be "month", "week", "day"), `start`/`end` (optional ISO string dates)

#### Global Analytics

Get global analytics for validator

- URL

/analytics

- METHOD

`GET`

- Response

    * Success
        ```js
        [ 
            {
                time: 4102444800
                value: "10"
            }
        ]
        ```

#### Channel Analytics

Get a specific channel analytics

- URL

/analytics/:id

- METHOD

`GET`

- Response

    * Success
        ```js
        [ 
            {
                time: 4102444800
                value: "10"
            }
        ]
        ```

#### Global Publisher Analytics

Get global publisher analytics

- URL

/analytics/for-publisher

- METHOD

`GET`

- HEADERS
    
    `authorization [ eg. 'Bearer xxx']`

- Response 

    * Success
        ```js
        [ 
            {
                time: 4102444800
                value: "10"
            }
        ]
        ```

#### Publisher Analytics

Get publisher analytics

- URL

/analytics/for-publisher/:id

- METHOD

`GET`

- URL Params

`id=[string] ChannelId (optional)`

- HEADERS
    
    `authorization [ eg. 'Bearer xxx']`

- Response 

    * Success
        ```js
        [ 
            {
                time: 4102444800
                value: "10"
            }
        ]
        ```

#### Advertiser Analytics

Get a specific advertiser analytics

- URL

/analytics/for-advertiser

- METHOD

`GET`

- HEADERS
    
    `authorization [ eg. 'Bearer xxx']`

- Response 

    * Success
        ```js
        [ 
            {
                time: 4102444800
                value: "10"
            }
        ]
        ```

#### Admin Analytics

Get analytics for any earner, channel(s) or advertiser only for users with
admin allowed authentication capabilities

- URL

/analytics/for-admin

- METHOD

`GET`


- HEADERS
    
    `authorization [ eg. 'Bearer xxx']`

- Query Params

    `channels=[string] (comma separated channel ids e.g. 0x1,0x2)`
    `earner=[string] (earner id e.g. 0x1)`

- Response 

    * Success
        ```js
        [ 
            {
                time: 4102444800
                value: "10"
            }
        ]
        ```


## V5 analytics

### Routes

/v5/analytics

/v5/analytics/for-publisher

/v5/analytics/for-advertisers

/v5/analytics/for-admin

### Parameters

All routes take `timeframe` (string, can be "month", "week", *"day" (default)*), `start`/`end` (optional ISO string dates)

The following query parameters are supported on all analytics routes unless specified otherwise:

?metric=[string] - supported values are *`"count"` (default)* and `"paid"`

?eventType=[string] - supported values are *`"IMPRESSION"` (default)*, `"CLICK"`

?segmentBy=[string] - segment the output by the value of a particular key; valid values are `["campaignId","adUnit","adSlot","adSlotType","advertiser","publisher","hostname","country","osName"]`; for example `?segmentBy=osName`

#### Filtering

Queries can be made on the following keys: `['campaignId', 'adUnit', 'adSlot', 'adSlotType', 'advertiser', 'publisher', 'hostname', 'country', 'osName']` by either passing one value or multiple values.

For example, `?adSlotType=legacy_160x600` will only match events where the adSlotType is `legacy_160x600`, but `?adSlotType=legacy_160x600&adSlotType=legacy_728x90` will match all events where it's either of the two.

Please note that not all keys are queryable in all cases, see "Permissions"

### Permissions

Global queries are restricted to querying by/segmenting by ['country', 'adSlotType'] only.

All other routes allow querying and segmenting by any key, but `/for-publisher` restricts the dataset to all events recorded where the authenticated user is the publisher, and `/for-advertiser` does the same but where the authenticated user is the advertiser. To truly access all data, you need `/for-admin`


### Examples

`/v5/analytics/for-publisher?timeframe=month&segmentBy=adSlotType&country=BG` - gets all events for the authenticated publisher in Bulgaria and segments them by adSlotType, for each day in the month

`/v5/analytics/for-publisher?segmentBy=adSlotType&country=BG` - gets all events for the authenticated publisher in Bulgaria and segments them by adSlotType
