// squatSimilarity.js
// Mode-aware trajectory similarity with resampling + weighted mean absolute error.
// Supports:
// - side:  hip, knee, ankle, torso
// - front: valgus, symmetry, pelvic, depth

const MODE_SPECS = {
  side: {
    keys: ["knee", "hip", "ankle", "torso"],
    weights: { knee: 0.35, hip: 0.35, ankle: 0.10, torso: 0.20},
    maxErr: 0.35, // degrees-ish; tune later with data
  },
  front: {
    keys: ["valgus", "symmetry", "pelvic", "depth"],
    weights: { valgus: 0.40, symmetry: 0.30, pelvic: 0.20, depth: 0.10 },
    maxErr: 0.25, // these are normalised ratios; tune later with data
  },
};

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
      frame[k] =
        typeof av === "number" && typeof bv === "number"
          ? av + (bv - av) * alpha
          : null;
    }
    out.push(frame);
  }

  //Baseline normalisation (REMOVE absolute offsets)
  const base = {};
  for (const k of keys) {
    base[k] = typeof out[0]?.[k] === "number" ? out[0][k] : null;
  }

  for (const frame of out) {
    for (const k of keys) {
      if (typeof frame[k] === "number" && typeof base[k] === "number") {
        frame[k] = frame[k] - base[k];
      }
    }
  }

  return out;
}

// Scale each channel to 0–1 within this rep so we compare shape, not absolute angles.
function normaliseByRange(trace, keys) {
  if (!trace?.length) return trace;

  // find min/max per key (ignore nulls)
  const mins = {};
  const maxs = {};
  for (const k of keys) {
    mins[k] = Infinity;
    maxs[k] = -Infinity;
  }

  for (const f of trace) {
    for (const k of keys) {
      const v = f?.[k];
      if (typeof v !== "number") continue;
      if (v < mins[k]) mins[k] = v;
      if (v > maxs[k]) maxs[k] = v;
    }
  }

  return trace.map(f => {
    const out = { ...f };
    for (const k of keys) {
      const v = f?.[k];
      if (typeof v !== "number") { out[k] = null; continue; }

      const lo = mins[k], hi = maxs[k];
      const range = (hi - lo);

      // if channel barely changes, set it to 0 (it carries no shape info)
      out[k] = range > 1e-6 ? (v - lo) / range : 0;
    }
    return out;
  });
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

  // compare shape (0–1 scaled per-channel)
  const uScaled = normaliseByRange(uNorm, keys);
  const rScaled = normaliseByRange(rNorm, keys);

  const err = averageWeightedError(uScaled, rScaled, keys, weights);
  const score = scoreFromError(err, spec.maxErr);

  return { score, err };
}

export function classifyScore(score) {
  if (score >= 80) return "green";
  if (score >= 60) return "amber";
  return "red";
}

// utils/squatSimilarity.js

function isNum(x) {
  return typeof x === "number" && Number.isFinite(x);
}

// Dot product + norms for cosine
function dot(a, b) {
  let s = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) s += a[i] * b[i];
  return s;
}

function norm(a) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * a[i];
  return Math.sqrt(s);
}

/**
 * Cosine similarity between two numeric vectors.
 * Returns a number in [-1, 1]. We clamp just in case of tiny float overshoots.
 *
 * Edge cases:
 * - if either norm is ~0: returns 0 (no reliable directional similarity)
 */
function cosineVec(u, r) { const nu = norm(u); const nr = norm(r); if (nu < 1e-9 || nr < 1e-9) return 0; const c = dot(u, r) / (nu * nr); return Math.max(-1, Math.min(1, c)); }



/**
 * Build vectors from traces and compute cosine similarity per key.
 * user60/ref60 are arrays of frames, e.g. [{knee: 170, ...}, ...] length 60.
 *
 * Returns:
 * {
 *   perKey: { knee: 0.93, hip: 0.88, ... },
 *   coverage: { knee: { user: 60, ref: 60 }, ... }  // numeric counts used
 * }
 */
export function cosineSimilarityByKey(userTrace, refTrace, keys) {
  const perKey = {};
  const coverage = {};

  for (const k of keys) {
    // Extract numbers only, but keep alignment by index:
    // we’ll create vectors where we only keep indices where BOTH are numeric
    const u = [];
    const r = [];
    const n = Math.min(userTrace.length, refTrace.length);

    let uCount = 0;
    let rCount = 0;
    let bothCount = 0;

    for (let i = 0; i < n; i++) {
      const uv = userTrace[i]?.[k];
      const rv = refTrace[i]?.[k];
      if (isNum(uv)) uCount += 1;
      if (isNum(rv)) rCount += 1;

      if (isNum(uv) && isNum(rv)) {
        u.push(uv);
        r.push(rv);
        bothCount += 1;
      }
    }
    coverage[k] = { user: uCount, ref: rCount, both: bothCount };
    // If we barely have overlapping numeric points, treat similarity as 0
    if (bothCount < 5) {
      perKey[k] = 0;
      continue;
    }
    perKey[k] = cosineVec(u, r);
  }
  return { perKey, coverage };
}