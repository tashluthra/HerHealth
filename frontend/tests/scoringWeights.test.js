import { describe, it, expect } from "vitest";
import {
  FRONT_KEYS,
  SIDE_KEYS,
  FRONT_WEIGHTS,
  SIDE_WEIGHTS,
} from "../src/logic/scoringWeights";

describe("scoringWeights", () => {
  describe("FRONT_KEYS", () => {
    it("contains valgus, symmetry, pelvic, depth", () => {
      expect(FRONT_KEYS).toEqual(["valgus", "symmetry", "pelvic", "depth"]);
    });

    it("has 4 keys", () => {
      expect(FRONT_KEYS).toHaveLength(4);
    });
  });

  describe("SIDE_KEYS", () => {
    it("contains knee, hip, ankle, torso", () => {
      expect(SIDE_KEYS).toEqual(["knee", "hip", "ankle", "torso"]);
    });

    it("has 4 keys", () => {
      expect(SIDE_KEYS).toHaveLength(4);
    });
  });

  describe("FRONT_WEIGHTS", () => {
    it("has weight for each FRONT_KEY", () => {
      for (const k of FRONT_KEYS) {
        expect(FRONT_WEIGHTS).toHaveProperty(k);
        expect(typeof FRONT_WEIGHTS[k]).toBe("number");
      }
    });

    it("weights sum to 1", () => {
      const sum = FRONT_KEYS.reduce((s, k) => s + FRONT_WEIGHTS[k], 0);
      expect(sum).toBeCloseTo(1, 10);
    });

    it("all weights are positive", () => {
      for (const k of FRONT_KEYS) {
        expect(FRONT_WEIGHTS[k]).toBeGreaterThan(0);
      }
    });
  });

  describe("SIDE_WEIGHTS", () => {
    it("has weight for each SIDE_KEY", () => {
      for (const k of SIDE_KEYS) {
        expect(SIDE_WEIGHTS).toHaveProperty(k);
        expect(typeof SIDE_WEIGHTS[k]).toBe("number");
      }
    });

    it("weights sum to 1", () => {
      const sum = SIDE_KEYS.reduce((s, k) => s + SIDE_WEIGHTS[k], 0);
      expect(sum).toBeCloseTo(1, 10);
    });

    it("all weights are positive", () => {
      for (const k of SIDE_KEYS) {
        expect(SIDE_WEIGHTS[k]).toBeGreaterThan(0);
      }
    });
  });
});
