// Number parsing and human-readable formatters for the Studio (pure).

/** Decimal places implied by a step (0.05 -> 2, 1 -> 0). */
export function stepDecimals(step) {
  if (!Number.isFinite(step) || step <= 0) return 0;
  const s = String(step);
  if (s.includes('e-')) return Number(s.split('e-')[1]);
  const i = s.indexOf('.');
  return i < 0 ? 0 : s.length - i - 1;
}

export function roundTo(v, dp) {
  const f = 10 ** dp;
  const r = Math.round(v * f) / f;
  return r === 0 ? 0 : r;
}

export function formatNumber(v, dp = 2) {
  if (!Number.isFinite(v)) return '';
  return String(roundTo(v, dp));
}

export function wrapDegrees(v) {
  return ((v % 360) + 360) % 360;
}

/**
 * Parse text typed into a numeric field.
 * opts: { min, max, wrap?: boolean (hue-style), dp?: number }
 * Returns { ok, value, adjusted: 'none'|'clamped'|'wrapped', message }.
 * Out-of-range hue wraps; everything else clamps. Nothing is silently coerced:
 * non-numeric text is rejected (ok:false) and the caller keeps the old value.
 */
export function parseNumberInput(text, opts = {}) {
  const { min = -Infinity, max = Infinity, wrap = false, dp = 4 } = opts;
  const raw = String(text ?? '').trim().replace(/[°%\s]/g, '').replace(',', '.');
  if (raw === '' || !/^[-+]?(\d+\.?\d*|\.\d+)$/.test(raw)) {
    return { ok: false, value: null, adjusted: 'none', message: 'Enter a number.' };
  }
  const n = Number(raw);
  if (!Number.isFinite(n)) return { ok: false, value: null, adjusted: 'none', message: 'Enter a number.' };
  if (wrap && Number.isFinite(min) && Number.isFinite(max)) {
    const span = max - min;
    if (n < min || n > max) {
      // 360 is a legitimate slider end stop; anything beyond the range wraps.
      const w = roundTo(min + (((n - min) % span) + span) % span, dp);
      return { ok: true, value: w, adjusted: 'wrapped', message: `${formatNumber(n, dp)} wrapped to ${formatNumber(w, dp)}.` };
    }
    return { ok: true, value: roundTo(n, dp), adjusted: 'none', message: '' };
  }
  if (n < min || n > max) {
    const c = n < min ? min : max;
    return { ok: true, value: roundTo(c, dp), adjusted: 'clamped', message: `${formatNumber(n, dp)} is outside ${formatNumber(min, dp)} to ${formatNumber(max, dp)}; set to ${formatNumber(c, dp)}.` };
  }
  return { ok: true, value: roundTo(n, dp), adjusted: 'none', message: '' };
}

/** Text for aria-valuetext. kind: 'degrees' | 'percent' | 'unit' | 'factor' | 'turns' */
export function valueText(kind, v, dp = 2) {
  const n = formatNumber(v, dp);
  switch (kind) {
    case 'degrees': return `${n} degrees`;
    case 'percent': return `${formatNumber(v * 100, 0)} percent`;
    case 'turns': return `${n} turns`;
    case 'factor': return `${n} times`;
    default: return n;
  }
}

export function signedNumber(v, dp = 2) {
  const r = roundTo(v, dp);
  return `${r >= 0 ? '+' : '−'}${Math.abs(r)}`;
}

export function formatOklch(o) {
  if (!o) return '';
  const base = `L ${roundTo(o.l, 3).toFixed(3)}  C ${roundTo(o.c, 3).toFixed(3)}  H ${roundTo(o.h, 1).toFixed(1)}`;
  return typeof o.a === 'number' && o.a < 1 ? `${base}  A ${roundTo(o.a, 3)}` : base;
}

export function formatRatio(r) {
  return Number.isFinite(r) ? `${r.toFixed(2)}:1` : '-';
}

/** HH:MM in the viewer's local time, or '' for an invalid value. */
export function formatClock(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** Message for the polite live region after a save attempt. Always says LOCAL. */
export function saveMessage(result) {
  if (result && result.ok) {
    const t = formatClock(result.savedAt);
    return `Draft saved${t ? ` ${t}` : ''}. Local to this browser only.`;
  }
  const why = result && result.error ? String(result.error) : 'storage unavailable';
  return `Could not save: ${why}.`;
}
