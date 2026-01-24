import { resampleTrace } from "../utils/trajectory";

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

// Builds normalised rep data for scoring
export function buildRepData(
  userRawTrace,
  refRawTrace,
  mode,
  targetN = 60
) {
  const keys = getTraceKeys(mode);

  const userRaw = pickKeys(userRawTrace, keys);
  const refRaw  = pickKeys(refRawTrace, keys);

  const user = resampleTrace(userRaw, keys, targetN);
  const ref  = resampleTrace(refRaw,  keys, targetN);

  return { user, ref, keys, mode, targetN };
}
