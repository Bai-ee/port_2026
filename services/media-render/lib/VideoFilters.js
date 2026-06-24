/**
 * Video Filter Presets
 * Adapted for square format (720x720) from original vertical (1080:1920) presets
 * Supports intensity scaling (0.0 = no filter, 1.0 = full intensity)
 * Current default intensity: 0.4 (40%)
 */

/**
 * Apply intensity scaling to filter parameters
 * @param {string} filterString - Original filter string
 * @param {number} intensity - Intensity from 0.0 to 1.0 (0.4 = current default)
 * @returns {string} - Scaled filter string
 */
function applyFilterIntensity(filterString, intensity = 0.4) {
  if (intensity <= 0) {
    // Return base scale/pad only (no effects)
    return 'scale=720:720:force_original_aspect_ratio=decrease,pad=720:720:(720-iw)/2:(720-ih)/2:black';
  }
  
  if (intensity >= 1.0) {
    // Return full intensity (original filter)
    return filterString;
  }
  
  // Scale parameters based on intensity
  // For intensity 0.4, values should match original
  // For intensity 0.0, values should be neutral (1.0 for multipliers, 0.0 for offsets)
  // For intensity 1.0, values should match original
  // Linear interpolation: value = base + (target - base) * (intensity / 0.4)
  
  const baseScale = filterString.includes('scale=720:720') ? 'scale=720:720:force_original_aspect_ratio=decrease,pad=720:720:(720-iw)/2:(720-ih)/2:black' : '';
  const restOfFilter = filterString.replace(/scale=[^,]+(?:,pad=[^,]+)?,?/g, '').replace(/^,/, '');
  
  if (!restOfFilter) {
    return baseScale;
  }
  
  // Scale numeric parameters in the filter
  // This is a simplified approach - we'll scale common parameters
  let scaledFilter = restOfFilter;
  
  // Scale contrast, brightness, saturation values
  // Pattern: eq=contrast=1.2 -> scale from 1.0 (neutral) to 1.2 (full) based on intensity
  scaledFilter = scaledFilter.replace(/contrast=([\d.]+)/g, (match, value) => {
    const numValue = parseFloat(value);
    const neutral = 1.0;
    const scaled = neutral + (numValue - neutral) * (intensity / 0.4);
    return `contrast=${scaled.toFixed(3)}`;
  });
  
  scaledFilter = scaledFilter.replace(/brightness=([-\d.]+)/g, (match, value) => {
    const numValue = parseFloat(value);
    const neutral = 0.0;
    const scaled = neutral + (numValue - neutral) * (intensity / 0.4);
    return `brightness=${scaled.toFixed(3)}`;
  });
  
  scaledFilter = scaledFilter.replace(/saturation=([\d.]+)/g, (match, value) => {
    const numValue = parseFloat(value);
    const neutral = 1.0;
    const scaled = neutral + (numValue - neutral) * (intensity / 0.4);
    return `saturation=${scaled.toFixed(3)}`;
  });
  
  // Scale noise intensity
  scaledFilter = scaledFilter.replace(/noise=alls=(\d+)/g, (match, value) => {
    const numValue = parseInt(value);
    const scaled = Math.round(numValue * (intensity / 0.4));
    return `noise=alls=${scaled}`;
  });
  
  // Scale vignette
  scaledFilter = scaledFilter.replace(/vignette=([\d.]+)/g, (match, value) => {
    const numValue = parseFloat(value);
    const scaled = numValue * (intensity / 0.4);
    return `vignette=${scaled.toFixed(3)}`;
  });
  
  // Scale unsharp (format: unsharp=luma_msize_x:luma_msize_y:luma_amount:chroma_msize_x:chroma_msize_y:chroma_amount)
  scaledFilter = scaledFilter.replace(/unsharp=(\d+):(\d+):([\d.]+):(\d+):(\d+):([\d.]+)/g, (match, lumaX, lumaY, lumaAmount, chromaX, chromaY, chromaAmount) => {
    const numLumaAmount = parseFloat(lumaAmount);
    const numChromaAmount = parseFloat(chromaAmount);
    const scaledLuma = numLumaAmount * (intensity / 0.4);
    const scaledChroma = numChromaAmount * (intensity / 0.4);
    return `unsharp=${lumaX}:${lumaY}:${scaledLuma.toFixed(2)}:${chromaX}:${chromaY}:${scaledChroma.toFixed(2)}`;
  });
  
  return baseScale ? `${baseScale},${scaledFilter}` : scaledFilter;
}

export const VIDEO_FILTERS = {
  'look_gritty_neon_club': {
    name: 'Gritty Neon Club',
    description: 'Punchy contrast, slight neon saturation, dirty grain',
    baseFilter: 'scale=720:720:force_original_aspect_ratio=decrease,pad=720:720:(720-iw)/2:(720-ih)/2:black,eq=contrast=1.2:brightness=-0.03:saturation=1.15,curves=all=\'0/0 0.25/0.2 0.5/0.5 0.75/0.8 1/1\',noise=alls=8:allf=t+u,vignette=0.35',
    getFilter: (intensity = 0.4) => applyFilterIntensity('scale=720:720:force_original_aspect_ratio=decrease,pad=720:720:(720-iw)/2:(720-ih)/2:black,eq=contrast=1.2:brightness=-0.03:saturation=1.15,curves=all=\'0/0 0.25/0.2 0.5/0.5 0.75/0.8 1/1\',noise=alls=8:allf=t+u,vignette=0.35', intensity)
  },
  'look_faded_90s_tape': {
    name: 'Faded 90s Tape',
    description: 'Washed, low-contrast tape feel with motion smear',
    baseFilter: 'scale=720:720:force_original_aspect_ratio=decrease,pad=720:720:(720-iw)/2:(720-ih)/2:black,eq=contrast=0.95:brightness=0.02:saturation=1.05,curves=all=\'0/0.1 0.25/0.3 0.5/0.5 0.75/0.7 1/0.9\',noise=alls=12:allf=t+u,tmix=frames=3:weights=\'1 2 1\'',
    getFilter: (intensity = 0.4) => applyFilterIntensity('scale=720:720:force_original_aspect_ratio=decrease,pad=720:720:(720-iw)/2:(720-ih)/2:black,eq=contrast=0.95:brightness=0.02:saturation=1.05,curves=all=\'0/0.1 0.25/0.3 0.5/0.5 0.75/0.7 1/0.9\',noise=alls=12:allf=t+u,tmix=frames=3:weights=\'1 2 1\'', intensity)
  },
  'look_hard_bw_street_doc': {
    name: 'Hard B&W Street Doc',
    description: 'Aggro black & white, doc-style club footage',
    baseFilter: 'scale=720:720:force_original_aspect_ratio=decrease,pad=720:720:(720-iw)/2:(720-ih)/2:black,format=gray,eq=contrast=1.45:brightness=-0.02,unsharp=7:7:0.9:7:7:0.0,vignette=0.4',
    getFilter: (intensity = 0.4) => applyFilterIntensity('scale=720:720:force_original_aspect_ratio=decrease,pad=720:720:(720-iw)/2:(720-ih)/2:black,format=gray,eq=contrast=1.45:brightness=-0.02,unsharp=7:7:0.9:7:7:0.0,vignette=0.4', intensity)
  },
  'look_camcorder_ghost': {
    name: 'Camcorder Ghost',
    description: 'Cheap DV / camcorder vibe, great for crowd shots',
    baseFilter: 'scale=720:720:force_original_aspect_ratio=decrease,pad=720:720:(720-iw)/2:(720-ih)/2:black,eq=contrast=1.05:saturation=0.85,noise=alls=10:allf=t+u,tblend=all_mode=lighten',
    getFilter: (intensity = 0.4) => applyFilterIntensity('scale=720:720:force_original_aspect_ratio=decrease,pad=720:720:(720-iw)/2:(720-ih)/2:black,eq=contrast=1.05:saturation=0.85,noise=alls=10:allf=t+u,tblend=all_mode=lighten', intensity)
  },
  'look_club_cinematic_dirty': {
    name: 'Club Cinematic Dirty',
    description: 'Cinematic contrast but still grimy',
    baseFilter: 'scale=720:720:force_original_aspect_ratio=decrease,pad=720:720:(720-iw)/2:(720-ih)/2:black,eq=contrast=1.18:brightness=-0.025:saturation=1.1,curves=all=\'0/0 0.25/0.2 0.5/0.5 0.75/0.8 1/1\',noise=alls=6:allf=t+u,vignette=0.32',
    getFilter: (intensity = 0.4) => applyFilterIntensity('scale=720:720:force_original_aspect_ratio=decrease,pad=720:720:(720-iw)/2:(720-ih)/2:black,eq=contrast=1.18:brightness=-0.025:saturation=1.1,curves=all=\'0/0 0.25/0.2 0.5/0.5 0.75/0.8 1/1\',noise=alls=6:allf=t+u,vignette=0.32', intensity)
  },
  'look_neon_nightclub': {
    name: 'Neon Nightclub',
    description: 'Crushed blacks, neon mids, for laser / LED-heavy shots',
    baseFilter: 'scale=720:720:force_original_aspect_ratio=decrease,pad=720:720:(720-iw)/2:(720-ih)/2:black,eq=brightness=-0.04:contrast=1.25:saturation=1.25,curves=g=\'0/0 0.2/0.1 0.6/0.8 1/1\',noise=alls=14:allf=t+u,vignette=0.6',
    getFilter: (intensity = 0.4) => applyFilterIntensity('scale=720:720:force_original_aspect_ratio=decrease,pad=720:720:(720-iw)/2:(720-ih)/2:black,eq=brightness=-0.04:contrast=1.25:saturation=1.25,curves=g=\'0/0 0.2/0.1 0.6/0.8 1/1\',noise=alls=14:allf=t+u,vignette=0.6', intensity)
  },
  'look_zine_posterized_color': {
    name: 'Zine Posterized Color',
    description: 'Posterized, graphic, zine / sticker-pack feel',
    baseFilter: 'scale=720:720:force_original_aspect_ratio=decrease,pad=720:720:(720-iw)/2:(720-ih)/2:black,eq=contrast=1.2:saturation=1.2,lut=r=round(val/32)*32:g=round(val/32)*32:b=round(val/32)*32,unsharp=5:5:0.8',
    getFilter: (intensity = 0.4) => applyFilterIntensity('scale=720:720:force_original_aspect_ratio=decrease,pad=720:720:(720-iw)/2:(720-ih)/2:black,eq=contrast=1.2:saturation=1.2,lut=r=round(val/32)*32:g=round(val/32)*32:b=round(val/32)*32,unsharp=5:5:0.8', intensity)
  },
  'look_pixel_grit_vertical': {
    name: 'Pixel Grit',
    description: 'Low-fi pixelated alley vibe, still readable faces',
    baseFilter: 'scale=240:240:force_original_aspect_ratio=decrease:flags=neighbor,scale=720:720:flags=neighbor,eq=contrast=1.1:saturation=1.15,noise=alls=5:allf=t+u',
    getFilter: (intensity = 0.4) => applyFilterIntensity('scale=240:240:force_original_aspect_ratio=decrease:flags=neighbor,scale=720:720:flags=neighbor,eq=contrast=1.1:saturation=1.15,noise=alls=5:allf=t+u', intensity)
  },
  'look_sodium_streetlight': {
    name: 'Sodium Streetlight',
    description: 'Warm orange club/street lighting, gritty and moody',
    baseFilter: 'scale=720:720:force_original_aspect_ratio=decrease,pad=720:720:(720-iw)/2:(720-ih)/2:black,eq=saturation=1.1:contrast=1.08,curves=r=\'0/0 0.3/0.35 1/1\':b=\'0/0 0.5/0.4 1/0.9\',noise=alls=10:allf=t+u,vignette=0.5',
    getFilter: (intensity = 0.4) => applyFilterIntensity('scale=720:720:force_original_aspect_ratio=decrease,pad=720:720:(720-iw)/2:(720-ih)/2:black,eq=saturation=1.1:contrast=1.08,curves=r=\'0/0 0.3/0.35 1/1\':b=\'0/0 0.5/0.4 1/0.9\',noise=alls=10:allf=t+u,vignette=0.5', intensity)
  }
};

/**
 * Get filter by key with optional intensity
 */
export function getFilter(key, intensity = 0.4) {
  const filterDef = VIDEO_FILTERS[key];
  if (!filterDef) return null;
  
  if (intensity !== 0.4 && filterDef.getFilter) {
    return {
      name: filterDef.name,
      description: filterDef.description,
      filter: filterDef.getFilter(intensity)
    };
  }
  
  return {
    name: filterDef.name,
    description: filterDef.description,
    filter: filterDef.baseFilter || filterDef.filter || ''
  };
}

/**
 * Get all filter keys
 */
export function getAllFilterKeys() {
  return Object.keys(VIDEO_FILTERS);
}
