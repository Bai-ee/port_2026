/**
 * Infer the best X growth objective from Marketing Brief context.
 *
 * @param {Object} ctx - Partial StrategyContext (or subset)
 * @param {Object} [ctx.intelligence]
 * @param {Object} [ctx.brief]
 * @param {Object} [ctx.campaign]
 * @returns {{ objective: string, reason: string, postTypeMix: string[] }}
 */
export function inferXObjective(ctx = {}) {
  const intel = ctx.intelligence || {};
  const brief = ctx.brief || {};
  const campaign = ctx.campaign || {};

  const kolCount = (intel.kolActivity || []).length;
  const viralCount = Array.isArray(intel.viralOpportunities)
    ? intel.viralOpportunities.length
    : 0;
  const hasCta = Boolean(campaign.ctaText || campaign.ctaUrl);
  const briefText = [brief.objectives || '', brief.positioning || '', campaign.objective || ''].join(' ').toLowerCase();
  const hasProof = Boolean(
    (intel.brandMentions || []).length ||
    /\b(result|case study|testimonial|proof|grew|increased)\b/.test(briefText)
  );
  const accountWeak = !kolCount && !viralCount && !hasCta && !hasProof;

  // Leads / calls — explicit CTA or booking objective in campaign
  if (hasCta && /\b(lead|call|book|sign.?up|appointment)\b/.test(briefText)) {
    return {
      objective: 'leads-or-calls',
      reason: 'Campaign CTA and brief objectives point toward lead capture.',
      postTypeMix: ['offer', 'proof-loop', 'authority'],
    };
  }

  // Viral / conversation — strong KOL activity or viral windows
  if (kolCount >= 2 || viralCount >= 2) {
    return {
      objective: 'qualified-conversations',
      reason: `${kolCount} KOL signal(s) and ${viralCount} viral window(s) detected — ride the conversation.`,
      postTypeMix: ['reply-loop', 'kol-adjacent', 'conversation-starter'],
    };
  }

  // Profile authority — strong proof material
  if (hasProof) {
    return {
      objective: 'profile-clicks-and-follows',
      reason: 'Proof/case study material available — convert readers to followers.',
      postTypeMix: ['proof-loop', 'case-study', 'authority'],
    };
  }

  // Leads when CTA present but no other strong signal
  if (hasCta) {
    return {
      objective: 'leads-or-calls',
      reason: 'CTA configured with no dominant viral/proof context.',
      postTypeMix: ['offer', 'authority', 'reply-loop'],
    };
  }

  // Weak / empty — build topic authority first
  if (accountWeak) {
    return {
      objective: 'topic-authority',
      reason: 'No strong KOL, viral, proof, or CTA signals — build topic authority as foundation.',
      postTypeMix: ['authority', 'conversation-starter', 'case-study'],
    };
  }

  // Default: balanced authority + conversation
  return {
    objective: 'topic-authority',
    reason: 'Mixed signals — default to topic authority with qualified conversation layer.',
    postTypeMix: ['authority', 'reply-loop', 'conversation-starter'],
  };
}
