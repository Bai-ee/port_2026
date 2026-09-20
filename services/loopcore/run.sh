#!/bin/bash
# Start the loopcore engine on http://127.0.0.1:8766 (LOOPCORE_PORT overrides).
# Uses the local venv; falls back to the edittrax workbench venv if this one
# hasn't been set up yet (same dependency set).
set -euo pipefail
cd "$(dirname "$0")"
if [ -x .venv/bin/python ]; then
  PY=.venv/bin/python
elif [ -x "$HOME/Documents/Repos/EditTraxV2/edittrax_dapp/tools/slice_track/.venv/bin/python" ]; then
  PY="$HOME/Documents/Repos/EditTraxV2/edittrax_dapp/tools/slice_track/.venv/bin/python"
  echo "(using the edittrax workbench venv - run ./setup.sh for a self-contained one)"
else
  echo "No venv found. Run ./setup.sh first." >&2
  exit 1
fi
exec "$PY" backend/api.py
