# Underground Existence audio streaming and scrubbing remediation

**Status:** implementation-ready plan  
**Target repository:** `/Users/bballi/Documents/Repos/EditVideos/arweave-video-generator`  
**Primary implementation file:** `website/js/player.js`  
**Decision date:** 2026-09-08

## Executive decision

Harden the existing browser player around the two known range-capable Arweave gateways before building or operating a new audio delivery service.

This is the fastest path to the required outcome:

- mixes play through to their real end unless the listener pauses, stops, or selects another mix;
- waveform interaction seeks to the requested point and resumes from there;
- a transient gateway failure does not silently restart a mix from the beginning;
- an unavailable range source produces a truthful retry/error state instead of an invisible fallback to non-seekable playback.

Do **not** make the Cloudflare range proxy the first implementation step. It remains the appropriate phase-two fallback if the public range gateways cannot meet the acceptance tests below. The repository already contains a prototype at `mix-range-proxy/`, but deployment requires Cloudflare credentials and adds operational surface area. The current gateways already demonstrated valid byte-range responses for a live 176 MB mix on 2026-09-08.

## Problem statement

The public site is currently deployed at:

`https://gifsve3yhjjbsrhoxcwgdafgfxkwrtx5mfoatganuyh6isfk4v3q.arweave.net/Mgsqk3g6UhlE7risYYCmLdVozv1hXAmYDaYP5Eiq5Xc/index.html`

It uses `website/js/player.js` to route canonical `arweave.net/<txid>` mix URLs to:

1. `https://frostor.xyz/<txid>`
2. `https://arweave.fllstck.dev/<txid>`
3. the canonical `https://arweave.net/<txid>` URL as final fallback

The first two sources currently return HTTP `206 Partial Content`, `Content-Range`, and `Accept-Ranges: bytes` for the tested mix. The canonical fallback responded with a full-file HTTP `200` and did not honor the byte-range request within the test timeout. A full-file response may begin playback but cannot be treated as a seekable source.

The user-visible faults are mixes restarting after a few minutes and waveform scrubbing not changing the real playhead. The current recovery code explains both symptoms:

- a 15-second frozen-clock watchdog calls `setSrc()` on the current source, replacing the media resource while it is still recovering/buffering;
- recovery depends on `loadedmetadata` to restore `pendingSeekSec`, but does not verify that the media element is seekable or that the requested seek completed;
- a failing primary can be retried before an alternate is selected;
- failure can ultimately degrade to `arweave.net`, which is non-seekable for these bundled items;
- UI progress is painted immediately on waveform interaction, even when the media element has not successfully applied the seek.

## Non-negotiable product contract

### Playback

1. A listener who presses Play receives continuous playback until the actual track end, an explicit pause/stop, a chosen track change, or an explicit visible error.
2. A transient buffer delay must not reset playback to time zero.
3. A gateway switch must resume within a small tolerance of the last confirmed time (target: within 2 seconds), once and only once per failed source.
4. The player must never automatically present a track as playing when audio is stalled or failed.

### Scrubbing

1. Clicking or dragging any active waveform must request the corresponding absolute track time.
2. The visual playhead is provisional during drag, but must only become authoritative after `seeked` or a verified `currentTime` update.
3. A failed seek must restore the prior confirmed position and show a compact, actionable message.
4. A non-range source is not an acceptable source for a waveform-enabled track.

### Observability

Record structured, privacy-safe diagnostics in the browser console and a small in-page debug handle. For each source attempt capture:

- transaction ID (not a listener identifier);
- gateway hostname;
- event (`probe`, `loadstart`, `canplay`, `seeking`, `seeked`, `stalled`, `error`, `ended`, `recovery`);
- current time, requested seek time, and source attempt number;
- whether the source is confirmed range-capable.

Do not add listener tracking, cookies, or analytics as part of this fix.

## Scope and constraints

- Keep mix records canonical: `artists.json` and Firestore continue storing `https://arweave.net/<txid>` URLs.
- Keep the site static and Arweave-deployable. No server dependency is permitted for the phase-one player fix.
- Do not re-upload audio or change Arweave transaction IDs.
- Preserve mobile autoplay behavior: the first `audio.play()` must stay inside the direct user interaction path.
- Avoid arbitrary retry loops and avoid duplicate audio requests while another source is already usable.
- Work in the existing repository without overwriting its unrelated dirty working-tree changes.

## Recommended architecture

### Source policy

Treat the two range gateways as a per-track, per-session source pool. The canonical `arweave.net` URL remains the archival/download URL, but it is **not** a streaming fallback when waveform seeking is enabled.

Use a source state record per track:

```js
{
  txid,
  candidates: [
    { url, host, rangeConfirmed, failures, lastFailureAt, cooldownUntil },
    // second range gateway
  ],
  activeCandidateIndex,
  confirmedTime,
  pendingSeekTime,
  recoveryAttempts,
  playbackGeneration
}
```

`playbackGeneration` increments on an intentional track load or source replacement. Event handlers must ignore events belonging to an older generation.

### State machine

Implement an explicit state machine. The existing booleans (`playing`, `wantPlay`) are not enough to distinguish a requested play, active buffering, seek, recovery, and terminal failure.

```text
idle
  -> probing
  -> loading
  -> playing
  -> seeking
  -> playing

playing / seeking
  -> recovering (only after a verified source failure)
  -> loading next eligible range gateway
  -> playing

loading / recovering
  -> failed (no eligible range gateway)
```

The only paths that may intentionally reset to `0` are: a user selects a new track, a user presses previous while within the restart threshold, repeat-one, or a verified natural end.

## Implementation work breakdown

### Phase 0 — baseline and reproducibility

1. Preserve the current player file before editing; do not alter mix data.
2. Add a manual test matrix using at least:
   - one 60-minute current mix;
   - one 120-minute mix;
   - one mix with a previously problematic bundled ANS-104 transaction;
   - desktop Chromium and mobile Safari/Chrome where available.
3. Test each candidate URL with both:
   - `Range: bytes=0-127`
   - a bounded mid-file range derived from a known byte length.
4. Record status, `Content-Range`, `Accept-Ranges`, content type, redirects, and latency. A candidate may only enter the streaming pool after a `206` response with a coherent `Content-Range`.

### Phase 1 — replace opportunistic retries with verified source failover

1. Replace `RANGE_HOSTS`/`playbackUrls()` output with candidate objects, preserving source identity and eligibility.
2. Probe candidates with a short bounded range request. Do not treat a completed request without `206` plus `Content-Range` as range-capable.
3. Pick the fastest valid source. Cache the successful host in memory for the current session and transaction ID.
4. On `error`, failed `canplay`, or a genuinely prolonged stalled state, mark the active candidate unhealthy and move to the next untried eligible candidate.
5. Resume only from `confirmedTime`, not from an optimistic UI position.
6. Cap automatic recovery to one attempt per candidate per track session. Once exhausted, show `Playback connection failed — Retry` and retain the intended time for the retry action.
7. Remove automatic streaming fallback to raw `arweave.net`. Keep it for download links only.

### Phase 2 — make seeking real and observable

1. On waveform pointer down, save the pre-seek confirmed time and set `pendingSeekTime`.
2. During pointer movement, render a preview playhead only. Do not claim the media moved.
3. On pointer release, set `audio.currentTime = pendingSeekTime` once.
4. Listen for `seeking`, `seeked`, `timeupdate`, `waiting`, `stalled`, and `error`.
5. Accept a seek only when `seeked` fires and the resulting `currentTime` is within a small tolerance of the request. Then update `confirmedTime` and permanent waveform progress.
6. If the seek has not completed within a bounded timeout, fail over to the next eligible range source once, apply the requested position after metadata is available, and wait for a verified `seeked`.
7. If all sources fail, restore the last confirmed time/UI state and render a visible retry control. Never leave the waveform at an unplayed future position.
8. Verify `audio.seekable.length > 0` and that the requested time lies within a seekable range before offering success. If it is not seekable, fail the candidate.

### Phase 3 — make stall handling conservative

1. Do not reload merely because `currentTime` is unchanged for 15 seconds. Browsers can buffer, throttle, or delay events without a terminal fault.
2. Require a combination of conditions before recovery: listener intent to play, no intentional seek in progress, no current progress, and a media event/state such as `waiting`/`stalled` or `readyState < HAVE_FUTURE_DATA` for a sustained window.
3. Before replacing a source, capture the current confirmed time and increment `playbackGeneration`.
4. During source replacement, wait for metadata and a usable seekable range before setting `currentTime`; then wait for `seeked`/`canplay` before calling `play()`.
5. Make stale events harmless by checking the active generation/source URL in every asynchronous callback.
6. Treat premature `ended` as a recovery candidate only when an expected duration is known and the confirmed time is materially before its end. Do not recursively reload the same source forever.

### Phase 4 — product feedback and accessibility

1. Add a small status region in the persistent player: `Buffering`, `Reconnecting`, `Seeking`, or `Playback unavailable`.
2. Announce state changes with an accessible live region without narrating every `timeupdate`.
3. Disable or visually mark waveform seeking only when no range-capable source exists; provide `Retry` and `Download` actions.
4. Keep keyboard interaction intact: visible focus states, Space/Enter playback, and a keyboard-reachable seek control if the custom canvas itself is not sufficient.

### Phase 5 — tests

Create focused, deterministic tests around source selection and recovery. Do not depend on live gateways for unit tests.

1. Extract source policy and state transitions into a testable module.
2. Mock `HTMLAudioElement` events and verify:
   - initial source selection chooses a valid range candidate;
   - an error moves to the next candidate without resetting confirmed time;
   - the raw `arweave.net` source is never used for interactive playback;
   - a seek resolves only after `seeked` near the requested time;
   - a failed seek fails over once, then shows a terminal retry state;
   - stale `loadedmetadata`, `ended`, and `error` events cannot mutate a newer load;
   - watchdog logic does not reset healthy slow-buffering playback;
   - a verified natural end advances according to repeat/shuffle policy.
3. Add a manual browser test page or debug query flag that displays active host, `currentTime`, duration, seekable ranges, `readyState`, and last recovery reason.

## Acceptance criteria

Claude must not mark this complete until all of the following pass.

### Playback continuity

- [ ] A 60-minute mix plays for at least 10 continuous minutes in a normal desktop browser without reset, manual interaction, or a false terminal state.
- [ ] A 120-minute mix plays continuously for at least 10 minutes under the same conditions.
- [ ] Forced primary-gateway failure resumes from within 2 seconds of last confirmed time on the alternate gateway.
- [ ] Failure of both range gateways shows a visible retry/error state; it does not start from zero or silently use a non-seekable source.

### Seeking

- [ ] Clicking at 25%, 50%, and 75% on the waveform moves actual `audio.currentTime` to within 2 seconds of the corresponding expected time.
- [ ] Dragging the waveform previews during drag and commits exactly one final seek on release.
- [ ] Seeking works after at least five minutes of playback and after a simulated source failover.
- [ ] Failed seeking restores the last confirmed playhead rather than leaving misleading UI progress.

### Regression and deploy safety

- [ ] Existing queue, repeat, shuffle, download, featured mix, and mobile user-gesture playback still work.
- [ ] Static files remain root-relative/host-agnostic for Arweave path-manifest deploys.
- [ ] Unit tests and manual test results are documented in the PR/hand-off.
- [ ] The generated website is verified locally and via the raw new Arweave manifest URL before the GoDaddy forward is changed.

## Rollout plan

1. Implement and test locally at the static build server.
2. Commit only the player, extracted tests, and concise documentation; do not include unrelated working-tree changes.
3. Deploy a new Arweave manifest.
4. Test the raw manifest URL for playback, seeks, explicit failure states, and all asset paths.
5. Only after passing, update the GoDaddy forward to the new manifest URL.
6. Monitor the first day for gateway-specific failure counts from the local debug signal/console reports. If one gateway repeatedly fails, demote or remove it from candidates.

## Escalation path: dedicated range proxy

Move to the existing `mix-range-proxy/` Cloudflare Worker only if phase one fails its continuity or seek acceptance criteria across the supported browsers, or if range gateway reliability is consistently poor.

The worker would offer one stable `/mix/<txid>` browser endpoint, translate open-ended browser media requests into bounded upstream range requests, and return correct `206`/`Content-Range` responses. That reduces dependence on public gateways but introduces Cloudflare credentials, deployment, monitoring, request limits, and egress/cost ownership. It is a reliability upgrade, not the quickest repair.

## HyperBEAM PR #1108 assessment

HyperBEAM [PR #1108](https://github.com/permaweb/HyperBEAM/pull/1108) was merged into `edge` on 2026-08-29. It enables HyperBEAM to read/cache remote LMDB index pages from Arweave using chunk/range reads. It improves node/index retrieval architecture, but it does **not** create a browser-facing HTTP audio proxy, alter current public gateway byte-range behavior, or fix this JavaScript player’s source reload and seek-verification behavior.

Do not block this remediation on HyperBEAM adoption. Re-evaluate it only if Underground Existence later operates its own HyperBEAM/Arweave serving layer.

## Claude assignment prompt

> Implement the phase-one remediation in `/Users/bballi/Documents/Repos/EditVideos/arweave-video-generator` following `docs/plans/UNDERGROUND_EXISTENCE_AUDIO_STREAMING_REMEDIATION_MASTER_PLAN.md` from the Bballi Portfolio workspace. Work only on the public static-site player and its tests/docs. Preserve canonical Arweave URLs in data and do not re-upload media. Do not use raw `arweave.net` as an interactive streaming fallback. Build a verified state machine for range-gateway selection, source failover, and waveform seeking; add tests for stale events, recovery, and seek verification; run the required local manual checks. Do not deploy to Arweave or change the GoDaddy forward. Return a concise change summary, test evidence, remaining risks, and the exact files changed.

## First action

Extract the gateway/source policy and playback state transitions from `website/js/player.js` into a testable module, then write failing tests for: source failover retaining confirmed position, no raw-gateway interactive fallback, and waveform seek confirmation.
