import { describe, it, expect } from "vitest";
import { checkForm, FORM_THRESHOLDS } from "../src/utils/formChecks";

describe("checkForm", () => {
  describe("depth", () => {
    it("flags shallow squat when minKnee > minDepthKnee", () => {
      const rep = { minKnee: 120, viewMode: "side" };
      const result = checkForm(rep);
      expect(result.depthOK).toBe(false);
      expect(result.issues).toContain("Go a bit deeper- aim to bend your knees more at the bottom.");
    });

    it("passes when minKnee <= 115", () => {
      const rep = { minKnee: 115, viewMode: "side" };
      const result = checkForm(rep);
      expect(result.depthOK).toBe(true);
      expect(result.issues).not.toContain("Go a bit deeper- aim to bend your knees more at the bottom.");
    });

    it("fails when minKnee is missing", () => {
      const rep = { viewMode: "side" };
      const result = checkForm(rep);
      expect(result.depthOK).toBe(false);
    });
  });

  describe("forward lean (side view only)", () => {
    it("flags excessive forward lean when maxTorso > 45", () => {
      const rep = { minKnee: 110, maxTorso: 50, viewMode: "side" };
      const result = checkForm(rep);
      expect(result.forwardLeanOK).toBe(false);
      expect(result.issues).toContain("Try to keep your chest a little more upright.");
    });

    it("passes when maxTorso <= 45", () => {
      const rep = { minKnee: 110, maxTorso: 40, viewMode: "side" };
      const result = checkForm(rep);
      expect(result.forwardLeanOK).toBe(true);
    });

    it("skips forward lean check in front view", () => {
      const rep = { minKnee: 110, maxTorso: 60, viewMode: "front" };
      const result = checkForm(rep);
      expect(result.forwardLeanOK).toBe(true);
    });
  });

  describe("side back / excessive lean (side view)", () => {
    it("flags when maxTorso > 42", () => {
      const rep = { minKnee: 110, maxTorso: 45, viewMode: "side" };
      const result = checkForm(rep);
      expect(result.sideBackOK).toBe(false);
      expect(result.issues).toContain(
        "From the side view, you\u2019re leaning too far forwards– try to keep your back more neutral."
      );
    });

    it("passes when maxTorso <= 42", () => {
      const rep = { minKnee: 110, maxTorso: 40, viewMode: "side" };
      const result = checkForm(rep);
      expect(result.sideBackOK).toBe(true);
    });
  });

  describe("torso delta (side view)", () => {
    it("flags when |bottomTorso - topTorso| > 18", () => {
      const rep = { minKnee: 110, topTorso: 10, bottomTorso: 35, viewMode: "side" };
      const result = checkForm(rep);
      expect(result.torsoDeltaOK).toBe(false);
      expect(result.issues).toContain(
        "Try to keep your back angle more consistent– avoid rounding or overcompensating through the spine."
      );
    });

    it("passes when delta <= 18", () => {
      const rep = { minKnee: 110, topTorso: 10, bottomTorso: 25, viewMode: "side" };
      const result = checkForm(rep);
      expect(result.torsoDeltaOK).toBe(true);
    });

    it("skips when topTorso or bottomTorso missing", () => {
      const rep = { minKnee: 110, viewMode: "side" };
      const result = checkForm(rep);
      expect(result.torsoDeltaOK).toBe(true);
    });
  });

  describe("bottom torso (side view)", () => {
    it("flags when bottomTorso > 42", () => {
      const rep = { minKnee: 110, bottomTorso: 50, viewMode: "side" };
      const result = checkForm(rep);
      expect(result.bottomTorsoOK).toBe(false);
      expect(result.issues).toContain(
        "At the bottom, try to keep your chest from leaning too far forward- maintain a more upright back position."
      );
    });

    it("passes when bottomTorso <= 42", () => {
      const rep = { minKnee: 110, bottomTorso: 38, viewMode: "side" };
      const result = checkForm(rep);
      expect(result.bottomTorsoOK).toBe(true);
    });
  });

  describe("knee valgus (front view only)", () => {
    it("flags when valgusMetric > maxValgusMetric", () => {
      const rep = { minKnee: 110, valgusMetric: 0.03, viewMode: "front" };
      const result = checkForm(rep);
      expect(result.valgusOK).toBe(false);
      expect(result.issues).toContain(
        "Keep your knees tracking over your toes– avoid them collapsing inwards."
      );
    });

    it("passes when valgusMetric <= 0.025", () => {
      const rep = { minKnee: 110, valgusMetric: 0.02, viewMode: "front" };
      const result = checkForm(rep);
      expect(result.valgusOK).toBe(true);
    });

    it("skips valgus check in side view", () => {
      const rep = { minKnee: 110, valgusMetric: 0.1, viewMode: "side" };
      const result = checkForm(rep);
      expect(result.valgusOK).toBe(true);
    });

    it("skips when valgusMetric missing in front view", () => {
      const rep = { minKnee: 110, viewMode: "front" };
      const result = checkForm(rep);
      expect(result.valgusOK).toBe(true);
    });
  });

  describe("overall", () => {
    it("returns overallOK true when all checks pass", () => {
      const rep = {
        minKnee: 110,
        maxTorso: 35,
        topTorso: 15,
        bottomTorso: 30,
        viewMode: "side",
      };
      const result = checkForm(rep);
      expect(result.overallOK).toBe(true);
      expect(result.issues).toHaveLength(0);
    });

    it("returns overallOK false when any check fails", () => {
      const rep = { minKnee: 120, viewMode: "side" };
      const result = checkForm(rep);
      expect(result.overallOK).toBe(false);
      expect(result.issues.length).toBeGreaterThan(0);
    });
  });

  describe("opts override", () => {
    it("allows overriding minDepthKnee via opts", () => {
      const rep = { minKnee: 118, viewMode: "side" };
      const result = checkForm(rep, { minDepthKnee: 120 });
      expect(result.depthOK).toBe(true);
    });
  });
});

describe("FORM_THRESHOLDS", () => {
  it("exports expected threshold keys", () => {
    expect(FORM_THRESHOLDS).toHaveProperty("minDepthKnee", 115);
    expect(FORM_THRESHOLDS).toHaveProperty("maxForwardTorso", 45);
    expect(FORM_THRESHOLDS).toHaveProperty("maxValgusMetric", 0.025);
    expect(FORM_THRESHOLDS).toHaveProperty("sideMaxTorso", 42);
    expect(FORM_THRESHOLDS).toHaveProperty("maxTorsoDelta", 18);
    expect(FORM_THRESHOLDS).toHaveProperty("bottomTorsoMax", 42);
  });
});
