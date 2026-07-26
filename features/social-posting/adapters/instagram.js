// instagram.js — registered stub. Instagram is adapter #2; every surface
// (registry, config, UI rows, tokens) is already platform-generic so wiring
// in the real adapter later is a new file, not a refactor.

function notImplemented() {
  return Object.assign(new Error('Instagram publishing is not implemented yet.'), { status: 501, code: 'not-implemented' });
}

export async function publish() {
  throw notImplemented();
}

export async function getStatus() {
  throw notImplemented();
}

export async function disconnect() {
  throw notImplemented();
}
