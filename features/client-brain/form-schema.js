// Brain Builder form schema. Pure data, client-safe (no node imports).
//
// One entry per `### Heading` field of CLIENT_BRAIN.md, in the order of
// docs/company-brain/CLIENT_BRAIN_MARKDOWN_STANDARD.md. Headings and aliases
// match features/client-brain/markdown.cjs (compiler) and brain-sync.cjs
// (card write-back), so a form save is read by the same code as hand-written
// Markdown. Field keys are `<sectionId>.<field>`.
//
// kinds:
//   text     one line (newlines are flattened)
//   textarea free prose, newlines kept
//   list     string[], one `- item` bullet each
//   rows     object[] of string cells; `rowFormat: 'pipe'` is `a: .. | b: ..`,
//            `rowFormat: 'keyed'` is one `key: value` bullet per row

const F = (key, heading, kind, opts, guidance) => ({
  key,
  heading,
  aliases: [],
  kind,
  required: false,
  placeholder: '',
  ...opts,
  guidance,
});

const g = (why, how, example, usedBy) => ({ why, how, example, usedBy });

const IDENTITY_FIELDS = [
  F('identity.name', 'Name', 'text', { required: true, maxLen: 140, placeholder: 'Harbor Row Coffee' }, g(
    'The name every output uses when it talks about the business.',
    'Use the public trading name, spelled the way customers see it.',
    'Harbor Row Coffee',
    ['Every consumer', 'Market Signals', 'Brand Overview'],
  )),
  F('identity.categoryToOwn', 'Category To Own', 'list', { required: true, aliases: ['Categories To Own', 'Category'], maxLen: 180, placeholder: 'Specialty coffee roasting' }, g(
    'The market category you want to be known for. The first item also sets the industry when none is given.',
    'One category per line, most important first. Name the market, not a slogan.',
    'Specialty coffee roasting',
    ['Decision Engine', 'Strategy Builder', 'Market Signals'],
  )),
  F('identity.categoryToAvoid', 'Category To Avoid', 'list', { required: true, aliases: ['Categories To Avoid'], maxLen: 180, placeholder: 'Bulk commodity coffee' }, g(
    'Labels you do not want attached to the business, so copy and research steer away from them.',
    'List the categories people might wrongly put you in.',
    'Bulk commodity coffee',
    ['Decision Engine', 'Strategy Builder'],
  )),
  F('identity.positioning', 'Positioning', 'textarea', { required: true, aliases: ['One Liner', 'One-Liner'], maxLen: 600, placeholder: 'A small-batch roaster that sells directly to cafes and home brewers.' }, g(
    'The one-sentence statement of what you are and who for. It anchors the context block that goes into every prompt.',
    'One or two plain sentences: what you do, for whom, and why you are different.',
    'A small-batch roaster that supplies neighborhood cafes and home brewers with beans roasted within a week of shipping.',
    ['Strategy Builder', 'Post Me', 'Email Digest', 'Creative Brief', 'Brand Overview'],
  )),
  F('identity.primaryAudience', 'Primary Audience', 'list', { required: true, aliases: ['Audience', 'Who Hires Them'], maxLen: 180, placeholder: 'Independent cafe owners' }, g(
    'The people the business exists to serve. Research and copy are aimed at them.',
    'One audience segment per line. Be specific about the role or situation.',
    'Independent cafe owners',
    ['Strategy Builder', 'Market Signals', 'Brand Overview', 'Decision Engine'],
  )),
  F('identity.offers', 'Offers', 'list', { required: true, aliases: ['Services', 'What They Sell'], maxLen: 180, placeholder: 'Wholesale bean subscriptions' }, g(
    'What you sell. Copy uses these as the concrete things to talk about.',
    'One product or service per line, named the way a customer would ask for it.',
    'Wholesale bean subscriptions',
    ['Strategy Builder', 'Post Me', 'Email Digest', 'Brand Overview'],
  )),
  F('identity.xHandle', 'X Handle', 'text', { aliases: ['Twitter Handle'], maxLen: 40, placeholder: 'harborrowcoffee' }, g(
    'The business account on X. Market Signals and the X Strategy profile read it.',
    'Enter the handle without the @.',
    'harborrowcoffee',
    ['Market Signals', 'X Strategy'],
  )),
  F('identity.primaryUrl', 'Primary Url', 'text', { aliases: ['Website', 'URL'], maxLen: 300, placeholder: 'https://harborrowcoffee.example' }, g(
    'The main website. It appears in the identity line of every context block and is the default call to action link.',
    'Paste the full address of the homepage.',
    'https://harborrowcoffee.example',
    ['Every consumer', 'Strategy Builder'],
  )),
  F('identity.industry', 'Industry', 'text', { maxLen: 100, placeholder: 'Food and beverage' }, g(
    'A short industry label used by Strategy Builder. When blank it is taken from the first Category To Own.',
    'A few words. Leave blank to use the derived value.',
    'Food and beverage',
    ['Strategy Builder', 'Brand Overview'],
  )),
  F('identity.businessModel', 'Business Model', 'text', { maxLen: 600, placeholder: 'Subscription wholesale plus online retail' }, g(
    'How the business makes money, in one line. When blank it is built from Offers.',
    'Say who pays and how, in plain words.',
    'Monthly wholesale subscriptions for cafes, plus online retail for home brewers.',
    ['Brand Overview'],
  )),
  F('identity.mission', 'Mission', 'textarea', { maxLen: 600, placeholder: 'Make fresh, traceable coffee easy for small cafes to serve.' }, g(
    'Why the business exists. Used as supporting context when positioning is needed.',
    'One or two sentences, no slogans.',
    'Make fresh, traceable coffee easy for small cafes to serve.',
    ['Strategy Builder', 'Post Me', 'Brand Overview'],
  )),
  F('identity.longTerm', 'Long-Term Positioning', 'textarea', { maxLen: 600, placeholder: 'The default roaster for independent cafes in the region.' }, g(
    'Where you want the positioning to be in a few years.',
    'One or two sentences about the position you are building toward.',
    'The default roaster for independent cafes in the Pacific Northwest.',
    ['Strategy Builder'],
  )),
  F('identity.authorityClaims', 'Authority Claim', 'list', { aliases: ['Authority', 'Legitimate Authority'], keepCommas: true, maxLen: 240, placeholder: 'Roasting for cafes since 2014' }, g(
    'The reasons people should trust you on this topic. The first one becomes the headline authority position.',
    'One sentence per line. Commas are kept inside a line.',
    'Roasting for neighborhood cafes since 2014, with 40 wholesale accounts.',
    ['Strategy Builder', 'Post Me', 'Decision Engine'],
  )),
  F('identity.differentiators', 'Differentiators', 'list', { keepCommas: true, maxLen: 240, placeholder: 'Roasted to order, shipped within 48 hours' }, g(
    'What you do that competitors do not. Positioning copy draws on these.',
    'One sentence per line. Concrete beats clever.',
    'Every batch is roasted to order and ships within 48 hours.',
    ['Strategy Builder', 'Post Me', 'Creative Brief'],
  )),
  F('identity.principles', 'Core Philosophy', 'list', { aliases: ['Principles'], keepCommas: true, maxLen: 240, placeholder: 'Small batches over big volume' }, g(
    'The principles that shape how you work and talk. Copy uses them as guardrails on stance.',
    'One principle per line, written as a plain statement.',
    'Small batches over big volume.',
    ['Strategy Builder', 'Post Me', 'Email Digest'],
  )),
  F('identity.strategicOneLiner', 'Strategic One-Liner', 'text', { maxLen: 300, placeholder: 'Fresh coffee for cafes that care about the cup.' }, g(
    'The sharpest internal description of the business. It also feeds the Brand Overview headline.',
    'One line, up to 300 characters.',
    'Fresh coffee for cafes that care about the cup.',
    ['Strategy Builder', 'Brand Overview'],
  )),
  F('identity.safePublicOneLiner', 'Safer Public One-Liner', 'text', { aliases: ['Public One-Liner'], maxLen: 300, placeholder: 'We roast coffee for cafes and home brewers.' }, g(
    'A description that is safe to use in public copy, with no claims you cannot back up.',
    'One line, up to 300 characters.',
    'We roast coffee for cafes and home brewers.',
    ['Post Me', 'Email Digest', 'Creative Brief'],
  )),
  F('identity.linkedinOneLiner', 'LinkedIn-Oriented One-Liner', 'text', { aliases: ['LinkedIn One-Liner'], maxLen: 300, placeholder: 'Wholesale roasting for independent cafes.' }, g(
    'A description pitched for a LinkedIn audience. Stored for later use.',
    'One line, up to 300 characters.',
    'Wholesale roasting for independent cafes.',
    ['Not yet used'],
  )),
  F('identity.xOneLiner', 'X-Oriented One-Liner', 'text', { aliases: ['X One-Liner'], maxLen: 300, placeholder: 'roasting coffee for cafes, one small batch at a time' }, g(
    'A description pitched for X. Social post prompts use it as the identity line.',
    'One line in the tone you use on X, up to 300 characters.',
    'roasting coffee for cafes, one small batch at a time',
    ['Post Me', 'X Strategy'],
  )),
  F('identity.contactUrl', 'Contact Url', 'text', { maxLen: 500, placeholder: 'https://harborrowcoffee.example/contact' }, g(
    'Where readers should go to reach a person. The Email Digest uses it for its contact link.',
    'Paste the full address of the contact or booking page.',
    'https://harborrowcoffee.example/contact',
    ['Email Digest'],
  )),
];

const MARKET_FIELDS = [
  F('market.searchKeywords', 'Search Keywords', 'list', { required: true, aliases: ['Keywords'], maxLen: 180, placeholder: 'specialty coffee wholesale' }, g(
    'Terms that describe the market you compete in. Research starts from them.',
    'Short search phrases, one per line. Avoid whole sentences.',
    'specialty coffee wholesale',
    ['Market Signals', 'Decision Engine'],
  )),
  F('market.competitors', 'Competitors', 'list', { required: true, aliases: ['Direct Competitors'], maxLen: 120, placeholder: 'Northline Roasters' }, g(
    'Businesses a customer would compare you with. Market Signals tracks them.',
    'One name or handle per line, direct competitors only.',
    'Northline Roasters',
    ['Market Signals', 'Decision Engine'],
  )),
  F('market.adjacentCompetitors', 'Adjacent Competitors', 'list', { maxLen: 180, placeholder: 'Tea subscription boxes' }, g(
    'Businesses that compete for the same customer budget without being a direct match.',
    'One per line.',
    'Tea subscription boxes',
    ['Market Signals'],
  )),
  F('market.thoughtLeaders', 'Thought Leaders', 'list', { required: true, aliases: ['KOLs', 'Influencers', 'Founder Accounts'], maxLen: 180, placeholder: '@examplebarista' }, g(
    'People whose opinions shape your market. They are partnership and quote targets.',
    'One name or handle per line.',
    '@examplebarista',
    ['Decision Engine', 'Lead Gen'],
  )),
  F('market.publications', 'Publications', 'list', { required: true, aliases: ['News Sources'], maxLen: 180, placeholder: 'Daily Coffee News' }, g(
    'Outlets your market reads. They are used as news and trend sources.',
    'One publication per line.',
    'Daily Coffee News',
    ['Decision Engine', 'Market Signals'],
  )),
  F('market.communities', 'Communities', 'list', { required: true, maxLen: 180, placeholder: 'Home barista forums' }, g(
    'Places where your market talks, such as forums, groups, or subreddits.',
    'One community per line.',
    'Home barista forums',
    ['Decision Engine', 'Market Signals'],
  )),
  F('market.topicsToMonitor', 'Topics To Monitor', 'list', { aliases: ['Topics'], maxLen: 180, placeholder: 'coffee prices' }, g(
    'Subjects Market Signals should watch for news and conversation. Saved here and in the card.',
    'Short topic phrases, one per line, up to 12 are used.',
    'green coffee prices',
    ['Market Signals'],
  )),
  F('market.benchmarkAccounts', 'Benchmark Accounts', 'list', { maxLen: 120, placeholder: 'northlineroasters' }, g(
    'X accounts you measure yourself against in X Strategy.',
    'One handle per line, without the @. Up to 8 are used.',
    'northlineroasters',
    ['X Strategy'],
  )),
];

const DISCOVERY_FIELDS = [
  F('discovery.keywords', 'Keywords', 'list', { required: true, aliases: ['Search Keywords'], maxLen: 120, placeholder: 'fresh roasted coffee' }, g(
    'Short search terms used to find mentions and questions about the business. They also fill the Listening card.',
    'Short search terms, one per line. Up to 12 sync to the card.',
    'fresh roasted coffee',
    ['Market Signals', 'Listening', 'Decision Engine'],
  )),
  F('discovery.primaryPlatforms', 'Primary Platforms', 'list', { required: true, aliases: ['Platforms'], maxLen: 40, placeholder: 'web' }, g(
    'Where research looks. Supported: web, x, reddit, instagram, youtube, tiktok, hackernews.',
    'One platform per line, lowercase.',
    'instagram',
    ['Market Signals', 'Email Digest'],
  )),
  F('discovery.communities', 'Communities', 'list', { required: true, maxLen: 180, placeholder: 'r/Coffee' }, g(
    'Communities to watch for discovery, which can differ from the market list.',
    'One per line.',
    'r/Coffee',
    ['Decision Engine', 'Market Signals'],
  )),
  F('discovery.publications', 'Publications', 'list', { required: true, maxLen: 180, placeholder: 'Sprudge' }, g(
    'Publications where you would want coverage or to find stories.',
    'One per line.',
    'Sprudge',
    ['Decision Engine'],
  )),
  F('discovery.podcasts', 'Podcasts', 'list', { required: true, maxLen: 180, placeholder: 'Coffee Business Weekly' }, g(
    'Podcasts your audience listens to, for research and outreach.',
    'One per line.',
    'Coffee Business Weekly',
    ['Decision Engine'],
  )),
  F('discovery.events', 'Events', 'list', { required: true, aliases: ['Conferences'], maxLen: 180, placeholder: 'Regional Coffee Expo' }, g(
    'Events and conferences your market attends.',
    'One per line.',
    'Regional Coffee Expo',
    ['Decision Engine'],
  )),
  F('discovery.directories', 'Directories', 'list', { required: true, maxLen: 180, placeholder: 'Yelp' }, g(
    'Directories and listings where the business should appear.',
    'One per line.',
    'Yelp',
    ['Decision Engine'],
  )),
  F('discovery.awards', 'Awards', 'list', { required: true, maxLen: 180, placeholder: 'Good Food Awards' }, g(
    'Awards worth winning or citing in your field.',
    'One per line.',
    'Good Food Awards',
    ['Decision Engine'],
  )),
  F('discovery.socialEcosystems', 'Social Ecosystems', 'list', { required: true, aliases: ['Ecosystems'], maxLen: 180, placeholder: 'Coffee Instagram' }, g(
    'Named pockets of social media where your audience gathers.',
    'One per line, described the way people in the group would name it.',
    'Coffee Instagram',
    ['Decision Engine'],
  )),
  F('discovery.hashtags', 'Hashtags', 'list', { required: true, maxLen: 80, placeholder: '#specialtycoffee' }, g(
    'Hashtags your market uses. Searches and posts can draw on them.',
    'One per line, with the #.',
    '#specialtycoffee',
    ['Decision Engine', 'Market Signals'],
  )),
  F('discovery.watchLists', 'Watch Lists', 'list', { required: true, aliases: ['Watchlists', 'KOL Watchlist', 'KOLs'], maxLen: 120, placeholder: '@examplebarista' }, g(
    'Accounts to track closely. They fill the Listening watchlist (up to 20).',
    'One handle per line.',
    '@examplebarista',
    ['Listening', 'Market Signals'],
  )),
  F('discovery.instagramHandles', 'Instagram Handles', 'list', { maxLen: 120, placeholder: 'northlineroasters' }, g(
    'Instagram accounts to watch. Fills the Instagram source of Market Signals.',
    'One handle per line, up to 20.',
    'northlineroasters',
    ['Market Signals'],
  )),
  F('discovery.searchQueries', 'Search Queries', 'rows', {
    rowFormat: 'pipe', rowKeys: ['label', 'query', 'goal'], bareRowKey: 'query', maxRows: 8,
    placeholder: 'label: BRAND | query: "Harbor Row" OR "Harbor Row Coffee" | goal: Find mentions of the business',
  }, g(
    'The exact searches Market Signals runs. When blank they are built from your keywords, topics and competitors.',
    'One row per search: a label, the query text (quotes and OR are kept), and why it exists. Up to 8.',
    'label: BRAND | query: "Harbor Row" OR "Harbor Row Coffee" | goal: Find mentions of the business',
    ['Market Signals'],
  )),
  F('discovery.sourceFocus', 'Source Focus', 'textarea', { maxLen: 1000, placeholder: 'Independent cafe owners looking for a reliable roaster.' }, g(
    'A short brief telling research what to prioritize. When blank it is built from Positioning and Primary Audience.',
    'A few sentences on what matters most in the results.',
    'Independent cafe owners who are unhappy with their current roaster.',
    ['Market Signals'],
  )),
  F('discovery.scoutInstructions', 'Scout Instructions', 'textarea', { maxLen: 6000, placeholder: 'Ignore job postings and press releases.' }, g(
    'Free-form instructions passed to the research agent.',
    'Plain rules, one per line or in short paragraphs.',
    'Ignore job postings and press releases. Prefer posts from the last 30 days.',
    ['Market Signals'],
  )),
];

const AUTHORITY_FIELDS = [
  F('authority.proofPoints', 'Proof Points', 'list', { required: true, aliases: ['Proof'], maxLen: 180, placeholder: '40 wholesale accounts in two states' }, g(
    'Facts that prove you can do the work. Copy and the Proof Builder only claim what is listed here.',
    'One verifiable fact per line, with a number or name when you have one.',
    '40 wholesale accounts across two states',
    ['Proof Builder', 'Strategy Builder', 'Decision Engine'],
  )),
  F('authority.workHistory', 'Work History', 'list', { required: true, aliases: ['Career'], maxLen: 180, placeholder: 'Supplied Corner Table Cafe since 2016' }, g(
    'Past clients, employers or projects that support your credibility.',
    'One per line.',
    'Supplied Corner Table Cafe since 2016',
    ['Proof Builder', 'Decision Engine'],
  )),
  F('authority.allowedClaims', 'Allowed Claims', 'list', { required: true, aliases: ['Claims Allowed'], maxLen: 180, placeholder: 'Roasted within a week of shipping' }, g(
    'Statements the business is allowed to make in public.',
    'One claim per line, worded the way it may be published.',
    'Roasted within a week of shipping',
    ['Strategy Builder', 'Guardian', 'Decision Engine'],
  )),
  F('authority.prohibitedClaims', 'Prohibited Claims', 'list', { required: true, aliases: ['Claims Prohibited'], keepCommas: true, maxLen: 240, placeholder: 'Best coffee in the world' }, g(
    'Statements that must never appear. The quality check rejects copy that makes them. Up to 30 sync to the Guardian.',
    'One claim per line. Include claims that are exaggerated or legally risky.',
    'Best coffee in the world',
    ['Guardian', 'Scribe', 'Decision Engine'],
  )),
  F('authority.metrics', 'Metrics', 'list', { keepCommas: true, maxLen: 240, placeholder: '4.8 average rating across 900 reviews' }, g(
    'Numbers that back up your claims. Commas inside a line are kept.',
    'One metric per line with the figure and what it measures.',
    '4.8 average rating across 900 reviews',
    ['Proof Builder', 'Email Digest'],
  )),
];

const CONTENT_FIELDS = [
  F('content.pillars', 'Content Pillars', 'list', { required: true, aliases: ['Pillars'], maxLen: 120, placeholder: 'Behind the roast' }, g(
    'The recurring themes your content covers. They shape what Strategy Builder plans.',
    'One theme per line, up to 20 sync to Strategy Builder.',
    'Behind the roast',
    ['Strategy Builder', 'Post Me', 'Email Digest'],
  )),
  F('content.recurringSeries', 'Recurring Series', 'list', { required: true, aliases: ['Series'], maxLen: 180, placeholder: 'Friday Cupping Notes' }, g(
    'Named series you publish on a repeating schedule.',
    'One series per line.',
    'Friday Cupping Notes',
    ['Strategy Builder', 'Decision Engine'],
  )),
  F('content.voice', 'Voice', 'textarea', { required: true, aliases: ['Tone', 'Writing Style'], maxLen: 4000, placeholder: 'Warm, direct, a little dry. No hype.' }, g(
    'How the business sounds. This is the first thing every copy tool reads.',
    'Describe the tone in one short paragraph. The first 500 characters feed the summary.',
    'Warm, direct, a little dry. Talks like a barista who knows the farm, not like an ad.',
    ['Scribe', 'Guardian', 'Post Me', 'Strategy Builder', 'Email Digest'],
  )),
  F('content.voicePillars', 'Voice Pillars', 'rows', {
    rowFormat: 'pipe', rowKeys: ['name', 'description', 'do', 'dont'], maxRows: 8,
    placeholder: 'name: Plainspoken | description: trade jargon for plain words | do: "We roast on Tuesdays" | dont: "We are thrilled to announce"',
  }, g(
    'The two to four traits that make the voice recognisable, each with a good and a bad example line.',
    'One row per trait: a name, what it means, a line that does it, a line that does not. Up to 8.',
    'name: Plainspoken | description: plain words over trade jargon | do: "We roast on Tuesdays" | dont: "We are thrilled to announce"',
    ['Scribe', 'Guardian', 'Post Me', 'Reply Targets'],
  )),
  F('content.examplePosts', 'Example Posts', 'rows', {
    rowFormat: 'pipe', rowKeys: ['type', 'label', 'post'], bareRowKey: 'post', maxRows: 12,
    placeholder: 'type: observation | label: hook style I like | post: ...',
  }, g(
    'Real posts that sound right. This is the strongest lever for making generated copy sound like you.',
    'One row per post. Only the post text is needed; type and label are optional. Use 3 to 6 real examples.',
    'type: observation | label: short and dry | post: our new Ethiopia lot is in. it tastes like blueberry jam. we are not going to oversell it.',
    ['Scribe', 'Guardian', 'Strategy Builder', 'Post Me', 'Reply Targets'],
  )),
  F('content.creators', 'Creators I Emulate', 'list', { aliases: ['Creators To Emulate', 'Emulate'], maxLen: 120, placeholder: '@examplebarista' }, g(
    'Writers whose style you want to be close to. Added to the writing instructions.',
    'One handle or name per line. Up to 20.',
    '@examplebarista',
    ['Scribe', 'Guardian'],
  )),
  F('content.preferredWords', 'Preferred Words', 'list', { aliases: ['Preferred Vocabulary'], maxLen: 80, placeholder: 'roasted' }, g(
    'Words and phrases you want to see more of. They appear as a Do line in prompts.',
    'One word or short phrase per line.',
    'roasted',
    ['Scribe', 'Post Me', 'Strategy Builder'],
  )),
  F('content.formattingRules', 'Formatting Rules', 'rows', {
    rowFormat: 'keyed', rowKeys: ['key', 'value'], allowedRowKeys: ['short', 'medium', 'long', 'caps', 'emojis', 'punctuation', 'links'], maxRows: 7,
    placeholder: 'short: 1-2 lines, no hashtags',
  }, g(
    'Layout rules for posts by length, plus rules for capitals, emojis, punctuation and links.',
    'One rule per row. Allowed keys: short, medium, long, caps, emojis, punctuation, links.',
    'short: 1-2 lines, no hashtags',
    ['Scribe', 'Guardian', 'Post Me'],
  )),
  F('content.doNotSay', 'Do Not Say', 'list', { aliases: ['Banned Words'], maxLen: 80, placeholder: 'game-changing' }, g(
    'Words and phrases that must not appear. They appear as a Do not line in prompts and seed the hard constraints.',
    'One word or phrase per line.',
    'game-changing',
    ['Scribe', 'Guardian', 'Post Me', 'Strategy Builder'],
  )),
  F('content.callsToAction', 'Calls To Action', 'list', { aliases: ['CTAs'], maxLen: 80, placeholder: 'Order a sample box' }, g(
    'What you want readers to do next. The first one is the Strategy Builder call to action.',
    'One short action per line, most important first.',
    'Order a sample box',
    ['Strategy Builder', 'Post Me', 'Email Digest'],
  )),
  F('content.topicsToOwn', 'Topics To Own', 'list', { maxLen: 120, placeholder: 'Freshness' }, g(
    'Subjects you want to be the go-to voice on. Counted with Content Pillars.',
    'One topic per line.',
    'Roast freshness',
    ['Strategy Builder', 'Decision Engine'],
  )),
  F('content.topicsToAvoid', 'Topics To Avoid', 'list', { maxLen: 120, placeholder: 'Politics' }, g(
    'Subjects content must stay away from. Up to 20 sync to Strategy Builder.',
    'One topic per line.',
    'Politics',
    ['Strategy Builder', 'Decision Engine'],
  )),
  F('content.hardConstraints', 'Hard Constraints', 'list', { keepCommas: true, maxLen: 240, placeholder: 'Never mention competitor prices' }, g(
    'Rules the writer and the quality check must always follow. When blank they are taken from Do Not Say.',
    'One rule per line, written as a clear instruction.',
    'Never mention competitor prices.',
    ['Scribe', 'Guardian', 'Strategy Builder'],
  )),
  F('content.reviewerContext', 'Reviewer Context', 'textarea', { maxLen: 800, placeholder: 'Harbor Row Coffee: a small-batch roaster for cafes.' }, g(
    'A short note that tells the quality check who the business is. When blank it is built from Name and Positioning.',
    'One or two sentences.',
    'Harbor Row Coffee: a small-batch roaster for cafes and home brewers.',
    ['Guardian'],
  )),
  F('content.emailTone', 'Email Tone', 'text', { maxLen: 200, placeholder: 'friendly, brief, direct' }, g(
    'The tone of the daily email digest. When blank it is taken from the first sentence of Voice.',
    'A few descriptive words.',
    'friendly, brief, direct',
    ['Email Digest'],
  )),
  F('content.emailInstructions', 'Email Instructions', 'textarea', { maxLen: 2000, placeholder: 'Keep the summary under 120 words.' }, g(
    'Extra instructions for the email digest writer.',
    'Plain rules, one per line.',
    'Keep the summary under 120 words. Lead with anything that needs a decision today.',
    ['Email Digest'],
  )),
  F('content.ctaUrl', 'CTA Url', 'text', { maxLen: 300, placeholder: 'https://harborrowcoffee.example/samples' }, g(
    'The link that goes with the call to action. When blank it is the Primary Url.',
    'Paste a full address.',
    'https://harborrowcoffee.example/samples',
    ['Strategy Builder', 'Post Me'],
  )),
  F('content.contentTracks', 'Content Tracks', 'rows', {
    rowFormat: 'pipe', rowKeys: ['label', 'share', 'topics', 'benchmarks'], maxRows: 6,
    placeholder: 'label: Design | share: 50 | topics: client work; process | benchmarks: accountone; accounttwo',
  }, g(
    'The content lanes on X and what share of authored posts each gets.',
    'One row per track. share is a percent, topics and benchmarks are separated with semicolons, handles have no @. Up to 6.',
    'label: Roastery | share: 60 | topics: behind the roast; new lots | benchmarks: northlineroasters',
    ['X Strategy'],
  )),
  F('content.trackTargets', 'Track Targets', 'rows', {
    rowFormat: 'pipe', rowKeys: ['track', 'postsPerDay', 'original-showcase', 'original-text', 'reply', 'quote', 'self-quote', 'video'], maxRows: 6,
    placeholder: 'track: Roastery | postsPerDay: 2 | original-showcase: 30 | original-text: 20 | reply: 30 | quote: 15 | self-quote: 5 | video: 40',
  }, g(
    'Posting volume and post-type mix per track.',
    'One row per track, using a track label from Content Tracks. Type shares are percents and should sum to 100; video is a separate share.',
    'track: Roastery | postsPerDay: 2 | original-showcase: 30 | original-text: 20 | reply: 30 | quote: 15 | self-quote: 5 | video: 40',
    ['X Strategy'],
  )),
];

const OPPORTUNITY_FIELDS = [
  F('opportunity.icpSegments', 'ICP Segments', 'list', { required: true, aliases: ['ICP', 'Opportunity Targets'], maxLen: 180, placeholder: 'Cafes with two to five locations' }, g(
    'The customer types that are the best fit. Lead search and opportunity scoring aim at them.',
    'One segment per line, specific enough to recognize one when you see it.',
    'Cafes with two to five locations',
    ['Opportunity Signals', 'Lead Gen', 'Decision Engine'],
  )),
  F('opportunity.verticals', 'Verticals', 'list', { required: true, maxLen: 180, placeholder: 'Cafes and bakeries' }, g(
    'Industries you want to sell into.',
    'One per line.',
    'Cafes and bakeries',
    ['Lead Gen', 'Decision Engine'],
  )),
  F('opportunity.geographies', 'Geographies', 'list', { required: true, aliases: ['Locations'], maxLen: 120, placeholder: 'Portland, OR' }, g(
    'Places you serve or want to grow in. The first is also treated as your location.',
    'One place per line.',
    'Portland, OR',
    ['Lead Gen', 'Decision Engine'],
  )),
  F('opportunity.leadGenTargets', 'Lead Gen Targets', 'list', { required: true, aliases: ['LeadGen', 'Lead Gen'], maxLen: 180, placeholder: 'New cafes opening this year' }, g(
    'Specific kinds of companies or people to find as leads.',
    'One target per line.',
    'New cafes opening this year',
    ['Lead Gen', 'Decision Engine'],
  )),
  F('opportunity.disqualifiers', 'Disqualifiers', 'list', { maxLen: 180, placeholder: 'Chains with central purchasing' }, g(
    'Signs that a lead is not a fit. They are also read as audience objections.',
    'One per line.',
    'Chains with central purchasing',
    ['Opportunity Signals', 'Lead Gen'],
  )),
  F('opportunity.queries', 'Opportunity Queries', 'rows', {
    rowFormat: 'pipe', rowKeys: ['label', 'query', 'enabled'], bareRowKey: 'query', maxRows: 10,
    placeholder: 'label: New cafe | query: "opening a cafe" supplier | enabled: false',
  }, g(
    'The searches Opportunity Signals runs to find buying signals. Rows can be switched off.',
    'One row per search: a label and the query. Add enabled: false to pause a row. Up to 10.',
    'label: New cafe | query: "opening a cafe" need roaster',
    ['Opportunity Signals'],
  )),
];

const STRATEGY_TEXT = (key, heading, placeholder, why, how, example) => F(
  `strategy.${key}`, heading, 'textarea', { maxLen: 4000, placeholder }, g(why, how, example, ['X Strategy']),
);

const STRATEGY_FIELDS = [
  STRATEGY_TEXT('thesis', 'Thesis', 'What the account is for and the one rule everything follows.',
    'What the X account is for and the single rule every post follows.',
    'One short paragraph.',
    'Show the roastery, not the pitch. Every post should make a cafe owner trust our beans.'),
  STRATEGY_TEXT('audience', 'Audience', 'Who to reach and what they come for.',
    'Who the account reaches and what those people come for.',
    'A short paragraph or a few bullets.',
    'Cafe owners and serious home brewers who want to know where their beans come from.'),
  STRATEGY_TEXT('tracks', 'Tracks', 'The content lanes and why each exists.',
    'The lanes of content and the reason each exists.',
    'One bullet per lane with a short reason.',
    '- Roastery: shows the process.\n- Cafe stories: shows customers.'),
  STRATEGY_TEXT('formats', 'Formats', 'Which post types do which job.',
    'Which post types do which job.',
    'One bullet per format.',
    '- Short video: new lot announcements.\n- Text: opinions on brewing.'),
  STRATEGY_TEXT('rules', 'Rules', 'Do and do not, short checkable lines.',
    'Short rules a post can be checked against.',
    'One checkable rule per line.',
    '- No hashtags.\n- Never post prices.'),
  STRATEGY_TEXT('algorithm', 'Algorithm', 'What the X ranking rewards and penalizes, as it applies here.',
    'What the X ranking rewards and penalizes, as it applies to this account.',
    'A few bullets.',
    '- Replies in the first hour matter most.\n- Links in the main post lower reach.'),
  STRATEGY_TEXT('decisions', 'Decisions', 'Settled calls with date and evidence.',
    'Calls that are settled, with the date and the evidence.',
    'One bullet per decision, dated.',
    '- 2026-05-01: stop posting prices. Posts with prices got half the views.'),
  STRATEGY_TEXT('open', 'Open questions', 'What is still being tested.',
    'What is still being tested.',
    'One bullet per question.',
    '- Does a weekly cupping video beat daily photos?'),
];

export const BRAIN_FORM_SECTIONS = [
  {
    id: 'identity',
    title: 'Identity Intelligence',
    sectionAliases: ['Identity'],
    intro: 'Who the business is and what it sells. Everything else is read against this.',
    fields: IDENTITY_FIELDS,
  },
  {
    id: 'market',
    title: 'Market Intelligence',
    sectionAliases: ['Market'],
    intro: 'The market you compete in: competitors, voices, publications and topics to watch.',
    fields: MARKET_FIELDS,
  },
  {
    id: 'discovery',
    title: 'Discovery Intelligence',
    sectionAliases: ['Discovery'],
    intro: 'Where research looks: search terms, platforms, communities and the accounts to watch.',
    fields: DISCOVERY_FIELDS,
  },
  {
    id: 'authority',
    title: 'Authority Intelligence',
    sectionAliases: ['Authority'],
    intro: 'The proof behind the business, and the claims you may and may not make.',
    fields: AUTHORITY_FIELDS,
  },
  {
    id: 'content',
    title: 'Content Intelligence',
    sectionAliases: ['Content'],
    intro: 'How the business sounds and what it talks about. The voice fields make generated copy sound like you.',
    fields: CONTENT_FIELDS,
  },
  {
    id: 'opportunity',
    title: 'Opportunity Intelligence',
    sectionAliases: ['Opportunity'],
    intro: 'Who to sell to and where to find them.',
    fields: OPPORTUNITY_FIELDS,
  },
  {
    id: 'strategy',
    title: 'Strategy Document',
    sectionAliases: [],
    intro: 'The X strategy document. The Brain owns it; saving here updates the Strategy tab on the next sync.',
    fields: STRATEGY_FIELDS,
  },
];

// Section id/title/aliases are attached to each flat field so callers
// (serializer, validator, UI) never need to look the section up again.
export const ALL_FIELDS = BRAIN_FORM_SECTIONS.flatMap((section) => section.fields.map((fld) => {
  fld.sectionId = section.id;
  fld.section = section.title;
  fld.sectionAliases = section.sectionAliases;
  return fld;
}));

export const FIELD_BY_KEY = Object.fromEntries(ALL_FIELDS.map((fld) => [fld.key, fld]));

export function isFieldFilled(fld, value) {
  if (value == null) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (Array.isArray(value)) {
    if (fld && fld.kind === 'rows') {
      return value.some((row) => row && Object.values(row).some((cell) => String(cell == null ? '' : cell).trim()));
    }
    return value.some((item) => String(item == null ? '' : item).trim());
  }
  return false;
}

// values: { [fieldKey]: string | string[] | object[] }. fields defaults to ALL_FIELDS.
export function countFilled(values, fields = ALL_FIELDS) {
  const map = values || {};
  let filled = 0;
  const requiredMissing = [];
  for (const fld of fields) {
    if (isFieldFilled(fld, map[fld.key])) filled += 1;
    else if (fld.required) requiredMissing.push(fld.key);
  }
  return { filled, total: fields.length, requiredMissing };
}
