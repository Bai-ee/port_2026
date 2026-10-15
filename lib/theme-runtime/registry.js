// Tiny shared registry so lazily loaded modules (draft-store) and the always-mounted
// ThemeRuntime can find each other without static imports in either direction.
//
//  - the scene bridge (lib/theme-scene/scene-bridge.js, owned by WS4) is registered by
//    ThemeRuntime; draft-store/applier look it up lazily, so tests can run without it.
//  - `studioSession` is true while this tab holds an in-memory draft; ThemeRuntime then
//    ignores site-wide draft changes broadcast by other tabs (never clobbers an active draft).

let sceneBridge = null;
let studioSession = false;

export function setSceneBridge(bridge) { sceneBridge = bridge || null; }
export function getSceneBridge() { return sceneBridge; }
export function setStudioSessionActive(on) { studioSession = !!on; }
export function isStudioSessionActive() { return studioSession; }
