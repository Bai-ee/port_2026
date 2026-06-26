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
 * @typedef {Object} ClientBrainContext
 * @property {string} context — compact CLIENT_CONTEXT pack from Client Brain
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
 * @typedef {Object} EditorialAsset
 * @property {string} id
 * @property {string} title
 * @property {'screenshot'|'video'|'image'|'design-file'|'case-study'|'story'|'thread'|'quote'|'historic-work'|'current-work'} type
 * @property {string} [description]
 * @property {string} [url]
 * @property {string} [storagePath]
 * @property {string} campaignId
 * @property {string} [narrative]
 * @property {string[]} [projects]
 * @property {string[]} [topics]
 * @property {string[]} [platforms]
 * @property {string[]} [keywords]
 * @property {string[]} [clientBrainDecisionRefs]
 * @property {number} evergreenScore
 * @property {number} freshnessScore
 * @property {string} [preparedCopy]
 * @property {string} [mediaHint]
 */

/**
 * @typedef {Object} EditorialCampaign
 * @property {string} id
 * @property {string} name
 * @property {'active'|'paused'|'complete'} status
 * @property {number} priority
 * @property {number} allocationPct
 * @property {string} strategicObjective
 * @property {string} positioningObjective
 * @property {string[]} targetAudience
 * @property {string[]} supportedClientBrainTopics
 * @property {string[]} supportingProjects
 * @property {EditorialAsset[]} assetLibrary
 * @property {string[]} narrativeBuckets
 * @property {string[]} keywords
 * @property {string[]} dailySignalTriggers
 * @property {string[]} editorialFormats
 * @property {string} [fallback]
 * @property {{ startDate?: string, endDate?: string }} duration
 * @property {string} weeklyFocus
 * @property {string[]} successMetrics
 */

/**
 * @typedef {Object} EditorialSchedulePolicy
 * @property {{ primary: string[], secondary: string[], tertiary: string[] }} platforms
 * @property {Record<string, any>} publishingCadence
 * @property {Record<string, any>} preferredPublishingWindows
 * @property {Record<string, any>} campaignAllocation
 * @property {{ minDaysBetweenSameNarrative: number, maxProjectUsesPerSevenDays: number, rotateBy: string[] }} narrativeRotation
 * @property {{ formats: string[], maxConsecutiveRepeats: number }} editorialFormatRotation
 * @property {{ reuseAfterDays: number, rules: string[] }} assetReusePolicy
 * @property {{ may: string[], mayNot: string[], movableWindowDays: number }} dailyAdaptationLimits
 * @property {string[]} quietPeriods
 * @property {{ maxMonthlyPct: number, rules: string[] }} promotionPolicy
 * @property {string[]} fallbackRules
 * @property {string[]} approvalPolicy
 * @property {string[]} successEvaluation
 */

/**
 * @typedef {Object} EditorialStrategyConfig
 * @property {boolean} enabled
 * @property {string} frameworkVersion
 * @property {EditorialSchedulePolicy} schedulePolicy
 * @property {EditorialCampaign[]} campaigns
 * @property {{ preferredPlatforms: string[], avoidTopics: string[], preferredNarratives: string[] }} operatorPreferences
 * @property {Array<{ id: string, campaignId?: string, assetId?: string, narrative?: string, publishedAt?: string }>} recentPublishing
 */

/**
 * @typedef {Object} EditorialNarrativeStrength
 * @property {string} narrative
 * @property {number} score
 * @property {'weak'|'medium'|'strong'} strength
 * @property {Array<{ type: string, label: string, matchedTerms: string[] }>} matchedSignals
 */

/**
 * @typedef {Object} EditorialInfluenceDecision
 * @property {'no-change'|'adapt'|'swap-within-campaign'|'interrupt-campaign'} level
 * @property {string} label
 * @property {string} frequencyTarget
 * @property {string} instruction
 */

/**
 * @typedef {Object} EditorialRecommendation
 * @property {'recommendation'|'fallback'} mode
 * @property {string} generatedAt
 * @property {'no-change'|'adapt'|'swap-within-campaign'|'interrupt-campaign'} influenceLevel
 * @property {EditorialInfluenceDecision} influenceDecision
 * @property {Object} [schedulePolicy]
 * @property {{ id: string, name: string, strategicObjective?: string, positioningObjective?: string, weeklyFocus?: string, allocationPct?: number, editorialFormats?: string[], fallback?: string }} [campaign]
 * @property {string} [narrative]
 * @property {EditorialNarrativeStrength[]} [narrativeStrength]
 * @property {{ id: string, title: string, type: string, description?: string, url?: string, storagePath?: string, mediaHint?: string, preparedCopy?: string }} [selectedAsset]
 * @property {string} [whySelected]
 * @property {Array<{ type: string, label: string, summary: string, matchedTerms: string[] }>} [relevantDailySignals]
 * @property {string[]} [suggestedCopyAdjustments]
 * @property {'low'|'medium'|'high'} [confidence]
 * @property {number} [opportunityScore]
 * @property {string} fallbackRecommendation
 */

/**
 * @typedef {Object} StrategyContext
 * @property {ClientInfo} client
 * @property {BrandInfo} brand
 * @property {BriefInfo} brief
 * @property {Intelligence|null} [intelligence]
 * @property {MediaDirection|null} [media]
 * @property {SeoContext|null} [seo]
 * @property {ClientBrainContext|null} [clientBrain]
 * @property {Campaign} [campaign]
 * @property {EditorialStrategyConfig} [editorial]
 * @property {EditorialRecommendation} [editorialRecommendation]
 * @property {string} [editorialRecommendationText]
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
 * @typedef {Object} XStrategy
 * @property {string} algorithmProfileVersion  — e.g. 'x-2026-05-15'
 * @property {number} xGrowthScore             — 0..1 composite score
 * @property {string} targetAction             — primary Phoenix action to optimise for
 * @property {string} postType                 — authority|reply-loop|proof-loop|kol-adjacent|case-study|offer|asset|conversation-starter
 * @property {{ replyPotential: number, repostPotential: number, profileClickPotential: number, topicAuthority: number, dwellPotential: number, negativeFeedbackRisk: number, linkRisk: number }} scores
 * @property {Array<{ type: string, message: string }>} warnings
 * @property {Array<{ priority: string, action: string, reason: string }>} recommendations
 * @property {string} hypothesis               — one-sentence rationale from scoring
 */

/**
 * @typedef {Object} PostItem
 * @property {string} id
 * @property {string} scheduledAt    — ISO datetime
 * @property {string} content        — <= 280 chars
 * @property {string[]} [hashtags]
 * @property {string} [mediaHint]      — text direction for an asset (pre-render)
 * @property {string} [mediaUrl]       — fetchable URL of a paired rendered asset (post-render)
 * @property {string} [mediaType]      — 'video' | 'image'
 * @property {string} [mediaStoragePath] — Firebase Storage path of the asset
 * @property {string} [mediaContentType] — e.g. 'video/mp4'
 * @property {string} [mediaJobId]     — originating render_jobs/{jobId}
 * @property {'baseline'|'ramp'|'event'|'closure'|'special'} kind
 * @property {string|null} [anchorId]
 * @property {string} rationale
 * @property {number} confidence     — 0..1
 * @property {XStrategy} [xStrategy] — X algorithm scoring and growth metadata
 */

/**
 * @typedef {Object} PostPlan
 * @property {string} campaignId
 * @property {string} generatedAt    — ISO datetime
 * @property {PostAnchor[]} anchors
 * @property {PostItem[]} items
 * @property {EditorialRecommendation} [editorialRecommendation]
 */
