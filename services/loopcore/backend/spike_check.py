"""Phase 0 dependency spike: report which analyzer libs import cleanly."""
import importlib
import json
import subprocess
import sys

RESULTS = {}


def check_import(name, import_name=None):
    import_name = import_name or name
    try:
        mod = importlib.import_module(import_name)
        version = getattr(mod, "__version__", "unknown")
        RESULTS[name] = {"status": "ok", "version": version}
    except Exception as e:
        RESULTS[name] = {"status": "failed", "error": f"{type(e).__name__}: {e}"}


def check_binary(name, cmd):
    try:
        out = subprocess.run(cmd, capture_output=True, text=True, timeout=10)
        RESULTS[name] = {
            "status": "ok" if out.returncode == 0 else "failed",
            "detail": (out.stdout or out.stderr).strip()[:200],
        }
    except Exception as e:
        RESULTS[name] = {"status": "failed", "error": f"{type(e).__name__}: {e}"}


for pkg in ["numpy", "soundfile", "librosa"]:
    check_import(pkg)

check_import("essentia", "essentia.standard")
check_import("madmom")
check_import("BeatNet", "BeatNet.BeatNet")  # actual tracker class, not just the bare package
check_import("pyrubberband")
check_binary("rubberband_cli", ["rubberband", "--version"])

print(json.dumps(RESULTS, indent=2))
print(f"python: {sys.version}", file=sys.stderr)
