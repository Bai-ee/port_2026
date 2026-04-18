// formatters/json.js — Pretty-print JSON formatter.
//
// Pure function — callable programmatically or from CLI.

/**
 * @param {object} result - Output of runAiSeoAudit
 * @returns {string}
 */
export function format(result) {
  return JSON.stringify(result, null, 2);
}
