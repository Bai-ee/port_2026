// The only place scene state is written into three.js objects. Everything mutates in place:
// `.value.set()` on existing uniforms and `Color.setRGB()` on an existing Color. No material, program,
// geometry or renderer is ever created or replaced here.
//
// Colour management (verified against three 0.165.0 / @react-three/fiber 9.5.0, see
// docs in the WS4 report and srgb-passthrough.test.js):
//   - particle colours are raw display-space numbers (Color.setHSL with the default working space is
//     a no-op conversion; the ShaderMaterial has no colorspace_fragment / tonemapping_fragment), so
//     `uHighlight` is a plain Vector3 of display-space numbers as well, never a THREE.Color;
//   - only scene.background goes through colour management: setRGB(r, g, b, 'srgb') converts once to
//     the linear working space and WebGLBackground converts back to the sRGB output space, which
//     round-trips to the original hex.

/** THREE.SRGBColorSpace (a string constant); duplicated so this module needs no import of three. */
export const SRGB_COLOR_SPACE = 'srgb';

/**
 * @param uniforms  material.uniforms with `uHighlight: {value: Vector3}` and `uHighlightMix: {value: number}`
 * @returns true when anything was written
 */
export function applyHighlightToUniforms(uniforms, state) {
  if (!uniforms || !uniforms.uHighlight || !uniforms.uHighlightMix) return false;
  uniforms.uHighlight.value.set(state.highlightR, state.highlightG, state.highlightB);
  uniforms.uHighlightMix.value = state.highlightMix;
  return true;
}

/** Neutralise the highlight (used when a canvas leaves theme mode). */
export function clearHighlightUniforms(uniforms) {
  if (!uniforms || !uniforms.uHighlightMix) return false;
  if (uniforms.uHighlightMix.value === 0) return false;
  uniforms.uHighlightMix.value = 0;
  return true;
}

/** Write the smoothed opaque background into an existing THREE.Color (the one assigned to scene.background). */
export function applyBackgroundToColor(color, state) {
  if (!color) return false;
  color.setRGB(state.backgroundR, state.backgroundG, state.backgroundB, SRGB_COLOR_SPACE);
  return true;
}
