// Reducer for Studio-only UI state (what is open, which popover is on top, the
// advanced-role filter, the import box). The theme itself lives in the draft
// store; nothing here is persisted.

export const SECTION_IDS = Object.freeze(['mode', 'master', 'combos', 'library', 'palette', 'scene', 'advanced', 'accessibility', 'compare', 'export']);

export function initialUiState(overrides = {}) {
  return {
    openSections: { mode: true, master: true, combos: true, library: false, palette: false, scene: false, advanced: false, accessibility: false, compare: false, export: false },
    openGroups: {},
    expandedRoles: {},
    focusRole: null,
    popovers: [],
    roleFilter: { query: '', onlyCustom: false, onlyFailing: false },
    a11yFilter: 'failing',
    a11yMode: null,
    importText: '',
    importResult: null,
    origin: 'production',
    // --- Studio v2 / P2 (colour picker) -------------------------------------
    fullRange: false, // session-only; true = hard slider bounds, advisory range warnings hidden
    colorPicker: null, // { roleId, mode } of the role whose picker is open
    // -------------------------------------------------------------------------
    ...overrides,
  };
}

function toggle(map, key, force) {
  const cur = !!map[key];
  const next = typeof force === 'boolean' ? force : !cur;
  return next === cur ? map : { ...map, [key]: next };
}

export function uiReducer(state, action) {
  switch (action.type) {
    case 'section/toggle': {
      const openSections = toggle(state.openSections, action.id, action.open);
      return openSections === state.openSections ? state : { ...state, openSections };
    }
    case 'group/toggle': {
      const openGroups = toggle(state.openGroups, action.id, action.open);
      return openGroups === state.openGroups ? state : { ...state, openGroups };
    }
    case 'role/toggle': {
      const expandedRoles = toggle(state.expandedRoles, action.id, action.open);
      return expandedRoles === state.expandedRoles ? state : { ...state, expandedRoles };
    }
    case 'role/reveal': {
      // Jump from a summary row to the full editor: open Advanced, the group, the role.
      return {
        ...state,
        openSections: { ...state.openSections, advanced: true },
        openGroups: { ...state.openGroups, [action.group]: true },
        expandedRoles: { ...state.expandedRoles, [action.id]: true },
        focusRole: action.id,
        roleFilter: { ...state.roleFilter, query: '' },
      };
    }
    case 'role/focused':
      return state.focusRole === null ? state : { ...state, focusRole: null };
    case 'popover/open': {
      if (state.popovers.includes(action.id)) return state;
      return { ...state, popovers: [...state.popovers, action.id] };
    }
    case 'popover/close': {
      if (!state.popovers.includes(action.id)) return state;
      return { ...state, popovers: state.popovers.filter((p) => p !== action.id) };
    }
    case 'popover/closeTop':
      return state.popovers.length ? { ...state, popovers: state.popovers.slice(0, -1) } : state;
    case 'filter/set':
      return { ...state, roleFilter: { ...state.roleFilter, ...action.patch } };
    case 'a11y/filter':
      return state.a11yFilter === action.value ? state : { ...state, a11yFilter: action.value };
    case 'a11y/mode':
      return state.a11yMode === action.value ? state : { ...state, a11yMode: action.value };
    case 'import/text':
      return { ...state, importText: action.text, importResult: null };
    case 'import/result':
      return { ...state, importResult: action.result };
    case 'origin/set':
      return state.origin === action.value ? state : { ...state, origin: action.value };
    // --- Studio v2 / P2 (colour picker) -------------------------------------
    case 'fullRange/set': {
      const value = typeof action.value === 'boolean' ? action.value : !state.fullRange;
      return value === state.fullRange ? state : { ...state, fullRange: value };
    }
    case 'colorPicker/open': {
      const cur = state.colorPicker;
      const popovers = state.popovers.includes(COLOR_PICKER_POPOVER) ? state.popovers : [...state.popovers, COLOR_PICKER_POPOVER];
      if (cur && cur.roleId === action.roleId && cur.mode === action.mode && popovers === state.popovers) return state;
      return { ...state, colorPicker: { roleId: action.roleId, mode: action.mode }, popovers };
    }
    case 'colorPicker/close': {
      if (!state.colorPicker && !state.popovers.includes(COLOR_PICKER_POPOVER)) return state;
      return { ...state, colorPicker: null, popovers: state.popovers.filter((p) => p !== COLOR_PICKER_POPOVER) };
    }
    // -------------------------------------------------------------------------
    default:
      return state;
  }
}

/** Popover id of the colour picker (Esc order uses the shared popovers stack). */
export const COLOR_PICKER_POPOVER = 'ts-color-picker-popover';

/** Is the picker open for this role? (Esc closes via popover/closeTop, so check both.) */
export const isColorPickerOpen = (state, roleId, mode) => !!state.colorPicker
  && state.colorPicker.roleId === roleId && state.colorPicker.mode === mode
  && state.popovers.includes(COLOR_PICKER_POPOVER);

export const topPopover = (state) => (state.popovers.length ? state.popovers[state.popovers.length - 1] : null);
