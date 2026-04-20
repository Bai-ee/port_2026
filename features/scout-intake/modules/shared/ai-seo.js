'use strict';

async function runAiSeo({ websiteUrl }) {
  if (process.env.AI_SEO_AUDIT_ENABLED === '0') {
    return { ok: false, skipped: true };
  }
  try {
    const aiSeoMod = await import('../../../../ai-seo-audit/src/audit.js').catch(() => null);
    if (!aiSeoMod) return { ok: false, skipped: true };
    const aiSeoAudit = await aiSeoMod.runAiSeoAudit({ websiteUrl });
    return { ok: true, aiSeoAudit };
  } catch (err) {
    return {
      ok: false,
      warning: { type: 'warning', code: 'ai_seo_audit_failed', message: `AI visibility audit failed: ${err.message}`, stage: 'ai-seo' },
    };
  }
}

module.exports = { runAiSeo };
