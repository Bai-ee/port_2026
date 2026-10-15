// Locked Studio chrome tokens (contract 11.3). The inspector uses ONLY these
// `--ts-*` values, so it stays readable whatever the draft palette does. There
// is deliberately no dark variant in v1. Every text pair is checked against
// 4.5:1 and every control boundary against 3:1 in __tests__/chrome-tokens.test.js.

export const STUDIO_CHROME_TOKENS = Object.freeze({
  '--ts-bg': '#ffffff',
  '--ts-fg': '#1a1a1a',
  '--ts-muted': '#5a5a5a',
  '--ts-line': '#c8c8c8',
  '--ts-accent': '#0b5cd5',
  '--ts-on-accent': '#ffffff',
  '--ts-danger': '#b00020',
  '--ts-ok': '#17692e',
  '--ts-focus': '#0b5cd5',
  // Additions (same rules): quiet fills, a control-boundary line, a warning hue.
  '--ts-bg-subtle': '#f6f6f7',
  '--ts-bg-sunken': '#eeeef0',
  '--ts-line-soft': '#e6e6e8',
  '--ts-line-strong': '#767676',
  '--ts-accent-soft': '#eaf1fc',
  '--ts-danger-soft': '#fdecef',
  '--ts-ok-soft': '#e9f5ec',
  '--ts-warn': '#8a4b00',
  '--ts-warn-soft': '#fff3e0',
  '--ts-shadow': 'rgba(0, 0, 0, 0.18)',
});

/** [foreground token, background token, minimum ratio, why] */
export const STUDIO_CHROME_PAIRS = Object.freeze([
  ['--ts-fg', '--ts-bg', 4.5, 'body text'],
  ['--ts-fg', '--ts-bg-subtle', 4.5, 'text on quiet fill'],
  ['--ts-fg', '--ts-bg-sunken', 4.5, 'text on sunken fill'],
  ['--ts-muted', '--ts-bg', 4.5, 'secondary text'],
  ['--ts-muted', '--ts-bg-subtle', 4.5, 'secondary text on quiet fill'],
  ['--ts-muted', '--ts-bg-sunken', 4.5, 'secondary text on sunken fill'],
  ['--ts-accent', '--ts-bg', 4.5, 'links and accent text'],
  ['--ts-accent', '--ts-accent-soft', 4.5, 'accent text on tint'],
  ['--ts-on-accent', '--ts-accent', 4.5, 'primary button label'],
  ['--ts-danger', '--ts-bg', 4.5, 'error text'],
  ['--ts-danger', '--ts-danger-soft', 4.5, 'error text on tint'],
  ['--ts-ok', '--ts-bg', 4.5, 'success text'],
  ['--ts-ok', '--ts-ok-soft', 4.5, 'success text on tint'],
  ['--ts-warn', '--ts-bg', 4.5, 'warning text'],
  ['--ts-warn', '--ts-warn-soft', 4.5, 'warning text on tint'],
  ['--ts-focus', '--ts-bg', 3, 'focus ring (non-text)'],
  ['--ts-line-strong', '--ts-bg', 3, 'control boundary (non-text)'],
]);
