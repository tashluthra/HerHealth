import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  scoreRep,
  detectFormIssues,
  similarityToScore,
  FRONT_KEYS,
  SIDE_KEYS,
  FRONT_WEIGHTS,
  SIDE_WEIGHTS,
} from "../src/logic/scoreRep";
import { cosineSimilarityByKey } from "../src/utils/squatSimilarity";

// Mock cosineSimilarityByKey so we control perKey output; use real normaliseTrace
vi.mock("../src/utils/squatSimilarity", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    cosineSimilarityByKey: vi.fn((_userTrace, _refTrace, keys) => {
      const perKey = {};
      for (const k of keys) perKey[k] = 0.9; // default high similarity
      return { perKey, coverage: {} };
    }),
  };
});

describe("similarityToScore", () => {
  it("maps similarity 1 to 100", () => {
    expect(similarityToScore(1)).toBe(100);
  });

  it("maps similarity 0.6 (minSim) to 0", () => {
    expect(similarityToScore(0.6)).toBe(0);
  });

  it("maps similarity 0.8 to ~50", () => {
    const s = similarityToScore(0.8);
    expect(s).toBeGreaterThan(45);
    expect(s).toBeLessThan(55);
  });

  it("clamps below 0.6 to 0", () => {
    expect(similarityToScore(0.5)).toBe(0);
    expect(similarityToScore(0)).toBe(0);
  });

  it("clamps above 1 to 100", () => {
    expect(similarityToScore(1.2)).toBe(100);
  });

  it("allows custom minSim", () => {
    expect(similarityToScore(0.5, 0.4)).toBeGreaterThan(0);
  });
});

describe("detectFormIssues", () => {
  describe("front mode", () => {
    it("flags knee valgus when valgus < 0.35", () => {
      const perKey = { valgus: 0.3, symmetry: 0.9, pelvic: 0.9, depth: 0.9 };
      const flags = detectFormIssues(perKey, "front");
      expect(flags).toContain("Knee valgus detected");
    });

    it("does not flag valgus when valgus >= 0.35", () => {
      const perKey = { valgus: 0.4, symmetry: 0.9, pelvic: 0.9, depth: 0.9 };
      const flags = detectFormIssues(perKey, "front");
      expect(flags).not.toContain("Knee valgus detected");
    });

    it("flags left-right imbalance when symmetry < 0.70", () => {
      const perKey = { valgus: 0.9, symmetry: 0.65, pelvic: 0.9, depth: 0.9 };
      const flags = detectFormIssues(perKey, "front");
      expect(flags).toContain("Left–right imbalance");
    });

    it("flags insufficient depth when depth < 0.65", () => {
      const perKey = { valgus: 0.9, symmetry: 0.9, pelvic: 0.9, depth: 0.6 };
      const flags = detectFormIssues(perKey, "front");
      expect(flags).toContain("Insufficient depth");
    });

    it("returns empty when all above thresholds", () => {
      const perKey = { valgus: 0.8, symmetry: 0.75, pelvic: 0.9, depth: 0.7 };
      const flags = detectFormIssues(perKey, "front");
      expect(flags).toHaveLength(0);
    });

    it("can return multiple flags", () => {
      const perKey = { valgus: 0.3, symmetry: 0.6, pelvic: 0.9, depth: 0.5 };
      const flags = detectFormIssues(perKey, "front");
      expect(flags.length).toBeGreaterThanOrEqual(2);
      expect(flags).toContain("Knee valgus detected");
      expect(flags).toContain("Left–right imbalance");
      expect(flags).toContain("Insufficient depth");
    });
  });

  describe("side mode", () => {
    it("flags excessive forward lean when torso < 0.70", () => {
      const perKey = { knee: 0.9, hip: 0.9, ankle: 0.9, torso: 0.65 };
      const flags = detectFormIssues(perKey, "side");
      expect(flags).toContain("Excessive forward lean");
    });

    it("flags poor knee tracking when knee < 0.75", () => {
      const perKey = { knee: 0.7, hip: 0.9, ankle: 0.9, torso: 0.9 };
      const flags = detectFormIssues(perKey, "side");
      expect(flags).toContain("Poor knee tracking");
    });

    it("returns empty when all above thresholds", () => {
      const perKey = { knee: 0.8, hip: 0.9, ankle: 0.9, torso: 0.75 };
      const flags = detectFormIssues(perKey, "side");
      expect(flags).toHaveLength(0);
    });

    it("does not flag knee when knee >= 0.75 (boundary)", () => {
      const perKey = { knee: 0.75, hip: 0.9, ankle: 0.9, torso: 0.9 };
      const flags = detectFormIssues(perKey, "side");
      expect(flags).not.toContain("Poor knee tracking");
    });
  });

  describe("edge cases", () => {
    it("handles missing perKey values gracefully", () => {
      const perKey = { valgus: undefined, symmetry: 0.9, pelvic: 0.9, depth: 0.9 };
      const flags = detectFormIssues(perKey, "front");
      expect(Array.isArray(flags)).toBe(true);
      expect(flags).not.toContain("Knee valgus detected");
    });

    it("returns empty for unknown mode", () => {
      const perKey = { valgus: 0.3, symmetry: 0.5 };
      const flags = detectFormIssues(perKey, "unknown");
      expect(flags).toHaveLength(0);
    });
  });
});

describe("scoreRep", () => {
  beforeEach(() => {
    vi.mocked(cosineSimilarityByKey).mockImplementation((_u, _r, keys) => {
      const perKey = {};
      for (const k of keys) perKey[k] = 0.9;
      return { perKey, coverage: {} };
    });
  });

  it("returns score, weightedSimilarity, perKeySimilarity, and flags", () => {
    const user60 = Array(60).fill({ knee: 1, hip: 1, ankle: 1, torso: 1 });
    const ref60 = Array(60).fill({ knee: 1, hip: 1, ankle: 1, torso: 1 });

    const result = scoreRep({ userTrace60: user60, refTrace60: ref60, mode: "side" });

    expect(result).toHaveProperty("score");
    expect(result).toHaveProperty("weightedSimilarity");
    expect(result).toHaveProperty("perKeySimilarity");
    expect(result).toHaveProperty("flags");
    expect(Array.isArray(result.flags)).toBe(true);
  });

  it("uses FRONT_KEYS for front mode", () => {
    const user60 = Array(60).fill({ valgus: 0, symmetry: 0, pelvic: 0, depth: 0 });
    const ref60 = Array(60).fill({ valgus: 0, symmetry: 0, pelvic: 0, depth: 0 });

    scoreRep({ userTrace60: user60, refTrace60: ref60, mode: "front" });

    expect(cosineSimilarityByKey).toHaveBeenCalledWith(
      user60,
      ref60,
      expect.arrayContaining(["valgus", "symmetry", "pelvic", "depth"])
    );
  });

  it("uses SIDE_KEYS for side mode", () => {
    const user60 = Array(60).fill({ knee: 0, hip: 0, ankle: 0, torso: 0 });
    const ref60 = Array(60).fill({ knee: 0, hip: 0, ankle: 0, torso: 0 });

    scoreRep({ userTrace60: user60, refTrace60: ref60, mode: "side" });

    expect(cosineSimilarityByKey).toHaveBeenCalledWith(
      user60,
      ref60,
      expect.arrayContaining(["knee", "hip", "ankle", "torso"])
    );
  });
});

describe("scoringWeights exports", () => {
  it("FRONT_KEYS contains valgus, symmetry, pelvic, depth", () => {
    expect(FRONT_KEYS).toEqual(["valgus", "symmetry", "pelvic", "depth"]);
  });

  it("SIDE_KEYS contains knee, hip, ankle, torso", () => {
    expect(SIDE_KEYS).toEqual(["knee", "hip", "ankle", "torso"]);
  });

  it("FRONT_WEIGHTS sum to 1", () => {
    const sum = Object.values(FRONT_WEIGHTS).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1, 5);
  });

  it("SIDE_WEIGHTS sum to 1", () => {
    const sum = Object.values(SIDE_WEIGHTS).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1, 5);
  });
});
