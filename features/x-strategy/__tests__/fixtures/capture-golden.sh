#!/bin/sh
# Re-capture CLI goldens (stdout/stderr/--out) with the fake bird. Run from repo root. Used BEFORE the refactor.
set -e
D=features/x-strategy/__tests__/fixtures/golden
mkdir -p $D
FB=$PWD/features/x-strategy/__tests__/fixtures/fake-bird.mjs
run() { name=$1; shift; env BIRD=$FB "$@" >/dev/null 2>&1 || true; }
# A: full chain, since passes only page 2 (36 posts, ~9 days) -> cutoff at page 3 oldest
# B: fail on page 3 (partial kept)
# C: cutoff inside page 2
for sc in "A:" "B:FAKE_BIRD_FAIL_ON=c2" "C:"; do
  n=${sc%%:*}; e=${sc#*:}
  case $n in
    A) extra="--since 2026-09-01T00:00:00.000Z --tz -5 --lanes web,brand" ;;
    B) extra="--since 2026-09-01T00:00:00.000Z" ;;
    C) extra="--since 2026-10-07T00:00:00.000Z --tz 2" ;;
  esac
  env BIRD=$FB ${e:+$e} node scripts/x-content/ingest-corpus.mjs --handle @fixture_handle $extra --out $D/$n.rows.json >$D/$n.stdout 2>$D/$n.stderr || echo $? > $D/$n.exit
done
# D: zero posts -> exit 1
env BIRD=$FB FAKE_BIRD_FAIL_ON=first node scripts/x-content/ingest-corpus.mjs --handle fixture_handle --since 2026-09-01T00:00:00.000Z >$D/D.stdout 2>$D/D.stderr || echo $? > $D/D.exit
# E: bad source and missing handle
node scripts/x-content/ingest-corpus.mjs >$D/E.stdout 2>$D/E.stderr || echo $? > $D/E.exit
node scripts/x-content/ingest-corpus.mjs --handle x --source scrape >$D/F.stdout 2>$D/F.stderr || echo $? > $D/F.exit
