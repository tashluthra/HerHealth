import { resampleTrace, resampleTraceByPhase } from "../utils/trajectory";

// Returns the relevant trace keys for the given mode
export function getTraceKeys(mode) {
  if (mode === "front") return ["valgus", "symmetry", "pelvic", "depth"];
  if (mode === "side")  return ["knee", "hip", "torso", "ankle"];
  throw new Error(`Unknown mode: ${mode}`);
}

// Keeps only the keys we care about (everything else is ignored)
function pickKeys(trace, keys) {
  return (trace || []).map(frame => {
    const out = {};
    for (const k of keys) out[k] = frame?.[k] ?? null;
    return out;
  });
}

// Detect bottom frame index for phase-based resampling.
// Side: min knee angle = bottom. Front: max depth = bottom.
function detectBottom(trace, keys, mode) {
  if (!trace || trace.length < 3) return null;
  if (mode === "side") {
    const kneeKey = "knee";
    if (!keys.includes(kneeKey)) return null;
    let minVal = Infinity;
    let minIdx = -1;
    for (let i = 0; i < trace.length; i++) {
      const v = trace[i]?.[kneeKey];
      if (typeof v === "number" && Number.isFinite(v) && v < minVal) {
        minVal = v;
        minIdx = i;
      }
    }
    return minIdx >= 0 ? minIdx : null;
  }
  if (mode === "front") {
    const depthKey = "depth";
    if (!keys.includes(depthKey)) return null;
    let maxVal = -Infinity;
    let maxIdx = -1;
    for (let i = 0; i < trace.length; i++) {
      const v = trace[i]?.[depthKey];
      if (typeof v === "number" && Number.isFinite(v) && v > maxVal) {
        maxVal = v;
        maxIdx = i;
      }
    }
    return maxIdx >= 0 ? maxIdx : null;
  }
  return null;
}

// Builds normalised rep data for scoring.
// Uses phase-based resampling for user trace when valid bottom detected (aligns bottom at frame 30).
// Ref is already phase-aligned from backend.
export function buildRepData(
  userRawTrace,
  refRawTrace,
  mode,
  targetN = 60
) {
  const keys = getTraceKeys(mode);

  const userRaw = pickKeys(userRawTrace, keys);
  const refRaw  = pickKeys(refRawTrace, keys);

  const bottomIdx = detectBottom(userRaw, keys, mode);
  const user = (bottomIdx != null && bottomIdx > 0 && bottomIdx < userRaw.length - 1)
    ? resampleTraceByPhase(userRaw, keys, bottomIdx, targetN)
    : resampleTrace(userRaw, keys, targetN);
  const ref  = resampleTrace(refRaw,  keys, targetN);

  return { user, ref, keys, mode, targetN };
}
