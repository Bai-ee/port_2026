"""Phase 1/B — analysis backend.

Ingests a continuous stereo track, estimates BPM/beat grid via librosa +
Essentia RhythmExtractor2013, and detects true downbeats via Beat This!
(ISMIR 2024 - see PHASE_A_REPORT.md), cross-checked against an independent
audio-feature phase ranking (backend/downbeat.py). Falls back to a heuristic
grid (no madmom/BeatNet available on this interpreter, see PHASE0_REPORT.md)
only if Beat This! itself fails at runtime. Writes analysis.json.
"""
import argparse
import json
import warnings
from pathlib import Path

import essentia.standard as es
import librosa
import numpy as np
import soundfile as sf

import downbeat as downbeat_mod

DEFAULT_METER = 4  # beats per bar, 4/4 assumed unless overridden
BPM_DISAGREEMENT_WARN = 1.0  # bpm delta between analyzers that triggers a warning
DRIFT_CV_CONSTANT = 0.015   # beat-interval coefficient of variation below this = "constant"
DRIFT_CV_DRIFTED = 0.04     # above this = "tempo-drifted"
HOP_LENGTH = 512            # matches downbeat.py's rank_downbeat_phases default
SPURIOUS_BEAT_WARN_RATIO = 0.15  # warn when more than this fraction of beat intervals are spurious
BEAT_REJECT_MIN_PERIOD_RATIO = 0.5  # drop a beat closer than this * robust-period to the previous kept beat
REGION_ACTIVE_RMS_RATIO = 0.08  # frame RMS below this fraction of the track's own peak RMS counts as inactive/silence
REGION_MIN_SUSTAIN_SECONDS = 0.25  # an active stretch shorter than this is a blip/noise-floor tick, not real content
REGION_ORIGIN_TOLERANCE_SECONDS = 0.05  # a downbeat this close to (or after) the detected region start still counts as "inside" it


def load_audio(path):
    data, sr = sf.read(path, always_2d=True, dtype="float32")
    stereo = data if data.shape[1] >= 2 else np.repeat(data, 2, axis=1)
    mono = np.mean(stereo, axis=1).astype(np.float32)
    return stereo, mono, sr


def analyze_librosa(mono, sr):
    tempo, beat_frames = librosa.beat.beat_track(y=mono, sr=sr, units="frames")
    beat_times = librosa.frames_to_time(beat_frames, sr=sr)
    tempo_val = float(tempo[0]) if hasattr(tempo, "__len__") else float(tempo)
    return {"bpm": tempo_val, "beat_times": beat_times.tolist()}


def analyze_essentia(mono):
    extractor = es.RhythmExtractor2013(method="multifeature")
    bpm, ticks, confidence, estimates, bpm_intervals = extractor(mono)
    return {
        "bpm": float(bpm),
        "beat_times": [float(t) for t in ticks],
        "confidence": float(confidence),
        "bpm_intervals": [float(x) for x in bpm_intervals],
    }


def beat_interval_stats(beat_times):
    if len(beat_times) < 3:
        return {"mean_interval": None, "cv": None}
    intervals = np.diff(beat_times)
    mean = float(np.mean(intervals))
    std = float(np.std(intervals))
    cv = std / mean if mean > 0 else None
    return {"mean_interval": mean, "cv": cv}


def robust_beat_period(beat_times, tolerance=0.15, passes=2):
    """Outlier-resistant beat period from an inter-beat-interval list that may
    contain a large fraction of spurious (too-fast) beats. Start from the
    median interval (already majority-robust since a spurious burst is, by
    construction, a minority of the track), then refine 1-2 passes by
    re-taking the median of only the intervals within +-tolerance of the
    current estimate. Returns (period_seconds, spurious_ratio) where
    spurious_ratio is the fraction of intervals that fell outside the final
    refined band. (None, 0.0) if there aren't enough beats to measure."""
    beat_times = np.asarray(beat_times, dtype=float)
    if len(beat_times) < 3:
        return None, 0.0
    intervals = np.diff(beat_times)
    if len(intervals) == 0:
        return None, 0.0
    period = float(np.median(intervals))
    kept = intervals
    for _ in range(passes):
        lo, hi = period * (1 - tolerance), period * (1 + tolerance)
        band = kept[(kept >= lo) & (kept <= hi)]
        if len(band) == 0:
            break
        period = float(np.median(band))
        kept = band
    spurious_ratio = 1.0 - (len(kept) / len(intervals))
    return period, float(spurious_ratio)


def reject_close_beats(beat_times, period, min_ratio=BEAT_REJECT_MIN_PERIOD_RATIO):
    """Given a robust period estimate, walk the beat list in order and drop any
    beat that lands closer than `min_ratio * period` to the previously KEPT
    beat. This collapses spurious bursts (extra beats inserted between real
    ones) down to a single clean pulse train, so downstream downbeat-phase
    ranking and offset/grid derivation see one beat per real pulse instead of
    the polluted list. Returns (clean_beat_times, n_rejected)."""
    beat_times = np.asarray(beat_times, dtype=float)
    if len(beat_times) == 0 or not period or period <= 0:
        return beat_times, 0
    min_gap = period * min_ratio
    kept = [beat_times[0]]
    for t in beat_times[1:]:
        if t - kept[-1] >= min_gap:
            kept.append(t)
    n_rejected = len(beat_times) - len(kept)
    return np.array(kept, dtype=float), n_rejected


def downbeats_are_sane(downbeats, period, meter, zero_tol=2, min_meter_fraction=0.6):
    """Gate on Beat This!'s downbeat list before trusting it for the grid
    origin. On real tracks the model has emitted degenerate downbeats (bar
    intervals of 0 or 1 beats, in bursts - seen alongside the spurious-beat
    pollution): measured against the robust beat period, a sane 4/4 downbeat
    list should have nearly every bar interval ~= meter beats long. Returns
    False when more than `zero_tol` bar intervals collapse to zero beats or
    fewer than `min_meter_fraction` of them are exactly `meter` beats."""
    downbeats = np.asarray(downbeats, dtype=float)
    if len(downbeats) < 3 or not period or period <= 0:
        return False
    beats_per_bar = np.round(np.diff(downbeats) / period).astype(int)
    if int(np.sum(beats_per_bar <= 0)) > zero_tol:
        return False
    good = int(np.sum(beats_per_bar == meter))
    return good / max(len(beats_per_bar), 1) >= min_meter_fraction


def _comb_filter_score(onset_env, sr, hop_length, period_seconds):
    """Score a candidate period by sampling onset_env on a grid of that
    period, maximised over phase (so a correct period scores high regardless
    of where the grid happens to start)."""
    if not period_seconds or period_seconds <= 0:
        return 0.0
    period_frames = period_seconds * sr / hop_length
    if period_frames < 1.0:
        return 0.0
    n_frames = len(onset_env)
    n_phases = int(np.clip(round(period_frames), 8, 48))
    best = 0.0
    for phase in np.linspace(0, period_frames, n_phases, endpoint=False):
        idx = np.round(np.arange(phase, n_frames, period_frames)).astype(int)
        idx = idx[(idx >= 0) & (idx < n_frames)]
        if len(idx) == 0:
            continue
        score = float(onset_env[idx].mean())
        if score > best:
            best = score
    return best


# Metrical relatives of a candidate tempo to cross-check via comb filter -
# resolves octave (x2/x0.5) and triplet/dotted (x1.5, x4/3, ...) ambiguity in
# the interval-derived period.
BPM_METRICAL_RELATIVES = {
    "1x": 1.0,
    "2x": 2.0,
    "0.5x": 0.5,
    "1.5x": 1.5,
    "1/1.5x": 2.0 / 3.0,
    "4/3x": 4.0 / 3.0,
    "3/4x": 0.75,
}


def _refine_bpm_peak(onset_env, sr, hop_length, anchor_bpm, window=0.06, coarse_step=0.2, fine_step=0.02):
    """Beat This!'s beat times are quantized to ~20ms output frames, so a bpm
    estimated from them (interval median, or a metrical relative of it) can
    sit a percent or two off the audio's true, sharply-peaked comb-filter
    optimum - scoring the anchor bpm verbatim can land in a trough right next
    to a real peak. Coarse-then-fine local search around the anchor finds
    that true nearby peak instead."""
    lo, hi = anchor_bpm * (1 - window), anchor_bpm * (1 + window)
    best_bpm = anchor_bpm
    best_score = _comb_filter_score(onset_env, sr, hop_length, 60.0 / anchor_bpm)
    for bpm in np.arange(lo, hi, coarse_step):
        score = _comb_filter_score(onset_env, sr, hop_length, 60.0 / bpm)
        if score > best_score:
            best_score, best_bpm = score, float(bpm)
    lo2, hi2 = max(lo, best_bpm - coarse_step), min(hi, best_bpm + coarse_step)
    for bpm in np.arange(lo2, hi2, fine_step):
        score = _comb_filter_score(onset_env, sr, hop_length, 60.0 / bpm)
        if score > best_score:
            best_score, best_bpm = score, float(bpm)
    return best_bpm, best_score


def score_bpm_candidates(onset_env, sr, hop_length, base_bpm, extra_bpms=None, agreement_tolerance=0.05):
    """Build candidates from base_bpm's metrical relatives (resolves
    octave/subdivision ambiguity in the interval-derived period) plus any
    extra independent tempo reads (essentia/librosa), refine each to its
    true nearby comb-filter peak, then rank them.

    Raw comb-filter magnitude alone is ambiguous between a tempo and its
    octave: a strong backbeat/downbeat accent can make the half-tempo grid
    (which only ever samples the stressed beats) score higher than the
    full-tempo grid, even though the full tempo is correct (verified on the
    project's reference track: the half-tempo relative out-scored the true
    tempo by ~9%). So a candidate that lands close to an independent
    (non-Beat-This) tempo read is preferred over raw score alone; only when
    nothing is corroborated does the raw comb-filter peak decide - this
    matches the rest of the module's pattern of treating cross-analyzer
    agreement as a confidence signal rather than trusting one score blindly."""
    extra_bpms = [b for b in (extra_bpms or []) if b and 30.0 <= b <= 300.0]

    anchors = {}
    for label, mult in BPM_METRICAL_RELATIVES.items():
        bpm = base_bpm * mult
        if 30.0 <= bpm <= 300.0:
            anchors.setdefault(round(bpm, 3), label)
    for bpm in extra_bpms:
        anchors.setdefault(round(bpm, 3), "cross_check")

    scored = []
    for anchor_bpm, label in anchors.items():
        refined_bpm, score = _refine_bpm_peak(onset_env, sr, hop_length, anchor_bpm)
        corroborated = any(abs(refined_bpm - xb) / xb <= agreement_tolerance for xb in extra_bpms)
        scored.append({
            "bpm": round(refined_bpm, 3),
            "relation": label,
            "score": round(score, 6),
            "corroborated": corroborated,
        })
    scored.sort(key=lambda c: (not c["corroborated"], -c["score"]))
    return scored


def detect_musical_region(mono, sr, hop_length=HOP_LENGTH,
                           active_ratio=REGION_ACTIVE_RMS_RATIO,
                           min_sustain_seconds=REGION_MIN_SUSTAIN_SECONDS):
    """Find where the track's real musical content actually starts and ends
    (owner requirement, 1e in ACCURATE_TEMPO_PLAN.md): a track can open with
    lead-in silence/ambience and fade out past its last real bar, and the
    grid origin/slicing bounds must not be naively pinned to sample 0 / the
    raw file end just because that's where the buffer happens to start/stop.

    Frame RMS is thresholded against a fraction of the track's own peak RMS
    (self-relative, so it works across masters at very different loudness),
    then only STRETCHES of activity at least `min_sustain_seconds` long
    count - a single loud transient in otherwise-silent lead-in shouldn't
    move the region boundary, only real sustained content should. Returns
    (region_start_seconds, region_end_seconds); falls back to
    (0.0, duration) - a full no-op - when nothing sustained is found (or the
    whole track is active), so a track with no meaningful silence is left
    untouched."""
    duration_seconds = len(mono) / sr if sr else 0.0
    if len(mono) == 0:
        return 0.0, duration_seconds

    rms = librosa.feature.rms(y=mono, hop_length=hop_length)[0]
    if len(rms) == 0:
        return 0.0, duration_seconds
    peak = float(np.max(rms))
    if peak <= 1e-9:
        return 0.0, duration_seconds

    active = rms >= (peak * active_ratio)
    sustain_frames = max(1, int(round(min_sustain_seconds * sr / hop_length)))

    runs = []
    run_start = None
    for idx, val in enumerate(active):
        if val and run_start is None:
            run_start = idx
        elif not val and run_start is not None:
            runs.append((run_start, idx))
            run_start = None
    if run_start is not None:
        runs.append((run_start, len(active)))

    sustained = [r for r in runs if (r[1] - r[0]) >= sustain_frames]
    if not sustained:
        return 0.0, duration_seconds

    start_frame, _ = sustained[0]
    _, end_frame = sustained[-1]
    region_start_seconds = float(librosa.frames_to_time(start_frame, sr=sr, hop_length=hop_length))
    region_end_seconds = float(librosa.frames_to_time(end_frame, sr=sr, hop_length=hop_length))
    region_start_seconds = max(0.0, min(region_start_seconds, duration_seconds))
    region_end_seconds = min(region_end_seconds, duration_seconds)
    return region_start_seconds, region_end_seconds


def select_grid_origin(downbeats, region_start_seconds, tolerance=REGION_ORIGIN_TOLERANCE_SECONDS):
    """Pick which downbeat becomes offset_samples (the slice grid's sample-0
    origin). Naively taking downbeats[0] pins the whole bar grid at whatever
    the model's very first detection happens to be, even inside detected
    lead-in silence/ambience (the "offset_samples = 0 question", 1e in
    ACCURATE_TEMPO_PLAN.md - a downbeat model can genuinely predict a
    downbeat at t=0.000s on a track that still opens with real silence).
    Prefers the first downbeat at or after the detected musical region
    start; falls back to downbeats[0] when it's already inside the region
    (the common case - a true no-op) or when nothing qualifies (safety net -
    the grid always gets an origin). Returns (origin_seconds, was_adjusted)."""
    if not downbeats:
        return None, False
    if downbeats[0] >= region_start_seconds - tolerance:
        return downbeats[0], False
    for t in downbeats:
        if t >= region_start_seconds - tolerance:
            return t, True
    return downbeats[0], False


def derive_downbeats(beat_times, meter):
    """Fallback-only heuristic bar grid, used when Beat This! itself errors at
    runtime: beat[0] is treated as beat-1-of-bar and every `meter`-th beat
    after it is a downbeat. This is a starting guess for manual correction in
    the UI, not a confident bar detection. See PHASE_A_REPORT.md - Beat This!
    is the primary downbeat source now, this is no longer the normal path."""
    if not beat_times:
        return []
    return beat_times[0::meter]


def detect_downbeats(path, mono, sr, essentia_beat_times, meter, onset_env,
                      hop_length=HOP_LENGTH, extra_bpm_candidates=None):
    """Beat This! is the primary downbeat source (Phase A). Its own downbeat
    choice is cross-checked against an independent audio-feature phase ranking
    (backend/downbeat.py) rather than trusted blindly - agreement is itself a
    confidence signal, surfaced in the report. Falls back to the Phase 0-era
    heuristic only if Beat This! errors (e.g. no network for the first-run
    checkpoint download).

    Beat This! can emit a beat list polluted with spurious extra beats (seen
    on real tracks: ~40% of intervals far too short, in bursts). Those beats
    would otherwise scramble both the tempo read (index-vs-time fit runs hot)
    and the downbeat phase ranking (the modulo-meter grouping no longer lines
    up with real beats). So: derive a robust period from the raw interval
    list first, use it to reject the spurious beats, and only then hand the
    cleaned pulse train to the phase ranking and the bpm comb-filter cross-
    check."""
    error = None
    try:
        beats, downbeats = downbeat_mod.detect_beats_and_downbeats_beat_this(path)
        source = "beat_this"
    except Exception as e:
        error = f"{type(e).__name__}: {e}"
        beats = np.array(essentia_beat_times, dtype=float)
        downbeats = np.array(derive_downbeats(essentia_beat_times, meter), dtype=float)
        source = "heuristic_fallback"

    beats = np.asarray(beats, dtype=float)
    downbeats = np.asarray(downbeats, dtype=float)

    period, spurious_ratio = robust_beat_period(beats)
    if period and len(beats) >= meter * 2:
        clean_beats, beats_rejected = reject_close_beats(beats, period)
    else:
        clean_beats, beats_rejected = beats, 0

    if source == "beat_this":
        selected_phase = downbeat_mod.selected_phase_from_downbeats(clean_beats, downbeats, meter)
    else:
        selected_phase = 0

    phase_candidates = (
        downbeat_mod.rank_downbeat_phases(mono, sr, clean_beats, meter)
        if len(clean_beats) >= meter * 2 else []
    )
    top_independent_phase = phase_candidates[0]["phase"] if phase_candidates else None
    phase_agreement = (
        top_independent_phase is not None and top_independent_phase == selected_phase
        if source == "beat_this" else None
    )

    # Downbeat sanity gate: when the model's downbeat list is degenerate,
    # discard it and synthesize the bar grid from the CLEANED pulse train at
    # the independently top-ranked phase. Without this, a junk downbeat list
    # silently becomes offset_samples (e.g. 0.0) and every loop starts off
    # the real downbeat even when the tempo is right.
    downbeat_grid = source
    if source == "beat_this" and len(clean_beats) >= meter * 2 and not downbeats_are_sane(downbeats, period, meter):
        fallback_phase = top_independent_phase if top_independent_phase is not None else 0
        downbeats = clean_beats[fallback_phase::meter]
        selected_phase = fallback_phase
        phase_agreement = None  # model grid discarded; agreement not meaningful
        downbeat_grid = "synthetic_phase_ranked"

    bpm_candidates = []
    bpm_method = "essentia_fallback"
    if period and source == "beat_this":
        base_bpm = 60.0 / period
        bpm_candidates = score_bpm_candidates(onset_env, sr, hop_length, base_bpm,
                                               extra_bpms=extra_bpm_candidates)
        bpm_method = "beat_interval_median_combfilter"

    return {
        "source": source,
        "error": error,
        "downbeat_grid": downbeat_grid,
        "beats_seconds": clean_beats.tolist(),
        "beats_seconds_raw": beats.tolist(),
        "beats_rejected": int(beats_rejected),
        "spurious_beat_ratio": spurious_ratio,
        "downbeats_seconds": downbeats.tolist(),
        "selected_phase": selected_phase,
        "phase_candidates": phase_candidates,
        "phase_agreement": phase_agreement,
        "bpm_candidates": bpm_candidates,
        "bpm_method": bpm_method,
    }


def classify(bpm_agreement_delta, cv, essentia_confidence, downbeat_info):
    warnings_out = []
    if bpm_agreement_delta is not None and bpm_agreement_delta > BPM_DISAGREEMENT_WARN:
        warnings_out.append(
            f"librosa/essentia BPM disagree by {bpm_agreement_delta:.2f} bpm (> {BPM_DISAGREEMENT_WARN})"
        )
    if cv is None:
        warnings_out.append("not enough beats detected to compute tempo stability")
        return "low_confidence_needs_manual_review", warnings_out
    if essentia_confidence is not None and essentia_confidence < 1.5:
        warnings_out.append(f"essentia beat confidence low ({essentia_confidence:.2f})")

    if downbeat_info["source"] == "heuristic_fallback":
        warnings_out.append(
            f"Beat This! unavailable at runtime ({downbeat_info['error']}) - fell back to heuristic "
            "downbeat (beat[0] + every Nth beat), confirm/nudge it in the UI before slicing"
        )
    elif downbeat_info.get("downbeat_grid") == "synthetic_phase_ranked":
        warnings_out.append(
            "Beat This!'s downbeat list was degenerate (irregular bar lengths vs the robust beat "
            "period) - bar grid was synthesized from the cleaned beats at the top-ranked phase; "
            "review downbeat placement before slicing"
        )
    elif downbeat_info["phase_agreement"] is False:
        warnings_out.append(
            "Beat This!'s chosen downbeat phase disagrees with the independent audio-feature "
            f"phase ranking (beat_this=phase {downbeat_info['selected_phase']}, "
            f"top-ranked={downbeat_info['phase_candidates'][0]['phase']}) - review downbeat "
            "placement in the UI before slicing"
        )

    if cv >= DRIFT_CV_DRIFTED:
        return "tempo_drifted_needs_warp_or_stretch", warnings_out
    if essentia_confidence is not None and essentia_confidence < 1.0:
        return "low_confidence_needs_manual_review", warnings_out

    if downbeat_info["source"] == "beat_this" and downbeat_info["phase_agreement"]:
        return "high_confidence_downbeat_detected", warnings_out
    return "likely_constant_needs_manual_downbeat_correction", warnings_out


def apply_grid_override(analysis, phase_override=None, offset_nudge_samples=0, bpm_override=None):
    """Recompute the downbeat grid from already-detected beats (no re-running
    Beat This!/essentia/librosa) - backs the UI's phase-candidate selector and
    offset-nudge controls, and the spec's update_grid(offset/phase/...) API.

    bpm_override, when a positive number, replaces bpm_final with a manually
    supplied tempo (e.g. the user overriding an automated read in the UI);
    None leaves bpm_final untouched."""
    meter = analysis["meter"]
    sr = analysis["sample_rate"]
    beats = analysis.get("beats_seconds") or []

    if phase_override is not None and beats:
        downbeats = beats[phase_override::meter]
        selected_phase = phase_override
    else:
        downbeats = analysis.get("model_downbeat_times_seconds") or analysis["downbeat_times_seconds"]
        selected_phase = analysis.get("model_downbeat_selected_phase", analysis["downbeat_selected_phase"])

    offset_samples = (int(round(downbeats[0] * sr)) if downbeats else 0) + int(offset_nudge_samples)

    updated = dict(analysis)
    updated["downbeat_times_seconds"] = downbeats
    updated["offset_samples"] = offset_samples
    updated["downbeat_selected_phase"] = selected_phase
    updated["manual_offset_nudge_samples"] = int(offset_nudge_samples)
    if bpm_override is not None and float(bpm_override) > 0:
        updated["bpm_final"] = float(bpm_override)
        updated["manual_bpm_override"] = float(bpm_override)
        # An explicit manual number isn't "contested" in the amber-hero
        # sense - that's for an automated read the analyzers disagree on.
        updated["bpm_contested"] = False
    else:
        # Clearing the field must undo a previous override. bpm_final is
        # persisted back to analysis.json, so without this the manual value
        # would stick until the track was analyzed again.
        updated["bpm_final"] = analysis.get("bpm_detected", analysis["bpm_final"])
        updated.pop("manual_bpm_override", None)
        updated["bpm_contested"] = analysis.get("bpm_contested_detected", analysis.get("bpm_contested"))
    return updated


def analyze_track(path, meter=DEFAULT_METER):
    path = Path(path)
    stereo, mono, sr = load_audio(path)

    lib = analyze_librosa(mono, sr)
    ess = analyze_essentia(mono)

    bpm_delta = abs(lib["bpm"] - ess["bpm"])
    interval_stats = beat_interval_stats(ess["beat_times"])

    onset_env = librosa.onset.onset_strength(y=mono, sr=sr, hop_length=HOP_LENGTH)
    # librosa.feature.rhythm.tempo does NOT exist in this librosa version;
    # librosa.beat.tempo does - used here purely as an extra cross-check
    # candidate for the comb-filter bpm selection below.
    try:
        librosa_global_tempo = float(
            librosa.beat.tempo(onset_envelope=onset_env, sr=sr, hop_length=HOP_LENGTH)[0]
        )
    except Exception:
        librosa_global_tempo = None
    extra_bpm_candidates = [b for b in (ess["bpm"], lib["bpm"], librosa_global_tempo) if b]

    region_start_seconds, region_end_seconds = detect_musical_region(mono, sr, hop_length=HOP_LENGTH)

    downbeat_info = detect_downbeats(
        path, mono, sr, ess["beat_times"], meter, onset_env,
        hop_length=HOP_LENGTH, extra_bpm_candidates=extra_bpm_candidates,
    )
    downbeats = downbeat_info["downbeats_seconds"]
    origin_seconds, region_adjusted_offset = select_grid_origin(downbeats, region_start_seconds)
    offset_samples = int(round(origin_seconds * sr)) if origin_seconds is not None else 0

    classification, warns = classify(bpm_delta, interval_stats["cv"], ess["confidence"], downbeat_info)
    if region_adjusted_offset:
        warns.append(
            f"grid origin shifted from the model's first downbeat ({downbeats[0]:.3f}s) to "
            f"{origin_seconds:.3f}s - the first downbeat inside the detected musical region "
            f"(region starts {region_start_seconds:.3f}s; lead-in before that was excluded)"
        )

    # bpm_final: a robust median-interval period (resistant to Beat This!
    # emitting spurious extra beats - seen in bursts on real tracks, up to
    # ~40% of intervals) cross-checked against onset-strength via comb filter
    # across its metrical relatives (x2, /2, x1.5, /1.5, x4/3, x3/4) plus
    # essentia/librosa's own tempo reads, to resolve octave/subdivision
    # errors. Falls back to essentia's tempo when Beat This! itself is
    # unavailable or there aren't enough beats to derive a period.
    if downbeat_info["bpm_candidates"]:
        best_candidate = downbeat_info["bpm_candidates"][0]
        bpm_final = best_candidate["bpm"]
        bpm_method = downbeat_info["bpm_method"]
        if abs(bpm_final - ess["bpm"]) > BPM_DISAGREEMENT_WARN and best_candidate["relation"] != "1x":
            warns.append(
                f"bpm_final ({bpm_final:.2f}) selected the {best_candidate['relation']} metrical "
                "relative of the raw interval-derived tempo via onset comb-filter cross-check "
                f"(essentia reported {ess['bpm']:.2f}) - confirm tempo before trusting the slice grid"
            )
    else:
        bpm_final = ess["bpm"]
        bpm_method = downbeat_info["bpm_method"]

    # bpm_contested: the winning candidate has no cross-analyzer corroboration
    # (essentia/librosa don't independently agree with it), so the number the
    # hero would show is a single-source read rather than a consensus one.
    # Supersedes the plan's original "cluster with >=2 independent
    # supporters" wording per the 1c correction - candidates now carry a
    # single per-candidate `corroborated` flag rather than cluster counts, so
    # "is the SELECTED candidate corroborated" is the equivalent check
    # against the shipped data model. Falls back to the raw librosa/essentia
    # delta when Beat This! itself was unavailable (no bpm_candidates at all).
    if downbeat_info["bpm_candidates"]:
        bpm_contested = not downbeat_info["bpm_candidates"][0]["corroborated"]
    else:
        bpm_contested = bpm_delta is not None and bpm_delta > BPM_DISAGREEMENT_WARN

    if downbeat_info["spurious_beat_ratio"] and downbeat_info["spurious_beat_ratio"] > SPURIOUS_BEAT_WARN_RATIO:
        warns.append(
            f"{downbeat_info['spurious_beat_ratio'] * 100:.0f}% of raw beat intervals were spurious "
            f"(rejected {downbeat_info['beats_rejected']} of {len(downbeat_info['beats_seconds_raw'])} "
            "beats before computing tempo/downbeat phase) - review the grid before slicing"
        )

    result = {
        "source_path": str(path),
        "sample_rate": sr,
        "channels": stereo.shape[1],
        "duration_seconds": stereo.shape[0] / sr,
        "meter": meter,
        "bpm_final": bpm_final,
        # The automatic read, kept so a manual override can be undone without
        # re-running inference (update_grid persists bpm_final in place).
        "bpm_detected": bpm_final,
        "bpm_method": bpm_method,
        "bpm_candidates": downbeat_info["bpm_candidates"],
        "bpm_contested": bpm_contested,
        # kept alongside bpm_contested so a later manual bpm_override can be
        # undone (apply_grid_override) without re-running inference - same
        # pattern as bpm_detected/bpm_final.
        "bpm_contested_detected": bpm_contested,
        "spurious_beat_ratio": downbeat_info["spurious_beat_ratio"],
        "beats_rejected": downbeat_info["beats_rejected"],
        "offset_samples": offset_samples,
        "region_start_seconds": region_start_seconds,
        "region_end_seconds": region_end_seconds,
        "region_adjusted_offset": region_adjusted_offset,
        "analyzers": {
            "librosa": lib,
            "essentia": ess,
        },
        "analyzer_comparison": {
            "bpm_delta": bpm_delta,
            "beat_interval_mean_seconds": interval_stats["mean_interval"],
            "beat_interval_cv": interval_stats["cv"],
            "essentia_beat_confidence": ess["confidence"],
        },
        "downbeat_source": downbeat_info["source"],
        "downbeat_grid": downbeat_info.get("downbeat_grid", downbeat_info["source"]),
        "downbeat_source_error": downbeat_info["error"],
        "downbeat_selected_phase": downbeat_info["selected_phase"],
        "model_downbeat_selected_phase": downbeat_info["selected_phase"],
        "downbeat_phase_agreement": downbeat_info["phase_agreement"],
        "downbeat_phase_candidates": downbeat_info["phase_candidates"],
        "beats_seconds": downbeat_info["beats_seconds"],
        "downbeat_times_seconds": downbeats,
        "model_downbeat_times_seconds": downbeats,
        "classification": classification,
        "warnings": warns,
    }
    return result


def main():
    parser = argparse.ArgumentParser(description="Analyze a track's BPM/beat/bar grid.")
    parser.add_argument("--wav", required=True, help="Path to source stereo WAV")
    parser.add_argument("--out", default="outputs/analysis.json", help="Output analysis.json path")
    parser.add_argument("--meter", type=int, default=DEFAULT_METER, help="Beats per bar (default 4)")
    args = parser.parse_args()

    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        result = analyze_track(args.wav, meter=args.meter)

    out_path = Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(result, indent=2))

    print(f"bpm_final={result['bpm_final']:.2f} "
          f"librosa={result['analyzers']['librosa']['bpm']:.2f} "
          f"essentia={result['analyzers']['essentia']['bpm']:.2f} "
          f"classification={result['classification']}")
    for w in result["warnings"]:
        print(f"WARNING: {w}")
    print(f"wrote {out_path}")


if __name__ == "__main__":
    main()
