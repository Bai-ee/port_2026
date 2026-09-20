"""Phase 4 — repair experiments.

Zero-cross snap, microfade, loop-crossfade, and tempo-warp are explicit,
opt-in experiments (never applied silently by slice.py/verify.py). Each
strategy is scored with the same metrics verify.py uses, before vs after,
so the improvement (or lack of one) is measured, not assumed.
"""
import argparse
import json
import sys
from pathlib import Path

import numpy as np
import pyrubberband as pyrb
import soundfile as sf

sys.path.insert(0, str(Path(__file__).parent))
import verify as verify_mod  # noqa: E402


def zero_cross_snap(stereo, search_window=220):
    """Trim start/end to the nearest zero-crossing within `search_window`
    samples (~5ms at 44.1kHz), reducing the amplitude jump at the cut edge."""
    mono = np.mean(stereo, axis=1)

    def nearest_crossing(indices):
        signs = np.sign(mono[indices])
        crossings = np.where(np.diff(signs) != 0)[0]
        return indices[crossings[0]] if len(crossings) else indices[0]

    start_region = np.arange(0, min(search_window, len(mono) - 1))
    end_region = np.arange(max(0, len(mono) - search_window), len(mono) - 1)
    new_start = nearest_crossing(start_region)
    new_end = nearest_crossing(end_region) + 1
    return stereo[new_start:new_end]


def microfade(stereo, sr, fade_ms=8):
    n = min(int(sr * fade_ms / 1000), len(stereo) // 4)
    out = stereo.copy()
    ramp_in = np.linspace(0, 1, n)[:, None]
    ramp_out = np.linspace(1, 0, n)[:, None]
    out[:n] *= ramp_in
    out[-n:] *= ramp_out
    return out


def crossfade_loop(stereo, sr, fade_ms=15):
    """Equal-power blend of the tail into a head-shifted copy, so the export's
    own end anticipates its own start - reduces the end-to-start wrap click.
    Output is `fade_ms` shorter than the input."""
    n = min(int(sr * fade_ms / 1000), len(stereo) // 4)
    t = np.linspace(0, np.pi / 2, n)[:, None]
    fade_in = np.sin(t)
    fade_out = np.cos(t)

    shifted = stereo[n:]
    tail = stereo[-n:]
    head = stereo[:n]
    blended_tail = shifted[-n:] * fade_out + head * fade_in
    return np.concatenate([shifted[:-n], blended_tail], axis=0)


def warp_tempo(stereo, sr, current_bpm, target_bpm):
    rate = target_bpm / current_bpm
    return pyrb.time_stretch(stereo, sr, rate)


def silence_trim(stereo, sr, amplitude_threshold=0.01, max_trim_ms=100):
    """Trim leading/trailing near-silence at a boundary (dead space), up to
    max_trim_ms per edge. Only removes actual silence - stops at the first
    sample above the amplitude threshold, so it's a no-op on loops that don't
    have dead space (verify.dead_space_risk gates when this is recommended)."""
    max_trim = int(sr * max_trim_ms / 1000)
    mono_sig = np.mean(stereo, axis=1)
    n = len(mono_sig)

    start = 0
    while start < min(max_trim, n) and abs(mono_sig[start]) < amplitude_threshold:
        start += 1
    end = n
    while end > max(n - max_trim, start + 1) and abs(mono_sig[end - 1]) < amplitude_threshold:
        end -= 1
    return stereo[start:end]


STRATEGIES = {
    "zero_cross": lambda sig, sr, **kw: zero_cross_snap(sig, kw.get("search_window", 220)),
    "microfade": lambda sig, sr, **kw: microfade(sig, sr, kw.get("fade_ms", 8)),
    "crossfade": lambda sig, sr, **kw: crossfade_loop(sig, sr, kw.get("fade_ms", 15)),
    "silence_trim": lambda sig, sr, **kw: silence_trim(
        sig, sr, kw.get("amplitude_threshold", 0.01), kw.get("max_trim_ms", 100)
    ),
    "warp": lambda sig, sr, **kw: warp_tempo(sig, sr, kw["current_bpm"], kw["target_bpm"]),
}


def score(stereo, sr):
    mono = verify_mod.mono(stereo)
    n = len(mono)
    z, jump = verify_mod.local_jump_zscore(mono, n - 1, 0)
    chroma = verify_mod.chroma_similarity(mono, sr)
    return {"end_to_start_jump_zscore": z, "end_to_start_raw_jump": jump, "chroma_start_end_similarity": chroma}


def repair_loop(loop_path, strategy, out_path, **kwargs):
    stereo, sr = sf.read(loop_path, always_2d=True, dtype="float32")
    before = score(stereo, sr)

    repaired = STRATEGIES[strategy](stereo, sr, **kwargs)
    after = score(repaired, sr)

    out_path = Path(out_path)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    sf.write(out_path, repaired, sr, subtype="PCM_16")

    return {
        "strategy": strategy,
        "input": str(loop_path),
        "output": str(out_path),
        "before": before,
        "after": after,
        "improved": after["end_to_start_jump_zscore"] < before["end_to_start_jump_zscore"],
    }


def main():
    parser = argparse.ArgumentParser(description="Run an explicit repair experiment on one loop.")
    parser.add_argument("--loop", required=True)
    parser.add_argument("--strategy", required=True, choices=list(STRATEGIES.keys()))
    parser.add_argument("--out", required=True)
    parser.add_argument("--fade-ms", type=float, default=15)
    parser.add_argument("--search-window", type=int, default=220)
    parser.add_argument("--current-bpm", type=float)
    parser.add_argument("--target-bpm", type=float)
    args = parser.parse_args()

    kwargs = {"fade_ms": args.fade_ms, "search_window": args.search_window}
    if args.current_bpm and args.target_bpm:
        kwargs["current_bpm"] = args.current_bpm
        kwargs["target_bpm"] = args.target_bpm

    result = repair_loop(args.loop, args.strategy, args.out, **kwargs)
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
