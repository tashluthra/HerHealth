import { describe, it, expect } from "vitest";
import { resampleTrace, resampleTraceByPhase } from "../src/utils/trajectory";

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

describe("resampleTraceByPhase", () => {
  const keys = ["knee", "hip", "torso", "ankle"];

  it("returns exactly 60 frames when bottomIdx is valid", () => {
    const raw = makeLinearTrace(50);
    const out = resampleTraceByPhase(raw, keys, 25, 60);
    expect(out).toHaveLength(60);
  });

  it("aligns bottom at frame 30 (middle of output)", () => {
    // Trace where knee has min at index 20 (bottom of squat)
    const raw = Array.from({ length: 50 }, (_, i) => ({
      knee: 100 + Math.abs(i - 20),
      hip: 120,
      torso: 30,
      ankle: 90,
    }));
    const bottomVal = raw[20].knee;
    const out = resampleTraceByPhase(raw, keys, 20, 60);
    expect(out).toHaveLength(60);
    expect(out[30].knee).toBeCloseTo(bottomVal, 1);
  });

  it("falls back to resampleTrace when bottomIdx at start", () => {
    const raw = makeLinearTrace(30);
    const out = resampleTraceByPhase(raw, keys, 0, 60);
    expect(out).toHaveLength(60);
  });

  it("falls back to resampleTrace when bottomIdx at end", () => {
    const raw = makeLinearTrace(30);
    const out = resampleTraceByPhase(raw, keys, 29, 60);
    expect(out).toHaveLength(60);
  });

  it("falls back to resampleTrace when down phase has < 2 frames", () => {
    const raw = makeLinearTrace(30);
    const out = resampleTraceByPhase(raw, keys, 1, 60);
    expect(out).toHaveLength(60);
  });
});
