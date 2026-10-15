'use client';

import React from 'react';
import ThemeStudioShell from './ThemeStudioShell.jsx';
import { getDraftStore } from '../../lib/theme-runtime/draft-store.js';

/**
 * Lazy-loaded entry (contract 11.1): components/theme/ThemeStudioMount.jsx loads
 * this with dynamic(() => import('../theme-studio/ThemeStudio'), { ssr: false }).
 * Props (as passed by ThemeStudioMount): { open, onClose, launcherId }. `open` is implied by
 * mounting. `store` and `returnFocusId` are optional overrides.
 * It binds the shell to the runtime draft store; tests and previews render
 * ThemeStudioShell with a fake store instead.
 */
export default function ThemeStudio({
  onClose, store, launcherId, returnFocusId,
}) {
  const draftStore = React.useMemo(() => store || getDraftStore(), [store]);
  return <ThemeStudioShell store={draftStore} onClose={onClose} returnFocusId={returnFocusId || launcherId} />;
}
