/**
 * Research decision: relative importance of each feature for squat rep quality.
 * Weights must sum to 1.0. Used by squatSimilarity.js and scoreRep.js.
 */
export const FRONT_KEYS = ["valgus", "symmetry", "pelvic", "depth"];
export const SIDE_KEYS = ["knee", "hip", "ankle", "torso"];

export const FRONT_WEIGHTS = {
  valgus: 0.40,
  symmetry: 0.25,
  pelvic: 0.20,
  depth: 0.15,
};

export const SIDE_WEIGHTS = {
  knee: 0.35,
  hip: 0.25,
  ankle: 0.15,
  torso: 0.25,
};
