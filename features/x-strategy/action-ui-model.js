// Pure view-models for the generic `action` proposal card and the undo chip (no React, no I/O).

const asList = (v) => (Array.isArray(v) ? v : []);
const str = (v) => (typeof v === 'string' ? v.trim() : '');

/**
 * actionCardModel(proposal) -> {title, tone:'danger'|'warn'|'info', warningLines[], confirmLabel, needsTyped, confirmText}
 * payload: {actionId, tier, title, warning, affected, irreversible, cost, external, confirmText}
 */
export function actionCardModel(proposal) {
  const p = (proposal && proposal.payload) || {};
  const tier = Number(p.tier) || 0;
  const confirmText = str(p.confirmText);
  const tone = tier >= 3 || p.irreversible ? 'danger' : tier === 2 ? 'danger' : tier === 1 ? 'info' : 'warn';
  const lines = [];
  if (str(p.warning)) lines.push(str(p.warning));
  const aff = p.affected;
  if (Number.isFinite(aff)) lines.push(`Affects ${aff} ${aff === 1 ? 'item' : 'items'}.`);
  else if (Array.isArray(aff) && aff.length) lines.push(`Affects ${aff.length} ${aff.length === 1 ? 'item' : 'items'}: ${aff.slice(0, 3).map(String).join(', ')}${aff.length > 3 ? ', ...' : ''}.`);
  if (p.external) lines.push(`Goes to ${p.external === 'x' ? 'your X account' : p.external}.`);
  if (str(p.cost)) lines.push(`Cost: ${str(p.cost)}.`);
  if (p.irreversible) lines.push("This can't be undone.");
  const title = str(p.title) || str(proposal && proposal.summary) || str(p.actionId) || 'Run an action';
  const confirmLabel = tier >= 3 ? 'Confirm and run' : tier === 2 ? 'Confirm change' : 'Confirm';
  return { title, tone, warningLines: lines, confirmLabel, needsTyped: !!confirmText, confirmText };
}

/** undoChipModel(toolResult) -> {undoId, label} when the result carries an undoId, else null. */
export function undoChipModel(toolResult) {
  const r = toolResult && typeof toolResult === 'object' ? toolResult : null;
  const undoId = str(r && (r.undoId || (r.result && r.result.undoId)));
  if (!undoId) return null;
  return { undoId, label: str(r.title) ? `Undo: ${str(r.title)}` : 'Undo' };
}

/** All undo chips for a chat message (m.undoIds[] and/or m.toolResults[]), de-duplicated. */
export function messageUndoChips(message) {
  const out = [];
  const seen = new Set();
  const add = (c) => { if (c && !seen.has(c.undoId)) { seen.add(c.undoId); out.push(c); } };
  asList(message && message.undoIds).forEach((id) => add(undoChipModel({ undoId: id })));
  asList(message && message.toolResults).forEach((r) => add(undoChipModel(r)));
  return out;
}

/** True when typed text satisfies the typed-confirm requirement (case-insensitive, trimmed). */
export function typedMatches(model, typed) {
  if (!model || !model.needsTyped) return true;
  return str(typed).toLowerCase() === model.confirmText.toLowerCase();
}
