"""Phase 3 — verification.

For every exported loop: measure end-to-start loopability (the hard case —
does repeating this segment forever click?), adjacent back-to-back continuity
(the easy case — should always be near-perfect since loops are contiguous
slices of one buffer), transient proximity to the wrap point, and harmonic
(chroma) similarity between the loop's start and end. Classifies pass/warn/fail
and renders audition files.
"""
import argparse
import json
from pathlib import Path

import librosa
import numpy as np
import soundfile as sf

# thresholds — POC-level heuristics, documented here rather than hidden
LOOPABILITY_FAIL_Z = 6.0
LOOPABILITY_WARN_Z = 3.0
TRANSIENT_FAIL_MS = 15.0
TRANSIENT_WARN_MS = 50.0
CHROMA_WARN_SIMILARITY = 0.5
LOCAL_WINDOW_SAMPLES = 512
DEAD_SPACE_WINDOW_MS = 50.0
DEAD_SPACE_RMS_RATIO = 0.1  # window RMS below this fraction of the loop's overall RMS = dead space
TRANSIENT_SOURCE_CONTEXT_SECONDS = 0.5  # padding on each side of a boundary sample when checking the SOURCE for real onsets
TRANSIENT_EXCLUDE_RADIUS_SAMPLES = 512  # onset-detector frame-scale: an onset this close to the boundary IS the boundary's own expected downbeat, not a competing transient


def mono(stereo):
    return np.mean(stereo, axis=1)


def local_jump_zscore(mono_sig, boundary_idx_a, boundary_idx_b, window=LOCAL_WINDOW_SAMPLES):
    """z-score of the jump between two (possibly non-adjacent) sample indices,
    relative to the typical sample-to-sample delta near those points."""
    jump = abs(float(mono_sig[boundary_idx_a]) - float(mono_sig[boundary_idx_b]))
    lo = mono_sig[max(0, boundary_idx_a - window):boundary_idx_a]
    hi = mono_sig[boundary_idx_b:boundary_idx_b + window]
    local = np.concatenate([lo, hi]) if len(lo) and len(hi) else (lo if len(lo) else hi)
    if len(local) < 2:
        return 0.0, jump
    local_std = float(np.std(np.diff(local))) + 1e-9
    return jump / local_std, jump


def nearest_onset_ms(mono_sig, sr, target_sample):
    # Isolated-loop-file fallback only (used when the source track can't be
    # read - see nearest_onset_ms_in_source, the primary path since the 3a
    # fix). Kept for that fallback: onset detection on the isolated file's
    # own hard edges is a known-biased measurement (see below), not a
    # general-purpose transient check.
    if len(mono_sig) < 2048:
        return None
    onset_frames = librosa.onset.onset_detect(y=mono_sig, sr=sr, units="samples")
    if len(onset_frames) == 0:
        return None
    distances = np.abs(onset_frames - target_sample)
    return float(np.min(distances) / sr * 1000.0)


def nearest_onset_ms_in_source(source_mono, sr, target_sample,
                                context_seconds=TRANSIENT_SOURCE_CONTEXT_SECONDS,
                                exclude_radius_samples=TRANSIENT_EXCLUDE_RADIUS_SAMPLES):
    """Fixed transient metric (3a, ACCURATE_TEMPO_PLAN.md required item).

    Onset detection for wrap-point risk now runs against the SOURCE track
    with real audio context on both sides of the boundary, not the isolated
    cut loop file. The isolated file's own hard start/end edges are
    themselves spectral-flux discontinuities librosa reads as a spurious
    onset right at frame 0/-1 regardless of content - measured, every loop
    read an identical ~9.6ms "transient near wrap" before this fix (the sole
    driver of every warn/fail), which is a property of our own cut, not the
    music.

    A bar-aligned cut is usually placed exactly ON a real onset (the
    downbeat itself, often the loudest hit in the bar) - so even a correct,
    source-context measurement would otherwise flag the very thing that
    makes the cut good ("a clean bar-aligned cut must NOT be flagged just
    because the slicer cut there" - plan acceptance criterion).
    exclude_radius_samples drops any onset within one onset-detector frame of
    the boundary sample before measuring distance: that onset IS the
    boundary's own expected downbeat, not a competing transient the cut
    would truncate. What remains is distance to the nearest OTHER transient
    nearby - the case that's actually risky (something building up or
    trailing off right where we cut, that repeating the loop would chop)."""
    n_total = len(source_mono)
    if n_total == 0:
        return None
    context_samples = int(round(context_seconds * sr))
    win_start = max(0, target_sample - context_samples)
    win_end = min(n_total, target_sample + context_samples)
    window = source_mono[win_start:win_end]
    if len(window) < 2048:
        return None
    onset_frames = librosa.onset.onset_detect(y=window, sr=sr, units="samples")
    if len(onset_frames) == 0:
        return None
    onset_samples_abs = onset_frames + win_start
    distances = np.abs(onset_samples_abs - target_sample)
    if exclude_radius_samples:
        distances = distances[distances > exclude_radius_samples]
    if len(distances) == 0:
        return None
    return float(np.min(distances) / sr * 1000.0)


def dead_space_risk(mono_sig, sr, window_ms=DEAD_SPACE_WINDOW_MS):
    """Near-silence at a loop boundary reads as a gap/stumble even without a
    click. Compares start/end window RMS against the loop's overall RMS."""
    n = len(mono_sig)
    window = min(int(sr * window_ms / 1000), n // 4) or 1
    overall_rms = float(np.sqrt(np.mean(mono_sig.astype(np.float64) ** 2))) + 1e-9
    start_rms = float(np.sqrt(np.mean(mono_sig[:window].astype(np.float64) ** 2)))
    end_rms = float(np.sqrt(np.mean(mono_sig[-window:].astype(np.float64) ** 2)))
    start_ratio = start_rms / overall_rms
    end_ratio = end_rms / overall_rms
    return {
        "start_ratio": start_ratio,
        "end_ratio": end_ratio,
        "start_is_dead_space": start_ratio < DEAD_SPACE_RMS_RATIO,
        "end_is_dead_space": end_ratio < DEAD_SPACE_RMS_RATIO,
    }


def recommend_repair(loopability_z, dead_space, transient_ms, track_classification):
    """Rule-based, explicit per spec: never silently pick a repair. warp is
    only ever suggested for tempo-drifted tracks, never as a default click fix."""
    if dead_space["start_is_dead_space"] or dead_space["end_is_dead_space"]:
        return "silence_trim"
    if track_classification == "tempo_drifted_needs_warp_or_stretch":
        return "warp"
    if loopability_z >= LOOPABILITY_FAIL_Z:
        return "equal_power_crossfade"
    if loopability_z >= LOOPABILITY_WARN_Z:
        return "zero_cross_snap"
    if transient_ms is not None and transient_ms < TRANSIENT_WARN_MS:
        # timing-sensitive case (spec: prefer microfade over boundary shifting
        # when a transient sits right at the wrap point)
        return "microfade"
    return "none"


def chroma_similarity(mono_sig, sr, window=2048):
    if len(mono_sig) < window * 2:
        return None
    start_win = mono_sig[:window]
    end_win = mono_sig[-window:]
    c_start = np.mean(librosa.feature.chroma_stft(y=start_win, sr=sr), axis=1)
    c_end = np.mean(librosa.feature.chroma_stft(y=end_win, sr=sr), axis=1)
    denom = (np.linalg.norm(c_start) * np.linalg.norm(c_end)) + 1e-9
    return float(np.dot(c_start, c_end) / denom)


def classify(loopability_z, transient_ms, chroma_sim):
    reasons = []
    if loopability_z >= LOOPABILITY_FAIL_Z:
        reasons.append(f"end-to-start jump z-score {loopability_z:.1f} >= fail threshold {LOOPABILITY_FAIL_Z}")
    if transient_ms is not None and transient_ms < TRANSIENT_FAIL_MS:
        reasons.append(f"transient {transient_ms:.1f}ms from wrap point (< {TRANSIENT_FAIL_MS}ms)")
    if reasons:
        return "fail", reasons

    if loopability_z >= LOOPABILITY_WARN_Z:
        reasons.append(f"end-to-start jump z-score {loopability_z:.1f} >= warn threshold {LOOPABILITY_WARN_Z}")
    if transient_ms is not None and transient_ms < TRANSIENT_WARN_MS:
        reasons.append(f"transient {transient_ms:.1f}ms from wrap point (< {TRANSIENT_WARN_MS}ms)")
    if chroma_sim is not None and chroma_sim < CHROMA_WARN_SIMILARITY:
        reasons.append(f"chroma similarity {chroma_sim:.2f} < {CHROMA_WARN_SIMILARITY} (start/end may clash harmonically)")
    if reasons:
        return "warn", reasons
    return "pass", []


def verify_loop(loop_info, sr, bars_per_loop=None, bpm=None, meter=None, track_classification=None,
                 prev_delta=None, next_delta=None, downbeat_candidate_used=None, source_mono=None):
    stereo, file_sr = sf.read(loop_info["path"], always_2d=True, dtype="float32")
    assert file_sr == sr
    sig = mono(stereo)
    n = len(sig)

    loop_z, loop_jump = local_jump_zscore(sig, n - 1, 0)
    if source_mono is not None:
        start_transient_ms = nearest_onset_ms_in_source(source_mono, sr, loop_info["start_sample"])
        end_transient_ms = nearest_onset_ms_in_source(source_mono, sr, loop_info["end_sample"])
        transient_metric_source = "source_context"
    else:
        start_transient_ms = nearest_onset_ms(sig, sr, 0)
        end_transient_ms = nearest_onset_ms(sig, sr, n - 1)
        transient_metric_source = "isolated_fallback"
    transient_ms = min(
        [t for t in (start_transient_ms, end_transient_ms) if t is not None], default=None
    )
    chroma_sim = chroma_similarity(sig, sr)
    dead_space = dead_space_risk(sig, sr)

    verdict, reasons = classify(loop_z, transient_ms, chroma_sim)
    repair_rec = recommend_repair(loop_z, dead_space, transient_ms, track_classification)

    expected_duration_seconds = None
    if bars_per_loop and bpm and meter:
        expected_duration_seconds = bars_per_loop * meter * 60.0 / bpm

    return {
        "index": loop_info["index"],
        "path": loop_info["path"],
        "start_sample": loop_info["start_sample"],
        "end_sample": loop_info["end_sample"],
        "start_time_seconds": loop_info["start_sample"] / sr,
        "end_time_seconds": loop_info["end_sample"] / sr,
        "bars": bars_per_loop,
        "downbeat_candidate_used": downbeat_candidate_used,
        "duration_samples": loop_info["duration_samples"],
        "duration_seconds": loop_info["duration_seconds"],
        "expected_duration_seconds": expected_duration_seconds,
        "end_to_start_jump_zscore": loop_z,
        "end_to_start_raw_jump": loop_jump,
        "start_transient_risk_ms": start_transient_ms,
        "end_transient_risk_ms": end_transient_ms,
        "nearest_transient_to_wrap_ms": transient_ms,
        "transient_metric_source": transient_metric_source,
        "chroma_start_end_similarity": chroma_sim,
        "dead_space_risk": dead_space,
        "prev_adjacency_continuity": prev_delta,
        "next_adjacency_continuity": next_delta,
        "recommended_repair": repair_rec,
        "verdict": verdict,
        "verdict_reasons": reasons,
    }


def adjacent_continuity(loops, sr):
    """Back-to-back continuity between consecutive exported loops. Expected to
    be ~0 since loops are contiguous slices of one buffer — this confirms that
    by measurement rather than assuming it."""
    results = []
    for a, b in zip(loops, loops[1:]):
        sig_a, _ = sf.read(a["path"], always_2d=True, dtype="float32")
        sig_b, _ = sf.read(b["path"], always_2d=True, dtype="float32")
        gap_samples = b["start_sample"] - a["end_sample"]
        last = mono(sig_a)[-1]
        first = mono(sig_b)[0]
        results.append({
            "from_index": a["index"],
            "to_index": b["index"],
            "gap_samples": gap_samples,
            "sample_delta": float(abs(last - first)),
        })
    return results


def render_auditions(loops, sr, out_dir, select_index=0, repeat_count=4):
    out_dir = Path(out_dir)
    selected = next((l for l in loops if l["index"] == select_index), loops[0])
    sig, _ = sf.read(selected["path"], always_2d=True, dtype="float32")
    loop_repeated = np.tile(sig, (repeat_count, 1))
    loop4_path = out_dir / f"audition_loop{select_index}_x{repeat_count}.wav"
    sf.write(loop4_path, loop_repeated, sr, subtype="PCM_16")

    all_segs = np.concatenate([sf.read(l["path"], always_2d=True, dtype="float32")[0] for l in loops], axis=0)
    all_path = out_dir / "audition_all_segments.wav"
    sf.write(all_path, all_segs, sr, subtype="PCM_16")

    return str(loop4_path), str(all_path)


def verify_loops(out_dir, select_index=0, repeat_count=4):
    out_dir = Path(out_dir)
    manifest = json.loads((out_dir / "manifest.json").read_text())
    sr = manifest["sample_rate"]
    loops = manifest["loops"]
    bpm = manifest["bpm"]
    meter = manifest["meter"]
    bars_per_loop = manifest["bars_per_loop"]
    track_classification = manifest["classification"]

    # 3a fix: the transient metric needs the SOURCE track (with real context
    # on both sides of each boundary), not the isolated per-loop file - load
    # it once here rather than per-loop. Falls back to the old isolated-file
    # measurement (nearest_onset_ms) if the source can't be read for any
    # reason, rather than dropping the field.
    source_mono = None
    source_path = manifest.get("source_path")
    if source_path:
        try:
            source_stereo, source_sr = sf.read(source_path, always_2d=True, dtype="float32")
            if source_sr == sr:
                source_mono = mono(source_stereo)
        except Exception:
            source_mono = None

    continuity = adjacent_continuity(loops, sr)
    prev_delta_by_index = {c["to_index"]: c["sample_delta"] for c in continuity}
    next_delta_by_index = {c["from_index"]: c["sample_delta"] for c in continuity}

    per_loop = [
        verify_loop(
            l, sr, bars_per_loop=bars_per_loop, bpm=bpm, meter=meter,
            track_classification=track_classification,
            prev_delta=prev_delta_by_index.get(l["index"]),
            next_delta=next_delta_by_index.get(l["index"]),
            downbeat_candidate_used=manifest.get("downbeat_selected_phase"),
            source_mono=source_mono,
        )
        for l in loops
    ]
    loop_repeat_path, all_path = render_auditions(loops, sr, out_dir, select_index, repeat_count)

    report = {
        "source_path": manifest["source_path"],
        "sample_rate": sr,
        "bpm": bpm,
        "bars_per_loop": bars_per_loop,
        "classification": track_classification,
        "downbeat_source": manifest.get("downbeat_source"),
        "downbeat_selected_phase": manifest.get("downbeat_selected_phase"),
        "downbeat_phase_agreement": manifest.get("downbeat_phase_agreement"),
        "loops": per_loop,
        "adjacent_continuity": continuity,
        "audition_loop_repeat": loop_repeat_path,
        "audition_repeat_count": repeat_count,
        "audition_loop_x4": loop_repeat_path,
        "audition_all_segments": all_path,
        "summary": {
            "total": len(per_loop),
            "pass": sum(1 for r in per_loop if r["verdict"] == "pass"),
            "warn": sum(1 for r in per_loop if r["verdict"] == "warn"),
            "fail": sum(1 for r in per_loop if r["verdict"] == "fail"),
        },
    }
    report_path = out_dir / "verification_report.json"
    report_path.write_text(json.dumps(report, indent=2))
    return report


def main():
    parser = argparse.ArgumentParser(description="Verify exported loop candidates.")
    parser.add_argument("--out-dir", default="outputs/loops")
    parser.add_argument("--select-loop", type=int, default=0)
    args = parser.parse_args()

    report = verify_loops(args.out_dir, args.select_loop)
    s = report["summary"]
    print(f"{s['total']} loops: {s['pass']} pass, {s['warn']} warn, {s['fail']} fail")
    for r in report["loops"]:
        print(f"  loop {r['index']}: {r['verdict']} "
              f"(jump_z={r['end_to_start_jump_zscore']:.2f}, "
              f"transient={r['nearest_transient_to_wrap_ms']}, "
              f"chroma_sim={r['chroma_start_end_similarity']})")


if __name__ == "__main__":
    main()
