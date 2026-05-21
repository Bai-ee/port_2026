/**
 * Strategy Builder — JSDoc type definitions.
 * These are documentation-only; no runtime code here.
 */

/**
 * @typedef {Object} Location
 * @property {number} lat
 * @property {number} lng
 * @property {string} city
 * @property {string} country
 * @property {string} tz  — IANA timezone string e.g. "America/New_York"
 */

/**
 * @typedef {Object} ClientInfo
 * @property {string} id
 * @property {string} name
 * @property {string} vertical
 * @property {Location} location
 * @property {string} [hours]
 * @property {string[]} [closedDays]
 * @property {string[]} [offers]
 */

/**
 * @typedef {Object} BrandInfo
 * @property {string} [voice]
 * @property {string} [tone]
 * @property {string[]} [palette]
 * @property {Object} [fonts]
 * @property {{ summary?: string }} [styleGuide]
 */

/**
 * @typedef {Object} BriefInfo
 * @property {string} [positioning]
 * @property {string} [audience]
 * @property {string} [objectives]
 * @property {string[]} [productLines]
 */

/**
 * @typedef {Object} CardFindings
 * @property {string[]} highlights
 * @property {string[]} gaps
 * @property {string} readiness
 */

/**
 * @typedef {Object} DayForecast
 * @property {string} date           — ISO date string
 * @property {number} tempMax
 * @property {number} tempMin
 * @property {number} weatherCode    — WMO code
 * @property {string} description    — human-readable e.g. "Rain"
 */

/**
 * @typedef {Object} LocalEvent
 * @property {string} id
 * @property {string} name
 * @property {string} date           — ISO date string
 * @property {string} [description]
 */

/**
 * @typedef {Object} Holiday
 * @property {string} id
 * @property {string} name
 * @property {string} [date]         — "MM-DD" for fixed dates
 * @property {string} [dateRule]     — description for moveable feasts
 * @property {string} [resolvedDate] — computed ISO date (set at runtime)
 * @property {number} leadDays
 * @property {string[]} verticals
 * @property {string} theme
 * @property {'soft'|'hard'} ramp
 */

/**
 * @typedef {Object} Intelligence
 * @property {string} [humanBrief]
 * @property {any[]} [brandMentions]
 * @property {any[]} [kolActivity]
 * @property {any[]} [categoryTrends]
 * @property {any[]} [competitorIntel]
 * @property {any[]} [viralOpportunities]
 * @property {any[]} [contentOpportunities]
 */

/**
 * @typedef {Object} MediaDirection
 * @property {string} [dnaPromptBlock]  — Visual DNA master prompt block (hints only)
 */

/**
 * @typedef {Object} SeoContext
 * @property {string} [summary]
 * @property {any[]} [topics]
 */

/**
 * @typedef {Object} Promotion
 * @property {string} id
 * @property {string} label
 * @property {string} endDate  — ISO date the promotion ends
 */

/**
 * @typedef {Object} Campaign
 * @property {string} [objective]   — awareness|bookings|foot-traffic|leads|promotions|community
 * @property {string} [ctaText]
 * @property {string} [ctaUrl]
 * @property {string} [postTime]    — "HH:MM" client-local preferred post time
 * @property {string} [postTime2]   — optional second daily slot
 * @property {string} [guardrails]  — hard content constraints, never violated
 * @property {'none'|'sparing'|'liberal'} [emojiPolicy]
 * @property {number} [maxHashtags]
 * @property {Promotion[]} [promotions]
 */

/**
 * @typedef {Object} StrategyContext
 * @property {ClientInfo} client
 * @property {BrandInfo} brand
 * @property {BriefInfo} brief
 * @property {Intelligence|null} [intelligence]
 * @property {MediaDirection|null} [media]
 * @property {SeoContext|null} [seo]
 * @property {Campaign} [campaign]
 * @property {Record<string, CardFindings>} cardFindings
 * @property {{ weather: { enabled: boolean, forecast?: DayForecast[] }, events: { enabled: boolean, items?: LocalEvent[] }, holidays: { enabled: boolean, items?: Holiday[] } }} signals
 * @property {{ startDate: string, days: number, postsPerDay: number, baselineMixPct: number, rampAggressiveness: number, tone?: string }} config
 * @property {string} now  — ISO timestamp
 */

/**
 * @typedef {Object} PostAnchor
 * @property {string} id
 * @property {string} name
 * @property {string} date           — ISO date string
 * @property {string} vertical
 * @property {number} leadDays
 * @property {'soft'|'hard'} ramp
 */

/**
 * @typedef {Object} PostItem
 * @property {string} id
 * @property {string} scheduledAt    — ISO datetime
 * @property {string} content        — <= 280 chars
 * @property {string[]} [hashtags]
 * @property {string} [mediaHint]
 * @property {'baseline'|'ramp'|'event'|'closure'|'special'} kind
 * @property {string|null} [anchorId]
 * @property {string} rationale
 * @property {number} confidence     — 0..1
 */

/**
 * @typedef {Object} PostPlan
 * @property {string} campaignId
 * @property {string} generatedAt    — ISO datetime
 * @property {PostAnchor[]} anchors
 * @property {PostItem[]} items
 */
