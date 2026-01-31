// algorithm definitions for scoring a single rep
// it answers what features matter, how important each feature is, and how to combine them into a single score

import { cosineSimilarityByKey } from "../utils/squatSimilarity";
import { FRONT_KEYS, FRONT_WEIGHTS, SIDE_KEYS, SIDE_WEIGHTS } from "./scoringWeights";

export { FRONT_KEYS, FRONT_WEIGHTS, SIDE_KEYS, SIDE_WEIGHTS };

// Scores a single squat repetition against an expert reference trace
export function scoreRep({
  userTrace60,
  refTrace60,
  mode,
}) {
  const keys = mode === "front" ? FRONT_KEYS : SIDE_KEYS; //ensures the same logic works for both views 
  const weights = mode === "front" ? FRONT_WEIGHTS : SIDE_WEIGHTS;

  const sims = cosineSimilarityByKey(userTrace60, refTrace60, keys);

  let weighted = 0;
  for (const k of keys) {
    weighted += weights[k] * (sims.perKey[k] ?? 0);
  }

  const score = similarityToScore(weighted); //explicit mapping to 0-100 score

  const flags = detectFormIssues(sims.perKey, mode); //interpretability layer

  return {
    score,
    weightedSimilarity: weighted,
    perKeySimilarity: sims.perKey,
    flags,
  };
}

//quick form issue detection based on per-key similarities and thresholds
export function detectFormIssues(perKey, mode) {
  const flags = [];

  if (mode === "front") {
    if (perKey.valgus < 0.35) flags.push("Knee valgus detected"); // relaxed – only flag obvious trajectory mismatch
    if (perKey.symmetry < 0.70) flags.push("Left–right imbalance");
    if (perKey.depth < 0.65) flags.push("Insufficient depth");
  }

  if (mode === "side") {
    if (perKey.torso < 0.70) flags.push("Excessive forward lean");
    if (perKey.knee < 0.75) flags.push("Poor knee tracking");
  }

  return flags;
}

//Final score mapping from similarity (0–1) to 0–100 score
//Maps weighted cosine similarity to a 0-100 score
// Uses a minimum similarity threshold to get a non-zero score
export function similarityToScore(sim, minSim = 0.6) {
  return Math.max(
    0,
    Math.min(100, ((sim - minSim) / (1 - minSim)) * 100)
  );
}
