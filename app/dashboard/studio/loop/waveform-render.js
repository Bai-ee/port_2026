// Loop Studio — waveform peak reduction + canvas draw. `computePeaks` is
// pure math (same tier as loop-engine.js, directly testable under
// node:test); `drawWaveform` is a thin canvas-2D draw step (takes a caller-
// supplied `CanvasRenderingContext2D`, so it only runs in a browser, but
// does no DOM lookups or sizing of its own — the caller owns the canvas
// element and any devicePixelRatio scaling).

/**
 * Reduces one or more Float32Array channels (as from
 * `AudioBuffer.getChannelData`) to `buckets` per-bucket min/max pairs over
 * a mono downmix (the average of all channels at each sample), for a
 * cheap-to-draw waveform overview. Never allocates a full-length mono
 * downmix array — each sample's mono value is computed and folded into its
 * bucket's running min/max in a single pass over the source samples.
 *
 * Returns `{ min: Float32Array, max: Float32Array }`, both length
 * `buckets`. A bucket that received no samples (buckets > totalSamples, or
 * degenerate input) reads 0 in both arrays.
 */
export function computePeaks(channelData, buckets) {
  const channels = Array.isArray(channelData)
    ? channelData.filter((c) => c && typeof c.length === 'number')
    : [];
  const numChannels = channels.length;
  const totalSamples = numChannels > 0 ? channels[0].length : 0;
  const bucketCount = Number.isFinite(buckets) && buckets > 0 ? Math.floor(buckets) : 0;

  const min = new Float32Array(bucketCount);
  const max = new Float32Array(bucketCount);
  if (bucketCount === 0 || totalSamples === 0 || numChannels === 0) return { min, max };

  min.fill(Infinity);
  max.fill(-Infinity);

  const samplesPerBucket = totalSamples / bucketCount;
  for (let i = 0; i < totalSamples; i += 1) {
    let sum = 0;
    for (let ch = 0; ch < numChannels; ch += 1) sum += channels[ch][i];
    const value = sum / numChannels;

    let bucketIdx = Math.floor(i / samplesPerBucket);
    if (bucketIdx >= bucketCount) bucketIdx = bucketCount - 1;

    if (value < min[bucketIdx]) min[bucketIdx] = value;
    if (value > max[bucketIdx]) max[bucketIdx] = value;
  }

  // Buckets that never received a sample (only possible for degenerate/tiny
  // inputs) still carry their +/-Infinity seed — normalize those to 0.
  for (let b = 0; b < bucketCount; b += 1) {
    if (min[b] === Infinity) min[b] = 0;
    if (max[b] === -Infinity) max[b] = 0;
  }

  return { min, max };
}

/**
 * Draws `peaks` (from computePeaks) onto `ctx` as vertical min/max bars
 * centered on the canvas's vertical midline, filling `{ width, height }`
 * CSS pixels — the caller is responsible for any devicePixelRatio
 * transform already applied to `ctx` before this runs. `color` fills the
 * bars; a faint 1px horizontal line marks dead-center when `centerLine`.
 */
export function drawWaveform(ctx, peaks, { width, height, color = '#1a1a1a', centerLine = true } = {}) {
  if (!ctx || !peaks) return;
  const minArr = peaks.min || [];
  const maxArr = peaks.max || [];
  const bucketCount = Math.min(minArr.length, maxArr.length);
  const w = Number.isFinite(width) && width > 0 ? width : 0;
  const h = Number.isFinite(height) && height > 0 ? height : 0;
  if (w === 0 || h === 0 || bucketCount === 0) return;

  const centerY = h / 2;
  const barWidth = Math.max(1, w / bucketCount);

  ctx.save();
  ctx.fillStyle = color;
  for (let i = 0; i < bucketCount; i += 1) {
    const mn = Number.isFinite(minArr[i]) ? minArr[i] : 0;
    const mx = Number.isFinite(maxArr[i]) ? maxArr[i] : 0;
    const yTop = centerY - Math.max(mx, 0) * centerY;
    const yBottom = centerY - Math.min(mn, 0) * centerY;
    const barHeight = Math.max(1, yBottom - yTop);
    ctx.fillRect(i * (w / bucketCount), yTop, barWidth, barHeight);
  }
  ctx.restore();

  if (centerLine) {
    ctx.save();
    ctx.globalAlpha = 0.35;
    ctx.fillStyle = color;
    ctx.fillRect(0, Math.max(0, centerY - 0.5), w, 1);
    ctx.restore();
  }
}
