'use client';

import { useCallback } from 'react';
import { readImpersonateClientId, withImpersonation } from '../../../lib/dashboard/bootstrap-session.js';

const ENDPOINT = '/api/dashboard/quote-targets';
const SOCIAL_ENDPOINT = '/api/social-posting';

// Same call/callSocial shapes as XContentEngineCard, shared by the Marketing Director strategy cards.
export function useMarketingContentCall(getIdToken) {
  const call = useCallback(async (action, body = {}) => {
    const token = getIdToken ? await getIdToken() : null;
    const res = await fetch(withImpersonation(ENDPOINT, readImpersonateClientId()), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ action, ...body }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(data?.error || `${action} failed.`), { status: res.status, data });
    return data;
  }, [getIdToken]);

  const callSocial = useCallback(async (body) => {
    const token = getIdToken ? await getIdToken() : null;
    const res = await fetch(withImpersonation(SOCIAL_ENDPOINT, readImpersonateClientId()), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(data?.error || `${body.action} failed.`), { code: data?.code || null });
    return data;
  }, [getIdToken]);

  return { call, callSocial };
}

export default useMarketingContentCall;

// Maps the string targets x-content panels pass to onNavigate onto dashboard card ids.
// Unknown targets, self-navigation, or a missing onOpenCard are all no-ops.
const NAV_TARGETS = {
  queue: 'strategy-queue-calendar', calendar: 'strategy-queue-calendar',
  strategy: 'strategy-document',
  today: 'strategy-today', plan: 'strategy-today',
  results: 'strategy-results', performance: 'strategy-results',
  inventory: 'x-content', content: 'x-content', library: 'x-content',
  telegram: 'strategy-publishing-settings', publishing: 'strategy-publishing-settings',
};

export function makeNavigate(onOpenCard, selfCardId) {
  return (target) => {
    if (typeof onOpenCard !== 'function') return;
    const cardId = NAV_TARGETS[String(target || '').toLowerCase()];
    if (!cardId || cardId === selfCardId) return;
    onOpenCard(cardId);
  };
}
