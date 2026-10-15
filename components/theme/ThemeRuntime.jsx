'use client';

// Mounted once in the root layout (contract §15.2). Renders nothing. Responsibilities:
//  - start the preference store (OS changes while preference is 'system', cross-tab pref sync)
//  - hand the production scene palettes and the current mode to the scene bridge
//  - rehydrate / follow the site-wide applied Studio draft (draft scene + style element)
//  - dispatch `theme:tokens-changed` once after mount so JS consumers read the final tokens
// Main-bundle safe: imports the pref store and the slim generated runtime data only.

import { useEffect } from 'react';
import runtimeData from '../../lib/theme/production/resolved.runtime.generated.js';
import { STORAGE_KEYS } from '../../lib/theme/constants.js';
import { getPrefStore } from '../../lib/theme-runtime/pref-store.js';
import { createSafeStorage, localSource } from '../../lib/theme-runtime/storage.js';
import { emitTokensChanged } from '../../lib/theme-runtime/read-token.js';
import { setSceneBridge } from '../../lib/theme-runtime/registry.js';
import { syncSiteDraft } from '../../lib/theme-runtime/site-draft.js';
import { sceneBridge } from '../../lib/theme-scene/scene-bridge.js';

// Module scope on purpose: child scene components may read the bridge in their own effects, which
// run before this component's effect. The bootstrap has already set data-theme, so the very first
// frame uses the right palette.
if (sceneBridge) {
  setSceneBridge(sceneBridge);
  sceneBridge.setProduction({ light: runtimeData.light.scene, dark: runtimeData.dark.scene });
  if (typeof document !== 'undefined') {
    sceneBridge.setMode(document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light');
  }
}

const SITE_DRAFT_KEYS = [STORAGE_KEYS.active, STORAGE_KEYS.draftCss, STORAGE_KEYS.draftScene];

export default function ThemeRuntime() {
  useEffect(() => {
    const prefStore = getPrefStore();
    const stopPref = prefStore.start();

    const syncMode = () => {
      if (sceneBridge) sceneBridge.setMode(prefStore.getSnapshot().resolvedMode);
    };
    syncMode();
    const unsubscribe = prefStore.subscribe(syncMode);

    // Applied Studio draft: follow it in this tab, and when another tab applies/reverts it.
    const safe = createSafeStorage(localSource);
    syncSiteDraft(safe);
    const onStorage = (event) => {
      if (event.key === null || SITE_DRAFT_KEYS.includes(event.key)) {
        syncSiteDraft(safe);
        emitTokensChanged();
      }
    };
    window.addEventListener('storage', onStorage);

    emitTokensChanged();

    return () => {
      window.removeEventListener('storage', onStorage);
      unsubscribe();
      stopPref();
    };
  }, []);

  return null;
}
