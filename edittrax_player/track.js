// ===========================================================================
// EDITTRAX PLAYER — TRACK CONFIG (TEMPLATE)
// ---------------------------------------------------------------------------
// Fill this file to turn the generic player into a specific track player.
//
//   1. Drop your sliced loop files into ./audio/  (16-bit PCM WAV — see README).
//   2. Set `bpm` to the track tempo.
//   3. Add one `parts` entry per loop segment:
//        { file: "audio/seg.1.wav", length: <bars>, loop: 1 }
//        - file   : path to the loop, relative to index.html
//        - length : musical length of the segment in BARS (integer)
//        - loop   : default repeat count (0 = skip, 1 = play once, >1 = repeat)
//   4. Each `presets` array is a list of loop counts, ONE PER PART
//      (presets.length maps to the PREVIEW / FULL / EXTENDED / ZERO buttons).
//      Every preset array length MUST equal parts.length.
//   5. Set `downloadName` to the exported file name.
//
// SEAMLESS LOOPS: use WAV (not MP3) for any segment that may loop (loop > 1) —
// MP3 encoder padding causes clicks. Cut segments on exact bar boundaries.
// ===========================================================================

const trackDir = "";
const bpm = 120; // TODO: set to your track's BPM

const parts = [
    // TODO: add your loop segments, e.g.
    // { file: "audio/seg.1.wav", length: 4, loop: 1 },
    // { file: "audio/seg.2.wav", length: 4, loop: 1 },
];

// Presets are generated from parts so their lengths always stay valid.
// Replace with hand-authored patterns once parts are defined, e.g.
//   presets.push([0,0,1,1, ...]);  // must be parts.length long
const presets = [];
presets.push(parts.map(() => 0)); // 0: PREVIEW  (all off — customize)
presets.push(parts.map(() => 1)); // 1: FULL     (all on)
presets.push(parts.map(() => 2)); // 2: EXTENDED (all doubled)
presets.push(parts.map(() => 0)); // 3: ZERO     (all off)

// --- loader status DOM (leave as-is; the loading screen depends on these) ---
const svgElement2 = document.getElementById('statusScriptIcon');
const newSvgContent2 = `
<circle cx="20" cy="20" r="18" stroke="#CEC6B3" stroke-width="4" fill="#576B68" />
<path d="M13 20 l5 5 l10 -10" stroke="#CEC6B3" stroke-width="4" fill="none" />`;

document.getElementById("statusScript").innerHTML = "Visual Assets Loaded";
document.getElementById('statusScript').style.color = '#576B68';
svgElement2.innerHTML = newSvgContent2;

const downloadName = "EDITTRAX_EDIT.wav"; // TODO: set exported file name
const boxHeight = 60; // min 40 — smaller makes loop buttons too small to tap
const reverseScrolling = false;
