// src/metrics/repQuality.js

// Turn aggregate JSON into usable “targets” for squats
export function buildSquatTargets(aggregate) {
  if (!aggregate || !aggregate.targets) return null;

  const { Top, Bottom } = aggregate.targets;

  return {
    // Depth: smaller knee angle = deeper squat
    kneeBottomTarget: aggregate.knee_bottom ?? Bottom.knee,
    kneeTopTarget: aggregate.knee_top ?? Top.knee,

    // Torso: bigger angle = more forward lean (we want to limit this)
    torsoBottomTarget: Bottom.torso,
    torsoTopTarget: Top.torso,

    // Tolerances (we can tweak these later)
    kneeSlack: 8,   // degrees above coach bottom allowed
    torsoSlack: 5,  // degrees more torso lean allowed
  };
}

// Score ONE rep against those targets
export function scoreRepAgainstTargets(rep, targets) {
  if (!rep || !targets) return null;

  // 1) Depth score – did you get close enough to coach’s bottom knee angle?
  const depthOK = rep.minKnee <= (targets.kneeBottomTarget + targets.kneeSlack);
  const depthScore = depthOK
    ? 1.0
    : clamp01(
        (targets.kneeTopTarget - rep.minKnee) /
        ((targets.kneeTopTarget) - (targets.kneeBottomTarget + targets.kneeSlack) || 1)
      );

  // 2) Torso control score – did you avoid leaning way more than the coach?
  const torsoOK = rep.maxTorso <= (targets.torsoBottomTarget + targets.torsoSlack);
  const torsoScore = torsoOK
    ? 1.0
    : clamp01(
        ((targets.torsoBottomTarget + 20) - rep.maxTorso) / 20
      );

  // 3) Overall quality (70% depth, 30% torso)
  const overall = 0.7 * depthScore + 0.3 * torsoScore;

  return {
    ...rep,
    depthOK,
    torsoOK,
    depthScore,
    torsoScore,
    qualityScore: Math.round(overall * 100), // 0–100
  };
}

// Score the whole session’s reps
export function scoreSessionReps(reps, aggregate) {
  if (!Array.isArray(reps) || !reps.length || !aggregate) return null;

  const targets = buildSquatTargets(aggregate);
  if (!targets) return null;

  const scored = reps.map(r => scoreRepAgainstTargets(r, targets));
  const valid = scored.filter(Boolean);
  if (!valid.length) return null;

  const avgScore =
    valid.reduce((sum, r) => sum + r.qualityScore, 0) / valid.length;

  const goodReps = valid.filter(r => r.depthOK && r.torsoOK).length;

  return {
    targets,
    reps: valid,
    goodReps,
    totalReps: valid.length,
    avgQuality: Math.round(avgScore),
  };
}

function clamp01(x) {
  if (Number.isNaN(x)) return 0;
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
}
