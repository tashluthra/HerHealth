import { describe, it, expect } from "vitest";
import {
  buildSquatTargets,
  scoreRepAgainstTargets,
  scoreSessionReps,
} from "../src/metrics/repQuality";

describe("buildSquatTargets", () => {
  it("returns null for null/undefined aggregate", () => {
    expect(buildSquatTargets(null)).toBe(null);
    expect(buildSquatTargets(undefined)).toBe(null);
  });

  it("returns null when aggregate has no targets", () => {
    expect(buildSquatTargets({})).toBe(null);
    expect(buildSquatTargets({ foo: 1 })).toBe(null);
  });

  it("returns targets with knee and torso values", () => {
    const aggregate = {
      targets: {
        Top: { knee: 170, torso: 10 },
        Bottom: { knee: 100, torso: 35 },
      },
      knee_bottom: 105,
      knee_top: 168,
    };
    const result = buildSquatTargets(aggregate);
    expect(result).not.toBe(null);
    expect(result).toHaveProperty("kneeBottomTarget");
    expect(result).toHaveProperty("kneeTopTarget");
    expect(result).toHaveProperty("torsoBottomTarget");
    expect(result).toHaveProperty("torsoTopTarget");
    expect(result).toHaveProperty("kneeSlack");
    expect(result).toHaveProperty("torsoSlack");
  });
});

describe("scoreRepAgainstTargets", () => {
  const targets = {
    kneeBottomTarget: 100,
    kneeTopTarget: 170,
    torsoBottomTarget: 35,
    torsoTopTarget: 10,
    kneeSlack: 8,
    torsoSlack: 5,
  };

  it("returns null for null rep or targets", () => {
    expect(scoreRepAgainstTargets(null, targets)).toBe(null);
    expect(scoreRepAgainstTargets({ minKnee: 100 }, null)).toBe(null);
  });

  it("returns depthOK true when minKnee <= kneeBottomTarget + slack", () => {
    const rep = { minKnee: 105, maxTorso: 30 };
    const result = scoreRepAgainstTargets(rep, targets);
    expect(result.depthOK).toBe(true);
  });

  it("returns depthOK false when minKnee too high", () => {
    const rep = { minKnee: 120, maxTorso: 30 };
    const result = scoreRepAgainstTargets(rep, targets);
    expect(result.depthOK).toBe(false);
  });

  it("returns qualityScore 0-100", () => {
    const rep = { minKnee: 100, maxTorso: 30 };
    const result = scoreRepAgainstTargets(rep, targets);
    expect(result.qualityScore).toBeGreaterThanOrEqual(0);
    expect(result.qualityScore).toBeLessThanOrEqual(100);
  });

  it("returns depthScore, torsoScore, depthOK, torsoOK", () => {
    const rep = { minKnee: 100, maxTorso: 35 };
    const result = scoreRepAgainstTargets(rep, targets);
    expect(result).toHaveProperty("depthScore");
    expect(result).toHaveProperty("torsoScore");
    expect(result).toHaveProperty("depthOK");
    expect(result).toHaveProperty("torsoOK");
  });
});

describe("scoreSessionReps", () => {
  const aggregate = {
    targets: {
      Top: { knee: 170, torso: 10 },
      Bottom: { knee: 100, torso: 35 },
    },
  };

  it("returns null for empty reps", () => {
    expect(scoreSessionReps([], aggregate)).toBe(null);
  });

  it("returns null for null aggregate", () => {
    expect(scoreSessionReps([{ minKnee: 100 }], null)).toBe(null);
  });

  it("returns summary with targets, reps, goodReps, totalReps, avgQuality", () => {
    const reps = [
      { minKnee: 100, maxTorso: 30 },
      { minKnee: 105, maxTorso: 35 },
    ];
    const result = scoreSessionReps(reps, aggregate);
    expect(result).not.toBe(null);
    expect(result).toHaveProperty("targets");
    expect(result).toHaveProperty("reps");
    expect(result).toHaveProperty("goodReps");
    expect(result).toHaveProperty("totalReps");
    expect(result).toHaveProperty("avgQuality");
    expect(result.totalReps).toBe(2);
  });
});
