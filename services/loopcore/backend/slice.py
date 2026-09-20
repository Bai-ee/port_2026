"""Phase 3 — slicing.

Slices a continuous stereo PCM source into bar-accurate loop candidates using
analysis.json's grid. Boundaries are always computed from the origin
(never accumulated) per the hard constraint in the spec:
  boundary(i) = round(offset_samples + i * samples_per_bar * bars_per_loop)
"""
import argparse
import json
from pathlib import Path

import numpy as np
import soundfile as sf


def compute_boundaries(sample_rate, bpm, meter, offset_samples, duration_samples, bars_per_loop,
                        region_end_samples=None):
    """region_end_samples (1e, ACCURATE_TEMPO_PLAN.md) generalizes the
    trailing-partial-loop rule to the detected musical region's end instead
    of the raw file end: a track's tail can decay into silence/ambience past
    the last real bar, and a bar that only "completes" because it runs into
    that dead space isn't a real loop. None (or >= duration_samples) is a
    no-op - the common case where no such tail was detected."""
    samples_per_bar = sample_rate * 60.0 / bpm * meter
    effective_duration_samples = duration_samples
    if region_end_samples is not None and 0 < region_end_samples < duration_samples:
        effective_duration_samples = region_end_samples
    boundaries = []
    i = 0
    while True:
        start = round(offset_samples + i * samples_per_bar * bars_per_loop)
        end = round(offset_samples + (i + 1) * samples_per_bar * bars_per_loop)
        if start >= duration_samples:
            break
        complete = end <= effective_duration_samples
        boundaries.append({
            "index": i,
            "start_sample": start,
            "end_sample": min(end, duration_samples),
            "complete": complete,
        })
        if not complete:
            break
        i += 1
    return boundaries


def slice_track(wav_path, analysis, bars_per_loop, out_dir, bit_depth=16):
    wav_path = Path(wav_path)
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    stereo, sr = sf.read(wav_path, always_2d=True, dtype="float32")
    if sr != analysis["sample_rate"]:
        raise ValueError(f"sample rate mismatch: wav={sr} analysis={analysis['sample_rate']}")

    bpm = analysis["bpm_final"]
    meter = analysis["meter"]
    offset_samples = analysis["offset_samples"]
    duration_samples = stereo.shape[0]

    region_end_seconds = analysis.get("region_end_seconds")
    region_end_samples = int(round(region_end_seconds * sr)) if region_end_seconds is not None else None

    boundaries = compute_boundaries(sr, bpm, meter, offset_samples, duration_samples, bars_per_loop,
                                     region_end_samples=region_end_samples)

    subtype = "PCM_16" if bit_depth == 16 else "PCM_24"
    loops = []
    skipped_partial = None
    for b in boundaries:
        if not b["complete"]:
            skipped_partial = b
            continue
        segment = stereo[b["start_sample"]:b["end_sample"]]
        out_path = out_dir / f"loop_{b['index']:04d}.wav"
        sf.write(out_path, segment, sr, subtype=subtype)
        loops.append({
            "index": b["index"],
            "path": str(out_path),
            "start_sample": b["start_sample"],
            "end_sample": b["end_sample"],
            "duration_samples": b["end_sample"] - b["start_sample"],
            "duration_seconds": (b["end_sample"] - b["start_sample"]) / sr,
        })

    warnings = list(analysis.get("warnings", []))
    if skipped_partial:
        warnings.append(
            f"trailing partial loop at index {skipped_partial['index']} "
            f"(start_sample={skipped_partial['start_sample']}) is shorter than "
            f"{bars_per_loop} bars and was not exported"
        )

    manifest = {
        "source_path": str(wav_path),
        "sample_rate": sr,
        "bpm": bpm,
        "meter": meter,
        "offset_samples": offset_samples,
        "region_start_seconds": analysis.get("region_start_seconds"),
        "region_end_seconds": analysis.get("region_end_seconds"),
        "bpm_contested": analysis.get("bpm_contested"),
        "bars_per_loop": bars_per_loop,
        "bit_depth": bit_depth,
        "analyzers": analysis.get("analyzers", {}),
        "classification": analysis.get("classification"),
        "downbeat_source": analysis.get("downbeat_source"),
        "downbeat_selected_phase": analysis.get("downbeat_selected_phase"),
        "downbeat_phase_agreement": analysis.get("downbeat_phase_agreement"),
        "loops": loops,
        "warnings": warnings,
    }
    manifest_path = out_dir / "manifest.json"
    manifest_path.write_text(json.dumps(manifest, indent=2))
    return manifest


def main():
    parser = argparse.ArgumentParser(description="Slice a track into bar-accurate loop candidates.")
    parser.add_argument("--wav", required=True)
    parser.add_argument("--analysis", default="outputs/analysis.json")
    parser.add_argument("--bars-per-loop", type=int, default=4)
    parser.add_argument("--out-dir", default="outputs/loops")
    parser.add_argument("--bit-depth", type=int, choices=[16, 24], default=16)
    args = parser.parse_args()

    analysis = json.loads(Path(args.analysis).read_text())
    manifest = slice_track(args.wav, analysis, args.bars_per_loop, args.out_dir, args.bit_depth)

    print(f"exported {len(manifest['loops'])} loops to {args.out_dir}")
    for w in manifest["warnings"]:
        print(f"WARNING: {w}")


if __name__ == "__main__":
    main()
