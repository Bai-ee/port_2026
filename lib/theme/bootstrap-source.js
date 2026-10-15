// Pre-paint bootstrap (contract §8.2). A static ES5 inline <script> generated
// from the same constants as the runtime. It must stay in lock-step with
// mode.js (normalizePreference / resolveMode); the bootstrap-parity test in
// lib/theme-runtime runs it in node:vm against the runtime store.
//
// ES5 only: no arrow functions, let/const, template literals, or optional chaining.

import { STORAGE_KEYS, DRAFT_CSS_MARKER } from './constants.js';
import { normalizePreference } from './mode.js';

export const BOOTSTRAP_SCRIPT_HASH_NOTE =
  'The script is constant per default preference. If a CSP is ever added, pin the sha256 of ' +
  'getBootstrapScript({ defaultPreference }) (printed by scripts/theme/check-theme.mjs) and avoid ' +
  'per-request nonces: they force dynamic rendering of the static root layout.';

export function getBootstrapScript({ defaultPreference } = {}) {
  const P = normalizePreference(defaultPreference, 'light');
  return (
    "(function(){var d=document.documentElement,P='" + P + "';try{" +
    "var p=P;try{var s=localStorage.getItem('" + STORAGE_KEYS.pref + "');if(s==='light'||s==='dark'||s==='system')p=s}catch(e){}" +
    "var m=p==='system'?(window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'):p;" +
    "d.setAttribute('data-theme',m);d.setAttribute('data-theme-pref',p);d.style.colorScheme=m;" +
    "try{if(localStorage.getItem('" + STORAGE_KEYS.active + "')==='1'){var c=localStorage.getItem('" + STORAGE_KEYS.draftCss + "');" +
    "if(c&&c.indexOf('" + DRAFT_CSS_MARKER + "')===0){var t=document.createElement('style');t.id='theme-draft-css';t.textContent=c;(document.head||d).appendChild(t)}}}catch(e){}" +
    "}catch(e){d.setAttribute('data-theme',P==='dark'?'dark':'light')}})();"
  );
}
