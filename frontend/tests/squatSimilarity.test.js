import { describe, it, expect } from "vitest";
import {
  normaliseTrace,
  averageWeightedError,
  scoreFromError,
  scoreRepAgainstRef,
  classifyScore,
  cosineSimilarityByKey,
} from "../src/utils/squatSimilarity";

function makeTrace(n, fn = (i) => ({ knee: i, hip: i * 2, torso: 100 - i, ankle: i % 5 })) {
  return Array.from({ length: n }, (_, i) => fn(i));
}

describe("normaliseTrace", () => {
  const keys = ["knee", "hip", "torso", "ankle"];

  it("returns empty array for empty trace", () => {
    expect(normaliseTrace([], keys)).toEqual([]);
    expect(normaliseTrace(null, keys)).toEqual([]);
  });

  it("returns empty array for empty keys", () => {
    expect(normaliseTrace(makeTrace(10), [])).toEqual([]);
  });

  it("resamples to 60 frames when input is different length", () => {
    const raw = makeTrace(30);
    const out = normaliseTrace(raw, keys, 60);
    expect(out).toHaveLength(60);
  });

  it("preserves 60 frames when input is already 60", () => {
    const raw = makeTrace(60);
    const out = normaliseTrace(raw, keys, 60);
    expect(out).toHaveLength(60);
  });

  it("applies baseline subtraction so first frame values are ~0", () => {
    const raw = makeTrace(60);
    const out = normaliseTrace(raw, keys, 60);
    for (const k of keys) {
      expect(out[0][k]).toBeCloseTo(0, 10);
    }
  });

  it("produces finite numbers for finite input", () => {
    const raw = makeTrace(60);
    const out = normaliseTrace(raw, keys, 60);
    for (const frame of out) {
      for (const k of keys) {
        expect(Number.isFinite(frame[k])).toBe(true);
      }
    }
  });
});

describe("averageWeightedError", () => {
  const keys = ["knee", "hip"];
  const weights = { knee: 0.5, hip: 0.5 };

  it("returns null for empty traces", () => {
    expect(averageWeightedError([], [], keys, weights)).toBe(null);
    expect(averageWeightedError(makeTrace(5), [], keys, weights)).toBe(null);
  });

  it("returns 0 when traces are identical", () => {
    const t = makeTrace(10);
    const err = averageWeightedError(t, t, keys, weights);
    expect(err).toBe(0);
  });

  it("returns positive error when traces differ", () => {
    const u = makeTrace(10, (i) => ({ knee: i, hip: i }));
    const r = makeTrace(10, (i) => ({ knee: i + 5, hip: i }));
    const err = averageWeightedError(u, r, keys, weights);
    expect(err).toBeGreaterThan(0);
  });
});

describe("scoreFromError", () => {
  it("returns 0 for null", () => {
    expect(scoreFromError(null, 0.5)).toBe(0);
  });

  it("returns 100 when error is 0", () => {
    expect(scoreFromError(0, 0.5)).toBe(100);
  });

  it("returns 0 when error >= maxErr", () => {
    expect(scoreFromError(0.5, 0.5)).toBe(0);
    expect(scoreFromError(1, 0.5)).toBe(0);
  });

  it("returns intermediate score for intermediate error", () => {
    const s = scoreFromError(0.25, 0.5);
    expect(s).toBeGreaterThan(0);
    expect(s).toBeLessThan(100);
  });
});

describe("scoreRepAgainstRef", () => {
  it("returns score and err for side mode", () => {
    const user = makeTrace(50);
    const ref = makeTrace(60);
    const result = scoreRepAgainstRef(user, ref, "side", 60);
    expect(result).toHaveProperty("score");
    expect(result).toHaveProperty("err");
    expect(typeof result.score).toBe("number");
    expect(typeof result.err).toBe("number");
  });

  it("returns score and err for front mode", () => {
    const user = makeTrace(50, (i) => ({ valgus: i * 0.01, symmetry: 1, pelvic: 0, depth: i }));
    const ref = makeTrace(60, (i) => ({ valgus: i * 0.01, symmetry: 1, pelvic: 0, depth: i }));
    const result = scoreRepAgainstRef(user, ref, "front", 60);
    expect(result).toHaveProperty("score");
    expect(result).toHaveProperty("err");
  });
});

describe("classifyScore", () => {
  it("returns green for score >= 80", () => {
    expect(classifyScore(80)).toBe("green");
    expect(classifyScore(100)).toBe("green");
  });

  it("returns amber for 60 <= score < 80", () => {
    expect(classifyScore(60)).toBe("amber");
    expect(classifyScore(79)).toBe("amber");
  });

  it("returns red for score < 60", () => {
    expect(classifyScore(59)).toBe("red");
    expect(classifyScore(0)).toBe("red");
  });
});

describe("cosineSimilarityByKey", () => {
  it("returns perKey and coverage for matching vectors", () => {
    const user = Array(60).fill({ knee: 1, hip: 1, torso: 1, ankle: 1 });
    const ref = Array(60).fill({ knee: 1, hip: 1, torso: 1, ankle: 1 });
    const keys = ["knee", "hip", "torso", "ankle"];
    const result = cosineSimilarityByKey(user, ref, keys);
    expect(result).toHaveProperty("perKey");
    expect(result).toHaveProperty("coverage");
    for (const k of keys) {
      expect(result.perKey[k]).toBeCloseTo(1, 5);
    }
  });

  it("returns 0 for orthogonal vectors", () => {
    const user = Array(60).fill({ knee: 1, hip: 0, torso: 0, ankle: 0 });
    const ref = Array(60).fill({ knee: 0, hip: 1, torso: 0, ankle: 0 });
    const keys = ["knee", "hip"];
    const result = cosineSimilarityByKey(user, ref, keys);
    expect(result.perKey.knee).toBeCloseTo(0, 5);
    expect(result.perKey.hip).toBeCloseTo(0, 5);
  });

  it("returns 0 when both vectors have insufficient overlap", () => {
    const user = [{ knee: 1 }, { knee: 2 }];
    const ref = [{ knee: 1 }, { knee: 2 }];
    const result = cosineSimilarityByKey(user, ref, ["knee"]);
    expect(result.perKey.knee).toBe(0); // bothCount < 5
  });

  it("handles sparse/missing values", () => {
    const user = Array(60).fill({ knee: null, hip: 1 }).map((f, i) => (i < 30 ? { ...f, knee: 1 } : f));
    const ref = Array(60).fill({ knee: 1, hip: 1 });
    const result = cosineSimilarityByKey(user, ref, ["knee", "hip"]);
    expect(result).toHaveProperty("perKey");
    expect(result).toHaveProperty("coverage");
  });
});
