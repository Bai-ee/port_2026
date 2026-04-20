'use strict';

function runSiteMeta({ evidence }) {
  const siteMeta = evidence?.pages?.find((p) => p.type === 'homepage')?.siteMeta || null;
  return { ok: Boolean(siteMeta), siteMeta };
}

module.exports = { runSiteMeta };
