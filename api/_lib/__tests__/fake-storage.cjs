'use strict';

// fake-storage.cjs — minimal in-memory GCS Storage bucket for unit-testing
// studio-glb-assets.cjs's request/confirm/list/delete flow without a live
// bucket. Supports only the subset that module uses: file().getSignedUrl/
// getMetadata/download/delete, bucket.getMetadata/setMetadata (CORS). Mirrors
// fake-firestore.cjs's existing style/scope in this same directory.
//
// Tracks a monotonic `generation` per path (bumped on every `_put`, the
// test-only "simulate a completed PUT upload" helper) so tests can exercise
// studio-glb-assets.cjs's generation-pinned download exactly like the real
// GCS API does.

class FakeFile {
  constructor(bucket, path) {
    this._bucket = bucket;
    this.path = path;
  }

  async getSignedUrl(opts) {
    this._bucket._calls.getSignedUrl += 1;
    return [`https://fake-storage.example.com/${this._bucket.name}/${this.path}?action=${opts?.action || 'read'}`];
  }

  async getMetadata() {
    this._bucket._calls.getMetadata += 1;
    const obj = this._bucket._objects.get(this.path);
    if (!obj) { const e = new Error('No such object.'); e.code = 404; throw e; }
    return [{ size: String(obj.buffer.length), generation: String(obj.generation) }];
  }

  async download(opts = {}) {
    this._bucket._calls.download += 1;
    const obj = this._bucket._objects.get(this.path);
    if (!obj) { const e = new Error('No such object.'); e.code = 404; throw e; }
    if (opts.generation !== undefined && String(opts.generation) !== String(obj.generation)) {
      const e = new Error('Generation mismatch — object was replaced.'); e.code = 404; throw e;
    }
    return [obj.buffer];
  }

  async delete() {
    this._bucket._calls.delete += 1;
    this._bucket._objects.delete(this.path);
  }

  exists() {
    return this._bucket._objects.has(this.path);
  }

  /** Test-only: simulate a completed browser PUT upload to this path. */
  _put(buffer) {
    const prev = this._bucket._objects.get(this.path);
    const generation = (prev?.generation || 0) + 1;
    this._bucket._objects.set(this.path, { buffer, generation });
    return generation;
  }
}

class FakeBucket {
  constructor(name = 'fake-studio-bucket') {
    this.name = name;
    this._objects = new Map();
    this._metadata = { cors: [] };
    this._calls = { getSignedUrl: 0, getMetadata: 0, download: 0, delete: 0 };
  }

  file(path) { return new FakeFile(this, String(path)); }
  async getMetadata() { return [this._metadata]; }
  async setMetadata(patch) { this._metadata = { ...this._metadata, ...patch }; }
}

function makeFakeStorageContext(bucket = new FakeBucket()) {
  return { adminStorage: { bucket: () => bucket }, _bucket: bucket };
}

module.exports = { FakeBucket, FakeFile, makeFakeStorageContext };
