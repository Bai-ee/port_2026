"""Phase D — repair strategy comparison across all non-passing loops.

Runs zero_cross_snap, microfade, and equal_power_crossfade against every
warn/fail loop from the latest verify run, scoring end-to-start jump z-score
before/after with the same metric verify.py uses. warp is deliberately
excluded here - it's only ever appropriate for tempo-drifted tracks (see
repair.py/verify.recommend_repair), not a general click fix.
"""
import argparse
import json
from pathlib import Path

import repair as repair_mod
import verify as verify_mod

STRATEGIES_TO_COMPARE = ["zero_cross", "microfade", "crossfade"]
# microfade trivially drives end-to-start jump z-score to ~0 by fading both
# edges to silence - that's masking the discontinuity, not fixing it (see
# PHASE4_REPORT.md from the first POC doc). It's ranked last on purpose so
# "best_strategy" reflects genuine repair quality, not a metric that's easy
# to game.
STRATEGY_PREFERENCE_ON_TIE = {"zero_cross": 0, "crossfade": 1, "microfade": 2}


def compare_loop(loop_path, loop_index, out_dir):
    results = {}
    for strategy in STRATEGIES_TO_COMPARE:
        out_path = out_dir / f"loop_{loop_index:04d}_{strategy}.wav"
        results[strategy] = repair_mod.repair_loop(loop_path, strategy, out_path)
    return results


def compare_repairs(loops_dir, out_dir=None):
    loops_dir = Path(loops_dir)
    out_dir = Path(out_dir) if out_dir else loops_dir.parent / "repair"
    report = json.loads((loops_dir / "verification_report.json").read_text())

    comparisons = []
    for loop in report["loops"]:
        if loop["verdict"] == "pass":
            continue
        strategy_results = compare_loop(loop["path"], loop["index"], out_dir)
        # Among strategies that bring the jump below the warn threshold,
        # prefer the one that fixes the discontinuity rather than masks it
        # (zero_cross/crossfade over microfade - see module docstring).
        passing = [
            s for s in strategy_results
            if strategy_results[s]["after"]["end_to_start_jump_zscore"] < verify_mod.LOOPABILITY_WARN_Z
        ]
        candidates = passing or list(strategy_results)
        best_strategy = min(candidates, key=lambda s: STRATEGY_PREFERENCE_ON_TIE[s])
        best_z = strategy_results[best_strategy]["after"]["end_to_start_jump_zscore"]
        would_pass = bool(passing)
        comparisons.append({
            "loop_index": loop["index"],
            "original_verdict": loop["verdict"],
            "original_jump_zscore": loop["end_to_start_jump_zscore"],
            "recommended_repair": loop["recommended_repair"],
            "strategy_results": strategy_results,
            "best_strategy": best_strategy,
            "best_jump_zscore": best_z,
            "would_likely_pass_after_repair": would_pass,
        })

    summary = {
        "total_non_passing": len(comparisons),
        "improved_to_likely_pass": sum(1 for c in comparisons if c["would_likely_pass_after_repair"]),
        "still_problematic": sum(1 for c in comparisons if not c["would_likely_pass_after_repair"]),
    }
    result = {"summary": summary, "loops": comparisons}
    (loops_dir / "repair_comparison.json").write_text(json.dumps(result, indent=2))
    return result


def main():
    parser = argparse.ArgumentParser(description="Compare repair strategies across all non-passing loops.")
    parser.add_argument("--loops-dir", default="outputs/loops")
    args = parser.parse_args()

    result = compare_repairs(args.loops_dir)
    print(json.dumps(result["summary"], indent=2))
    for c in result["loops"]:
        print(
            f"loop {c['loop_index']}: {c['original_verdict']} (z={c['original_jump_zscore']:.2f}) "
            f"-> best={c['best_strategy']} (z={c['best_jump_zscore']:.2f}) "
            f"{'PASS' if c['would_likely_pass_after_repair'] else 'still risky'}"
        )


if __name__ == "__main__":
    main()
