#!/usr/bin/env bash
# apply-lifecycle.sh — Phase 7 item 3 (STUDIO-DETERMINISTIC-FINAL-RENDER-
# SONNET-HANDOFF.md). Safe, two-step application of
# proof-storage-lifecycle.json to the project bucket. A BUCKET
# CONFIGURATION MUTATION — run only with explicit Phase 7 approval, never
# from CI or a deploy script.
#
# SAFETY WORKFLOW (Codex Phase 7 review, P1 — the naive one-shot version
# could erase unrelated bucket rules, since `--lifecycle-file` REPLACES the
# bucket's ENTIRE lifecycle configuration):
#   1. DEFAULT = DRY RUN. Reads the bucket's CURRENT lifecycle, prints both
#      configs, and reports what would happen. Nothing is mutated.
#   2. If the bucket already has lifecycle rules that are NOT byte-for-byte
#      the ones this file defines, the script ABORTS — even with --apply —
#      and instructs you to merge them into proof-storage-lifecycle.json
#      first. It never silently replaces someone else's rules.
#   3. Mutation requires BOTH the explicit --apply flag AND retyping the
#      bucket name at the confirmation prompt.
#
# What the rules enforce (see __tests__/lifecycle-config.test.mjs — the
# drift-guard tying these prefixes/ages to the code's own constants):
#   - proof-render-artifacts/   deleted at age >= 7d (RETENTION_DAYS; the
#     read path never signs past expiresAt, so rule lag is inert; also the
#     starvation-proof cleanup for orphaned partial uploads).
#   - studio-screen-stills-tmp/ deleted at age >= 1d (staged direct uploads;
#     finalize best-effort-deletes them, this is the backstop).
#   - studio-screen-stills/ (canonical pinned stills) DELIBERATELY has NO
#     rule: recipes reference stills indefinitely, growth is capped by the
#     per-client stored-bytes quota, and the quota ledger's bytesTotal is
#     never decremented — an age-based delete would silently desync it.
set -euo pipefail

usage() { echo "usage: apply-lifecycle.sh <bucket-name> [--apply]   (default: dry run)"; exit 1; }
BUCKET="${1:-}"; [ -n "${BUCKET}" ] || usage
MODE="${2:-dry-run}"
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DESIRED="${DIR}/proof-storage-lifecycle.json"

command -v gcloud >/dev/null || { echo "gcloud is required."; exit 1; }
command -v jq >/dev/null || { echo "jq is required (brew install jq)."; exit 1; }

echo "── Current lifecycle configuration of gs://${BUCKET}:"
CURRENT_JSON="$(gcloud storage buckets describe "gs://${BUCKET}" --format="json(lifecycle)" | jq '.lifecycle // {}')"
echo "${CURRENT_JSON}" | jq .

echo "── Desired configuration (${DESIRED}):"
DESIRED_JSON="$(jq . "${DESIRED}")"
echo "${DESIRED_JSON}" | jq .

# Normalized comparison — key-order-independent.
CURRENT_NORM="$(echo "${CURRENT_JSON}" | jq -S '.rule // [] | sort_by(tostring)')"
DESIRED_NORM="$(echo "${DESIRED_JSON}" | jq -S '.rule | sort_by(tostring)')"

if [ "${CURRENT_NORM}" = "${DESIRED_NORM}" ]; then
  echo "── Bucket lifecycle already matches the desired configuration. Nothing to do."
  exit 0
fi

if [ "${CURRENT_NORM}" != "[]" ]; then
  echo ""
  echo "✋ ABORT: gs://${BUCKET} already has lifecycle rules that differ from this file's."
  echo "   Applying would REPLACE them (Cloud Storage lifecycle is set whole, not merged)."
  echo "   Merge the existing rules above into proof-storage-lifecycle.json first, get the"
  echo "   merged file re-reviewed, then re-run. This script never overwrites foreign rules."
  exit 1
fi

if [ "${MODE}" != "--apply" ]; then
  echo ""
  echo "── DRY RUN complete: the bucket has no lifecycle rules; applying would install the"
  echo "   desired configuration above. Re-run with --apply to mutate:"
  echo "     ./apply-lifecycle.sh ${BUCKET} --apply"
  exit 0
fi

read -r -p "Type the bucket name again to APPLY this lifecycle configuration: " CONFIRM
[ "${CONFIRM}" = "${BUCKET}" ] || { echo "Aborted."; exit 1; }

gcloud storage buckets update "gs://${BUCKET}" --lifecycle-file="${DESIRED}"
echo "Applied. Verify with: gcloud storage buckets describe gs://${BUCKET} --format=\"json(lifecycle)\""
