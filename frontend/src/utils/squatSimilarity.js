// squatSimilarity.js
// Mode-aware trajectory similarity with resampling + weighted mean absolute error.
// Supports:
// - side:  hip, knee, ankle, torso
// - front: valgus, symmetry, pelvic, depth

const MODE_SPECS = {
  side: {
    keys: ["knee", "hip", "torso", "ankle"],
    weights: { knee: 0.35, hip: 0.35, torso: 0.20, ankle: 0.10 },
    maxErr: 25, // degrees-ish; tune later with data
  },
  front: {
    keys: ["valgus", "symmetry", "pelvic", "depth"],
    weights: { valgus: 0.40, symmetry: 0.30, pelvic: 0.20, depth: 0.10 },
    maxErr: 0.25, // these are normalised ratios; tune later with data
  },
};

// Generic resample for a list of keys (linear interpolation per channel)
export function normaliseTrace(trace, keys, steps = 60) {
  if (!trace || trace.length === 0) return [];
  if (!keys || keys.length === 0) return [];
  if (trace.length === steps) return trace;

  const out = [];
  for (let i = 0; i < steps; i++) {
    const t = (i / (steps - 1)) * (trace.length - 1);
    const idx = Math.floor(t);
    const nextIdx = Math.min(idx + 1, trace.length - 1);
    const alpha = t - idx;

    const a = trace[idx] || {};
    const b = trace[nextIdx] || {};

    const frame = {};
    for (const k of keys) {
      const av = a[k];
      const bv = b[k];
      // If either is missing, keep null so scorer can ignore that channel safely.
      frame[k] =
        typeof av === "number" && typeof bv === "number"
          ? av + (bv - av) * alpha
          : null;
    }
    out.push(frame);
  }
  return out;
}

function meanAbsDiff(a, b) {
  return Math.abs(a - b);
}

// Weighted mean absolute error across channels and time
export function averageWeightedError(userTrace, refTrace, keys, weights) {
  const n = Math.min(userTrace.length, refTrace.length);
  if (!n) return null;

  let sum = 0;
  let count = 0;

  for (let i = 0; i < n; i++) {
    const u = userTrace[i] || {};
    const r = refTrace[i] || {};

    let frameErr = 0;
    let frameW = 0;

    for (const k of keys) {
      const uv = u[k];
      const rv = r[k];
      if (typeof uv !== "number" || typeof rv !== "number") continue;

      const w = weights[k] ?? 0;
      frameErr += w * meanAbsDiff(uv, rv);
      frameW += w;
    }

    // Only count frame if we had at least one valid channel
    if (frameW > 1e-6) {
      sum += frameErr / frameW; // normalise by present weights
      count += 1;
    }
  }

  return count ? sum / count : null;
}

// Map error -> 0–100
export function scoreFromError(avgErr, maxErr) {
  if (avgErr == null) return 0;
  const clamped = Math.min(Math.max(avgErr, 0), maxErr);
  const score = 100 * (1 - clamped / maxErr);
  return Math.round(score);
}

// Main entry point
export function scoreRepAgainstRef(userTrace, refTrace, mode = "side", steps = 60) {
  const spec = MODE_SPECS[mode] || MODE_SPECS.side;
  const keys = spec.keys;
  const weights = spec.weights;

  const uNorm = normaliseTrace(userTrace, keys, steps);
  const rNorm = normaliseTrace(refTrace, keys, steps);

  const err = averageWeightedError(uNorm, rNorm, keys, weights);
  return scoreFromError(err, spec.maxErr);
}

export function classifyScore(score) {
  if (score >= 80) return "green";
  if (score >= 60) return "amber";
  return "red";
}
