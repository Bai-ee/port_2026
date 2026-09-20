// WHY POST THIS TODAY — the occasion catalog.
//
// The hardest problem with an archive is not what to post, it is why anyone
// should care about it TODAY. A 1997 flyer posted for no reason is a picture;
// the same flyer posted because the venue just closed is news. Occasion is the
// difference, and it is the cheapest thing to manufacture because the world
// supplies most of it for free.
//
// Every trigger below answers one question — "why now?" — and carries the
// data the matcher needs to fire it, whether that data exists yet, and how
// strong the occasion is. Strength matters: a post riding a live external
// event borrows attention that already exists; a ritual post ("it's Friday")
// borrows none.
//
// Pure data. No fs, no network, no clock.

/** Occasion strength. Not a guess — it mirrors the one measured mechanic in
 * this whole system: borrowed attention beats broadcast attention. A
 * quote-react rides someone else's live audience and out-reaches a text post
 * 5.7× on the benchmark. External-event triggers are the archive equivalent. */
export const STRENGTH = { STRONG: 3, MEDIUM: 2, WEAK: 1 };

/** Can the system detect this on its own today? */
export const DETECTION = {
  AUTO: 'auto',            // fires from data we already hold
  SCAN: 'scan',            // fires from the daily quote-target / signals scan
  FEED: 'feed-needed',     // needs an external feed nobody has wired yet
  MANUAL: 'manual',        // a human notices and tags it
};

export const TRIGGERS = {
  // ---------------------------------------------------------------- time ---
  anniversary: {
    kind: 'time',
    strength: STRENGTH.MEDIUM,
    detection: DETECTION.AUTO,
    needs: ['eventDate'],
    question: 'did this happen on this date, some number of years ago?',
    copyFrame: '{n} years ago tonight — {what happened}',
    note: 'Implemented in match.js. The only trigger firing today.',
  },
  roundNumber: {
    kind: 'time',
    strength: STRENGTH.MEDIUM,
    detection: DETECTION.AUTO,
    needs: ['eventDate', 'eraYear'],
    question: 'is it a 10 / 20 / 25 / 30 year mark?',
    copyFrame: 'thirty years since {thing}. here is what it actually looked like',
    note: 'A round number is worth holding a post back for — a 29th anniversary is not a post.',
  },
  seasonMatch: {
    kind: 'time',
    strength: STRENGTH.WEAK,
    detection: DETECTION.AUTO,
    needs: ['eraYear', 'season'],
    question: 'does the artifact belong to this time of year?',
    copyFrame: 'this is what summer {year} sounded like',
  },
  ritual: {
    kind: 'time',
    strength: STRENGTH.WEAK,
    detection: DETECTION.AUTO,
    needs: ['series'],
    question: 'is it the recurring slot for this series?',
    copyFrame: '{series name}: {artifact}',
    note: 'Weakest occasion, most reliable cadence. A ritual is what fills the days nothing else happens — and the measured lesson is that gaps cost more than any single post gains.',
  },

  // ------------------------------------------------------------ external ---
  artistPlaying: {
    kind: 'external',
    strength: STRENGTH.STRONG,
    detection: DETECTION.FEED,
    needs: ['entities'],
    question: 'is someone in this artifact playing tonight / touring / announced?',
    copyFrame: '{artist} plays {venue} tonight. here he is at {your event}, {year}',
    note: 'The strongest trigger available and nothing feeds it yet. A gig-listing feed keyed to the entity graph would turn the whole archive into a live-events engine.',
  },
  venueNews: {
    kind: 'external',
    strength: STRENGTH.STRONG,
    detection: DETECTION.FEED,
    needs: ['entities'],
    question: 'did a venue in the archive close, reopen, or hit an anniversary?',
    copyFrame: '{venue} is closing. i threw {n} nights there. this is the first flyer',
  },
  reissue: {
    kind: 'external',
    strength: STRENGTH.STRONG,
    detection: DETECTION.FEED,
    needs: ['entities', 'assetRefs'],
    question: 'is a record in the archive being reissued or repressed?',
    copyFrame: 'they are repressing this. i have the {year} original and the difference is {x}',
  },
  festivalWeekend: {
    kind: 'external',
    strength: STRENGTH.MEDIUM,
    detection: DETECTION.MANUAL,
    needs: [],
    question: 'is the scene\'s attention concentrated somewhere this weekend?',
    copyFrame: 'everyone is at {festival}. here is what the same weekend looked like in {year}',
    note: 'ARC, Movement, festival weekends. Scene attention peaks and the timeline fills with people primed for exactly this.',
  },
  passing: {
    kind: 'external',
    strength: STRENGTH.STRONG,
    detection: DETECTION.MANUAL,
    needs: ['entities'],
    question: 'did someone in the archive die or retire?',
    copyFrame: '{name}. {a specific memory, not a eulogy}',
    note: '⚠️ MANUAL ONLY, PERMANENTLY. An automated system must never post about a death on its own. Detection can surface the artifact; a human writes and sends it, or it does not go out.',
    neverAutomate: true,
  },

  // -------------------------------------------------------- conversation ---
  idRequest: {
    kind: 'conversation',
    strength: STRENGTH.STRONG,
    detection: DETECTION.SCAN,
    needs: ['entities'],
    question: 'is someone asking for a track ID you can answer?',
    copyFrame: '{answer}. and the story behind it is {x}',
    note: 'Measured opening: @moorhaus_ publicly invites ID requests and his "digging and discovery" post is among his top. Answering with depth is the cheapest credibility purchase available.',
  },
  takeWithReceipt: {
    kind: 'conversation',
    strength: STRENGTH.STRONG,
    detection: DETECTION.SCAN,
    needs: ['story'],
    question: 'is a take going around that you have first-hand evidence about?',
    copyFrame: '{claim}. i ran {thing} for {n} years and what actually happened was {x}',
    note: 'The single differentiated move in this system: everyone has opinions, almost nobody has receipts.',
  },
  rediscovery: {
    kind: 'conversation',
    strength: STRENGTH.MEDIUM,
    detection: DETECTION.SCAN,
    needs: ['entities'],
    question: 'is a younger audience discovering something you were present for?',
    copyFrame: 'this is having a moment again. here is where it came from',
    note: '⚠️ Tone gate: the winning register is "here is more", never "i was there first". Gatekeeping reads as bitter and the measured top performers are all generous.',
  },
  nostalgiaWave: {
    kind: 'conversation',
    strength: STRENGTH.MEDIUM,
    detection: DETECTION.SCAN,
    needs: ['eraYear'],
    question: 'is an era trending — Y2K, blog house, pre-internet design?',
    copyFrame: 'the pre-internet era was so creative — {artifact}',
    note: 'The benchmark\'s second-best vein is literally this: "designers of the pre internet era were so creative" earned 694 likes on someone else\'s image.',
  },

  // ----------------------------------------------------------- personal ---
  playingTonight: {
    kind: 'personal',
    strength: STRENGTH.MEDIUM,
    detection: DETECTION.MANUAL,
    needs: [],
    question: 'are you playing, and is this in the bag?',
    copyFrame: 'playing this tonight. {why it still works}',
    note: '⚠️ This is the ONLY acceptable shape for a gig post. Measured across three accounts, straight promo is the worst-performing content any of them publish — @toshioueki\'s own event posts do 16–26 against 100–235 for records. Lead with the record, let the gig be context.',
  },
  digFind: {
    kind: 'personal',
    strength: STRENGTH.MEDIUM,
    detection: DETECTION.MANUAL,
    needs: ['assetRefs'],
    question: 'did you just find this in your own archive?',
    copyFrame: 'found this in a box i have not opened since {year}',
    note: 'Discovery framing works even when the artifact is decades old, because the discovery is genuinely today.',
  },
  newWorkReferences: {
    kind: 'personal',
    strength: STRENGTH.MEDIUM,
    detection: DETECTION.MANUAL,
    needs: ['entities'],
    question: 'does something you just made reference this?',
    copyFrame: 'the new one samples this. here is the original',
    note: 'Turns catalog into promotion without a promo post — the old record justifies the new release.',
  },

  // ---------------------------------------------------------- platform ---
  selfQuoteWinner: {
    kind: 'platform',
    strength: STRENGTH.MEDIUM,
    detection: DETECTION.AUTO,
    needs: ['ledger'],
    question: 'did one of your own posts outperform, and is there more to say?',
    copyFrame: 'people liked this more than i expected. here is the part i left out',
    note: 'The benchmark\'s HIGHEST-performing type (60.8 avg likes) and @bai_ee used it once in 65 days. Real examples from the corpus: "cause we had so many bad design takes lately, imma just binge watch my lil animation again" (199), "lots of people loved that animation so i\'ve made a tutorial" (78), "wild how this one lil slider went viral" (75).',
    requiresLedger: true,
  },
  requested: {
    kind: 'platform',
    strength: STRENGTH.MEDIUM,
    detection: DETECTION.MANUAL,
    needs: [],
    question: 'did someone actually ask for this?',
    copyFrame: 'as a few of you asked — {thing}',
    note: 'Measured on the benchmark: "As many of you requested - here\'s the tutorial" earned 97. The request is the permission slip.',
  },

  // ----------------------------------------------------------- archive ---
  justDigitized: {
    kind: 'archive',
    strength: STRENGTH.MEDIUM,
    detection: DETECTION.AUTO,
    needs: ['archiveEvent'],
    question: 'did the Archive just process, classify, or permanently store this?',
    copyFrame: 'pulled this off a {dead format} that has not spun since {year}',
    note: 'The Archive build generates occasions as a side effect — every VERIFIED Arweave transaction is a reason to post the thing that was preserved. Nothing else in this catalog gets its occasions for free.',
  },
  deadFormatRecovery: {
    kind: 'archive',
    strength: STRENGTH.STRONG,
    detection: DETECTION.AUTO,
    needs: ['archiveEvent'],
    question: 'did something come back from a format nobody can read any more?',
    copyFrame: 'this was a {Flash/DAT/Zip} file. it should not still work. it does',
    note: 'Recovery is inherently a story with stakes, and it is the one archive post that a design/dev audience and a music audience both care about.',
  },
  preservationMilestone: {
    kind: 'archive',
    strength: STRENGTH.WEAK,
    detection: DETECTION.AUTO,
    needs: ['archiveEvent'],
    question: 'did the archive cross a round number?',
    copyFrame: '{n} pieces of this scene are now permanent and public',
  },
};

/** Triggers that a machine may fire on its own. Everything else proposes to a
 * human first — and `neverAutomate` can never be promoted, whatever a future
 * config says. */
export function automatable() {
  return Object.entries(TRIGGERS)
    .filter(([, t]) => !t.neverAutomate && (t.detection === DETECTION.AUTO || t.detection === DETECTION.SCAN))
    .map(([k]) => k);
}

/** What is buildable today vs what is waiting on data nobody has wired. */
export function coverage() {
  const all = Object.entries(TRIGGERS);
  const group = (d) => all.filter(([, t]) => t.detection === d).map(([k]) => k);
  return {
    live: ['anniversary'],
    readyWithLedger: group(DETECTION.AUTO).filter((k) => TRIGGERS[k].requiresLedger),
    readyWithScan: group(DETECTION.SCAN),
    blockedOnFeed: group(DETECTION.FEED),
    humanOnly: group(DETECTION.MANUAL),
  };
}
