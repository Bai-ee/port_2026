function money(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

function sumLineItems(items) {
  return (Array.isArray(items) ? items : []).reduce((sum, item) => sum + money(item.total), 0);
}

export function verifyEstimate(estimate, context = {}) {
  const errors = [];
  const warnings = [];
  const lineItems = Array.isArray(estimate?.lineItems) ? estimate.lineItems : [];
  const discounts = Array.isArray(estimate?.discounts) ? estimate.discounts : [];
  const optionalAddOns = Array.isArray(estimate?.optionalAddOns) ? estimate.optionalAddOns : [];

  if (!estimate || typeof estimate !== 'object') {
    return { ok: false, errors: ['Estimate is missing.'], warnings };
  }

  if (!lineItems.length) errors.push('At least one estimate line item is required.');

  for (const item of lineItems) {
    if (!String(item?.label || '').trim()) errors.push('Every line item needs a label.');
    if (money(item?.quantity) <= 0) errors.push(`Line item "${item?.label || 'Untitled'}" needs a quantity above 0.`);
    if (money(item?.unitPrice) < 0) errors.push(`Line item "${item?.label || 'Untitled'}" cannot have a negative unit price.`);
    const expected = money(money(item?.quantity) * money(item?.unitPrice));
    if (Math.abs(expected - money(item?.total)) > 0.01) {
      errors.push(`Line item "${item?.label || 'Untitled'}" total does not match quantity x unit price.`);
    }
  }

  for (const item of optionalAddOns) {
    if (money(item?.price) < 0) errors.push(`Add-on "${item?.label || 'Untitled'}" cannot have a negative price.`);
  }

  const expectedSubtotal = money(sumLineItems(lineItems));
  if (Math.abs(expectedSubtotal - money(estimate?.subtotal)) > 0.01) {
    errors.push('Subtotal does not match line item totals.');
  }

  const discountTotal = discounts.reduce((sum, discount) => sum + Math.abs(money(discount?.amount)), 0);
  const expectedTotal = money(expectedSubtotal - discountTotal);
  if (Math.abs(expectedTotal - money(estimate?.total)) > 0.01) {
    errors.push('Total does not match subtotal minus discounts.');
  }

  const storedComparison = context?.readinessComparison || null;
  const proof = estimate?.proof || {};
  if (proof.previewUrl && context?.previewUrl && proof.previewUrl !== context.previewUrl) {
    errors.push('Estimate proof preview URL does not match the generated site preview URL.');
  }
  if (proof.previewUrl && !context?.previewUrl) {
    errors.push('Estimate includes a preview URL, but no generated site preview is stored.');
  }
  if (proof.readinessBefore != null || proof.readinessAfter != null) {
    if (!storedComparison?.before || !storedComparison?.after) {
      errors.push('Estimate includes AI readiness proof, but no readiness comparison is stored.');
    } else {
      const before = Number(storedComparison.before.score);
      const after = Number(storedComparison.after.score);
      if (Number(proof.readinessBefore) !== before || Number(proof.readinessAfter) !== after) {
        errors.push('Estimate readiness proof does not match the stored comparison.');
      }
    }
  }

  if (!estimate.timeline) warnings.push('Timeline is empty.');
  if (!Array.isArray(estimate.scope) || estimate.scope.length === 0) warnings.push('Scope list is empty.');
  if (!Array.isArray(estimate.terms) || estimate.terms.length === 0) warnings.push('Terms list is empty.');
  if (!estimate.sendMessage?.subject || !estimate.sendMessage?.body) warnings.push('Send-ready message is incomplete.');

  return { ok: errors.length === 0, errors, warnings };
}

export default verifyEstimate;
