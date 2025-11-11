//Resample a trace to a fixed number of steps
// trace = [{ knee, hip, torso }, ...]
export function normaliseTrace(trace, steps = 50) {
  if (!trace || trace.length === 0) return [];
  if (trace.length === steps) return trace;

  const out = [];
  for (let i = 0; i < steps; i++) {
    const t = (i / (steps - 1)) * (trace.length - 1);
    const idx = Math.floor(t);
    const nextIdx = Math.min(idx + 1, trace.length - 1);
    const alpha = t - idx;

    const a = trace[idx];
    const b = trace[nextIdx];

    out.push({
      knee:  a.knee  + (b.knee  - a.knee)  * alpha,
      hip:   a.hip   + (b.hip   - a.hip)   * alpha,
      torso: a.torso + (b.torso - a.torso) * alpha,
    });
  }
  return out;
}

// 2) Average angular error between two normalised traces
export function averageAngleError(userTrace, refTrace) {
  const n = Math.min(userTrace.length, refTrace.length);
  if (!n) return null;

  let sum = 0;
  for (let i = 0; i < n; i++) {
    const u = userTrace[i];
    const r = refTrace[i];
    const kneeDiff  = Math.abs(u.knee  - r.knee);
    const hipDiff   = Math.abs(u.hip   - r.hip);
    const torsoDiff = Math.abs(u.torso - r.torso);

    // weights: knee most important, then hip, then torso
    const weighted =
      0.5 * kneeDiff +
      0.3 * hipDiff +
      0.2 * torsoDiff;

    sum += weighted;
  }
  return sum / n; // mean weighted error in degrees
}

// 3) Map error → 0–100 score
export function scoreFromError(avgErr, maxErr = 25) {
  if (avgErr == null) return 0;
  const clamped = Math.min(Math.max(avgErr, 0), maxErr);
  const score = 100 * (1 - clamped / maxErr);
  return Math.round(score);
}

// 4) Convenience: full pipeline in one call
export function scoreRepAgainstRef(userTrace, refTrace, steps = 50) {
  console.log("[SIM] scoreRepAgainstRef called", { userLen: userRep.length, refLen: refRep.length });
  const uNorm = normaliseTrace(userTrace, steps);
  const rNorm = normaliseTrace(refTrace, steps);
  const err   = averageAngleError(uNorm, rNorm);
  return scoreFromError(err);
}

// 5) Optional: turn score into a label/colour
export function classifyScore(score) {
  console.log("[SIM] classifyScore called with", sim);
  if (score >= 80) return "green";  // excellent
  if (score >= 60) return "amber";  // ok
  return "red";                     // needs work
}
