import { describe, it, expect } from "vitest";
import { buildRepData, getTraceKeys } from "../src/logic/buildRepData";

function makeTrace(n, keys, fn = (i) => i) {
  return Array.from({ length: n }, (_, i) => {
    const frame = {};
    for (const k of keys) frame[k] = typeof fn === "function" ? fn(i) : fn;
    return frame;
  });
}

describe("getTraceKeys", () => {
  it("returns front keys for front mode", () => {
    expect(getTraceKeys("front")).toEqual(["valgus", "symmetry", "pelvic", "depth"]);
  });

  it("returns side keys for side mode", () => {
    expect(getTraceKeys("side")).toEqual(["knee", "hip", "torso", "ankle"]);
  });

  it("throws for unknown mode", () => {
    expect(() => getTraceKeys("unknown")).toThrow("Unknown mode");
  });
});

describe("buildRepData", () => {
  const frontKeys = ["valgus", "symmetry", "pelvic", "depth"];
  const sideKeys = ["knee", "hip", "torso", "ankle"];

  it("returns user, ref, keys, mode, targetN", () => {
    const userRaw = makeTrace(30, frontKeys);
    const refRaw = makeTrace(60, frontKeys);
    const result = buildRepData(userRaw, refRaw, "front", 60);

    expect(result).toHaveProperty("user");
    expect(result).toHaveProperty("ref");
    expect(result).toHaveProperty("keys");
    expect(result).toHaveProperty("mode", "front");
    expect(result).toHaveProperty("targetN", 60);
  });

  it("resamples user and ref to targetN frames for front mode", () => {
    const userRaw = makeTrace(25, frontKeys);
    const refRaw = makeTrace(80, frontKeys);
    const result = buildRepData(userRaw, refRaw, "front", 60);

    expect(result.user).toHaveLength(60);
    expect(result.ref).toHaveLength(60);
    expect(result.keys).toEqual(frontKeys);
  });

  it("resamples user and ref to targetN frames for side mode", () => {
    const userRaw = makeTrace(40, sideKeys);
    const refRaw = makeTrace(60, sideKeys);
    const result = buildRepData(userRaw, refRaw, "side", 60);

    expect(result.user).toHaveLength(60);
    expect(result.ref).toHaveLength(60);
    expect(result.keys).toEqual(sideKeys);
  });

  it("picks only specified keys (ignores extra keys in raw)", () => {
    const userRaw = makeTrace(10, [...frontKeys, "extra"]).map((f) => ({ ...f, extra: 999 }));
    const refRaw = makeTrace(10, frontKeys);
    const result = buildRepData(userRaw, refRaw, "front", 60);

    expect(result.user[0]).not.toHaveProperty("extra");
    expect(result.user[0]).toHaveProperty("valgus");
  });

  it("uses default targetN of 60", () => {
    const userRaw = makeTrace(20, sideKeys);
    const refRaw = makeTrace(20, sideKeys);
    const result = buildRepData(userRaw, refRaw, "side");

    expect(result.user).toHaveLength(60);
    expect(result.ref).toHaveLength(60);
    expect(result.targetN).toBe(60);
  });

  it("handles empty traces (resampleTrace returns [])", () => {
    const result = buildRepData([], [], "side", 60);
    expect(result.user).toEqual([]);
    expect(result.ref).toEqual([]);
    expect(result.keys).toEqual(sideKeys);
  });
});
