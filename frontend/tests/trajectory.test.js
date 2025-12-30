import { describe, it, expect } from "vitest";
import { resampleTrace } from "../src/utils/trajectory";

function makeLinearTrace(n) {
  // 0..n-1 with a predictable pattern
  return Array.from({ length: n }, (_, i) => ({
    knee: i,
    hip: i * 2,
    torso: 100 - i,
    ankle: i % 5,
  }));
}

describe("resampleTrace", () => {
  it("returns exactly 60 frames", () => {
    const raw = makeLinearTrace(137);
    const keys = ["knee", "hip", "torso", "ankle"];
    const out = resampleTrace(raw, keys, 60);

    expect(out).toHaveLength(60);
  });

  it("preserves keys and produces finite numbers (when inputs are finite)", () => {
    const raw = makeLinearTrace(137);
    const keys = ["knee", "hip", "torso", "ankle"];
    const out = resampleTrace(raw, keys, 60);

    for (const frame of out) {
      for (const k of keys) {
        expect(frame).toHaveProperty(k);
        expect(Number.isFinite(frame[k])).toBe(true);
      }
    }
  });

  it("keeps start/end roughly aligned (first/last values are sensible)", () => {
    const raw = makeLinearTrace(137);
    const keys = ["knee", "hip", "torso", "ankle"];
    const out = resampleTrace(raw, keys, 60);

    // “Sensible” checks (don’t over-specify interpolation details)
    expect(out[0].knee).toBeCloseTo(raw[0].knee, 6);
    expect(out[out.length - 1].knee).toBeCloseTo(raw[raw.length - 1].knee, 6);

    expect(out[0].hip).toBeCloseTo(raw[0].hip, 6);
    expect(out[out.length - 1].hip).toBeCloseTo(raw[raw.length - 1].hip, 6);
  });

  it("handles short traces by still returning 60 frames", () => {
    const raw = makeLinearTrace(3);
    const keys = ["knee", "hip", "torso", "ankle"];
    const out = resampleTrace(raw, keys, 60);

    expect(out).toHaveLength(60);
    for (const frame of out) {
      for (const k of keys) expect(Number.isFinite(frame[k])).toBe(true);
    }
  });
});
