// tshirt-model async load status → Inspector view (Codex P1 review round
// 2). Pure logic — no React, no three.js — so the Inspector's actual
// decisions (when to show a status line, when to show Retry, what the
// message says) are unit-testable without a JSX/DOM render environment,
// which this repo doesn't have configured (npm test's glob only picks up
// .test.{js,mjs} — no .jsx transform). StudioElementInspector.jsx's
// LoadStatusBanner is a thin wrapper that just renders whatever this
// returns; the actual view logic lives here where it can be tested
// directly, same split already established by capability.js.
//
// `loadStatus` is whatever ClothStudio.jsx's runtime status map holds for
// the selected instance's id — `{state, error}` as reported by
// elements/factories.js's tshirtModelReportStatus, or undefined/null if
// nothing has ever been reported (idle, or no tshirt-model selected).

export function tshirtModelLoadStatusView(loadStatus) {
  const state = loadStatus?.state;
  if (!loadStatus || state === 'idle' || state === 'loaded' || state === 'disposed') {
    return { visible: false };
  }
  if (state === 'loading') {
    return { visible: true, kind: 'loading', message: 'Loading 3D T-shirt…', showRetry: false };
  }
  // 'error' — the only state that needs an actionable, visible banner.
  return {
    visible: true,
    kind: 'error',
    message: loadStatus.error ? `Model failed to load: ${loadStatus.error}` : 'Model failed to load.',
    showRetry: true,
  };
}
