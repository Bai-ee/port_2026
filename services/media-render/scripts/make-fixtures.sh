#!/usr/bin/env bash
#
# Generate tiny, commit-safe fixture media with ffmpeg.
# Layout mirrors the client-scoped store: source/{folder}/{file}
#
#   clients/{clientId}/media/
#     source/
#       skyline/clip1.mp4        (2s, 320x320 testsrc)
#       neighborhood/clip2.mp4   (2s, 320x320 testsrc2)
#       stills/photo1.png        (320x320 still)
#       audio/track.m4a          (3s silent stereo aac)  <- local "arweave" mock
#
# All clips are a couple of seconds at <=320px so they stay small.

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$HERE/../__tests__/fixtures/client-acme/media/source"

if ! command -v ffmpeg >/dev/null 2>&1; then
  echo "ffmpeg not found on PATH — cannot generate fixtures." >&2
  echo "Install ffmpeg (full build) and re-run: bash scripts/make-fixtures.sh" >&2
  exit 1
fi

mkdir -p "$ROOT/skyline" "$ROOT/neighborhood" "$ROOT/stills" "$ROOT/audio"

echo "Generating fixture clips into $ROOT ..."

ffmpeg -y -loglevel error -f lavfi -i "testsrc=duration=2:size=320x320:rate=30" \
  -pix_fmt yuv420p -c:v libx264 -preset veryfast -crf 30 \
  "$ROOT/skyline/clip1.mp4"

ffmpeg -y -loglevel error -f lavfi -i "testsrc2=duration=2:size=320x320:rate=30" \
  -pix_fmt yuv420p -c:v libx264 -preset veryfast -crf 30 \
  "$ROOT/neighborhood/clip2.mp4"

ffmpeg -y -loglevel error -f lavfi -i "color=c=0x224466:size=320x320:duration=1" \
  -frames:v 1 "$ROOT/stills/photo1.png"

ffmpeg -y -loglevel error -f lavfi -i "anullsrc=channel_layout=stereo:sample_rate=44100" \
  -t 3 -c:a aac -b:a 96k "$ROOT/audio/track.m4a"

echo "Done. Fixtures:"
find "$ROOT" -type f -printf "  %p (%s bytes)\n" 2>/dev/null || find "$ROOT" -type f -exec ls -l {} \;
