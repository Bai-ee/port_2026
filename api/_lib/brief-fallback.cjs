'use strict';

// Fallback site for website-less signups. A user who signs up with only an idea
// (no website) still gets a Creative Brief — its VISUAL assets (device mockup,
// full-page screenshots, studio motion mockup) render from this templated site.
// Brand/scout synthesis must stay gated on the client's OWN site so this
// fallback content never pollutes their brand data. Calibrate the templated
// experience (pre-rendered assets, idea-driven summary) later.
const FALLBACK_BRIEF_SITE = 'https://hitloop.agency';

module.exports = { FALLBACK_BRIEF_SITE };
