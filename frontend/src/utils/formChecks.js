// Simple thresholds for form checks.
// You can tweak these later or make them user-specific.
export const FORM_THRESHOLDS = {
  // Depth: smaller knee angle at the bottom = deeper squat.
  // If your coach / reference data suggests a different value, adjust this.
  minDepthKnee: 115,       // degrees or less at bottom = "deep enough"
  // Forward lean: torso angle from vertical. Bigger = more forward.
  maxForwardTorso: 45,     // keep chest within ~45° of upright
  // Valgus: our metric is "feet width – knee width" in normalised x.
  // Bigger positive value = knees closer together than feet.
  maxValgusMetric: 0.04,   // ~4% of frame width
};

// rep = { minKnee, maxTorso, valgusMetric?, ... }
// opts lets you override thresholds if needed.
export function checkForm(rep, opts = {}) {
  const cfg = { ...FORM_THRESHOLDS, ...opts };

  const issues = [];

  // 1) Depth
  const depthOK =
    typeof rep.minKnee === "number" &&
    rep.minKnee <= cfg.minDepthKnee;

  if (!depthOK) {
    issues.push("Go a bit deeper – aim to bend your knees more at the bottom.");
  }

  // 2) Forward lean
  const forwardLeanOK =
    typeof rep.maxTorso === "number" &&
    rep.maxTorso <= cfg.maxForwardTorso;

  if (!forwardLeanOK) {
    issues.push("Try to keep your chest a little more upright.");
  }

  // 3) Knee valgus (only meaningful in front view)
  // valgusMetric is bigger when knees come closer together than feet.
  let valgusOK = true;
  if (typeof rep.valgusMetric === "number") {
    valgusOK = rep.valgusMetric <= cfg.maxValgusMetric;
    if (!valgusOK) {
      issues.push("Keep your knees tracking over your toes – avoid them collapsing inwards.");
    }
  }

  const overallOK = depthOK && forwardLeanOK && valgusOK;

  return {
    depthOK,
    forwardLeanOK,
    valgusOK,
    overallOK,
    issues,
  };
}
