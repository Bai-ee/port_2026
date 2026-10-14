import test from 'node:test';
import assert from 'node:assert/strict';
import { createIntakeStorage, STORAGE_PREFIX } from '../intake-storage.js';

// Multi-client F4: Telegram intake writes land under the chat's bound client, never a default owner.
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

test('intake storage: path and Library row follow the intake client', async () => {
  const saved = [];
  const registered = [];
  const storage = createIntakeStorage({
    bucket: { file: (p) => ({ save: async () => { saved.push(p); } }) },
    registerAsset: async (pkg) => { registered.push(pkg); },
  });
  for (const clientId of ['client-a-111', 'client-b-222']) {
    const item = await storage.store({ clientId, intakeId: `i-${clientId}`, index: 0, fileUniqueId: 'f1', buffer: PNG });
    assert.equal(item.ok, true);
    assert.ok(item.storagePath.startsWith(`${STORAGE_PREFIX}/${clientId}/`));
    await storage.register({ id: `i-${clientId}`, clientId, chatId: 1, items: [{ ...item, status: 'stored' }] });
  }
  assert.deepEqual(registered.map((p) => p.clientId), ['client-a-111', 'client-b-222']);
  assert.equal(saved.length, 2);
});
