#!/bin/bash
# One-time setup for the loopcore engine (macOS). Creates a local venv and
# installs the analysis stack (numpy/soundfile/librosa/essentia/beat-this;
# torch CPU comes with beat-this). First analyze also downloads Beat This!'s
# ~50MB checkpoint to ~/.cache/torch/hub/checkpoints/ (one-time).
set -euo pipefail
cd "$(dirname "$0")"
python3 -m venv .venv
source .venv/bin/activate
pip install --upgrade pip
pip install -r requirements.txt
echo "loopcore setup complete. Start the engine with: ./run.sh"
