/**
 * trajectory.js
 *
 * Helpers for working with time-series data (like pose or movement traces).
 *
 * Features:
 * - Fills missing values in a list of numbers by copying the last known value forward or backward.
 * - Lets you pull out a single number series (like all knee angles) from a list of pose frames.
 * - Lets you stretch or shrink a list of numbers to a fixed length, using smooth interpolation.
 * - Lets you do the same resampling for a list of pose frames, for multiple keys at once.
 *
 * Main functions:
 * - fillHoles: Fills missing values in a number list.
 * - extractSeries: Gets a list of numbers for one key from a list of frames.
 * - resampleSeries: Changes a number list to a new length, smoothly.
 * - resampleTrace: Changes a list of pose frames to a new length, for several keys.
 *
 * Used for: Making pose or movement data the same length and filling gaps, so you can compare or analyze them.
 */


// Linear interpolation helper (safe for nulls)
function lerp(a, b, t) {
  return a + (b - a) * t;
}

// Forward-fill / backward-fill to remove null gaps in a numeric series
export function fillHoles(series) {
  const out = series.slice();

  // forward fill
  let last = null;
  for (let i = 0; i < out.length; i++) {
    if (typeof out[i] === "number" && Number.isFinite(out[i])) last = out[i];
    else if (last !== null) out[i] = last;
  }

  // backward fill (in case it starts with nulls)
  let next = null;
  for (let i = out.length - 1; i >= 0; i--) {
    if (typeof out[i] === "number" && Number.isFinite(out[i])) next = out[i];
    else if (next !== null) out[i] = next;
  }

  return out;
}

/**
 * Extract a numeric series from a trace for a given key (and fill gaps).
 * trace: [{knee: 12, hip: 34, ...}, ...]
 */
export function extractSeries(trace, key) {
  const raw = trace.map(f => (typeof f?.[key] === "number" ? f[key] : null));
  return fillHoles(raw);
}

/**
 * Resample a numeric series to exactly N points (linear interpolation).
 */
export function resampleSeries(series, N) {
  if (!series || series.length === 0) return Array(N).fill(null);
  if (series.length === N) return series.slice();

  const out = [];
  const M = series.length;

  for (let i = 0; i < N; i++) {
    const t = (i * (M - 1)) / (N - 1);
    const idx = Math.floor(t);
    const frac = t - idx;

    const a = series[idx];
    const b = series[Math.min(idx + 1, M - 1)];

    // Both should be numbers after fillHoles, but keep it safe:
    if (typeof a === "number" && typeof b === "number") out.push(lerp(a, b, frac));
    else out.push(typeof a === "number" ? a : (typeof b === "number" ? b : null));
  }

  return out;
}

/**
 * Resample an *object trace* by resampling each key’s series and rebuilding frames.
 * keys: explicit list of numeric keys to resample.
 */
export function resampleTrace(trace, keys, N = 60) {
  if (!trace || trace.length === 0) return [];

  const resampledByKey = {};
  for (const k of keys) {
    const series = extractSeries(trace, k);
    resampledByKey[k] = resampleSeries(series, N);
  }

  // rebuild frames
  const out = [];
  for (let i = 0; i < N; i++) {
    const frame = {};
    for (const k of keys) frame[k] = resampledByKey[k][i];
    out.push(frame);
  }
  return out;
}
