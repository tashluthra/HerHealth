// Simple thresholds for form checks.
// You can tweak these later or make them user-specific.
export const FORM_THRESHOLDS = {
    // Depth: smaller knee angle at the bottom = deeper squat.
    // Will cahnge with coaching angles later
    minDepthKnee: 115,       // degrees or less at bottom = "deep enough"
    // Forward lean: torso angle from vertical. Bigger = more forward.
    maxForwardTorso: 45,     // keep chest within ~45° of upright
    // Valgus: our metric is "feet width – knee width" in normalised x.
    // Bigger positive value = knees closer together than feet.
    maxValgusMetric: 0.025,   // ~2.5% of frame width- may drop to 2% later

    sideMaxTorso: 50,
    maxTorsoDelta: 25,  // max change in torso angle during rep
};

// rep = { minKnee, maxTorso, valgusMetric?, ... }
// opts lets you override thresholds if needed.
// rep = { minKnee, maxTorso, valgusMetric?, viewMode?, ... }
// opts lets you override thresholds if needed.
export function checkForm(rep, opts = {}) {
    const cfg = { ...FORM_THRESHOLDS, ...opts };

    // What view the rep was done in (we add this in SquatCam as viewModeRef.current)
    const isFront = rep.viewMode === "front";
    const isSide  = rep.viewMode === "side";

    const issues = [];

    // 1) Depth
    const depthOK =
        typeof rep.minKnee === "number" &&
        rep.minKnee <= cfg.minDepthKnee;

    if (!depthOK) {
        issues.push("Go a bit deeper- aim to bend your knees more at the bottom.");
    }

    // 2) Forward lean – applies in both views
    const forwardLeanOK =
        typeof rep.maxTorso === "number" &&
        rep.maxTorso <= cfg.maxForwardTorso;

    if (!forwardLeanOK) {
        issues.push("Try to keep your chest a little more upright.");
    }

    // 2b) Side view – extra check for back bending / excessive lean
    let sideBackOK = true;
    if (isSide && typeof rep.maxTorso === "number") {
        sideBackOK = rep.maxTorso <= cfg.sideMaxTorso;

        if (!sideBackOK) {
        issues.push(
            "From the side view, you’re leaning too far forwards– try to keep your back more neutral."
        );
        }
    }
    // 2c) Back curve / spinal compensation – based on torso angle change
    let torsoDeltaOK = true;
    if (
        isSide &&
        typeof rep.topTorso === "number" &&
        typeof rep.bottomTorso === "number"
    ) {
        const delta = Math.abs(rep.bottomTorso - rep.topTorso);
        torsoDeltaOK = delta <= cfg.maxTorsoDelta;

        if (!torsoDeltaOK) {
            issues.push(
                "Try to keep your back angle more consistent– avoid rounding or overcompensating through the spine."
            );
        }
    }

    // 3) Knee valgus (only meaningful in front view)
    // valgusMetric is bigger when knees come closer together than feet.
    let valgusOK = true;
    if (isFront && typeof rep.valgusMetric === "number") {
        valgusOK = rep.valgusMetric <= cfg.maxValgusMetric;

        if (!valgusOK) {
        issues.push(
            "Keep your knees tracking over your toes– avoid them collapsing inwards."
        );
        }
    }

    const overallOK = depthOK && forwardLeanOK && sideBackOK && torsoDeltaOK && valgusOK;

    return {
        depthOK,
        forwardLeanOK,
        sideBackOK,
        torsoDeltaOK,
        valgusOK,
        overallOK,
        issues,
    };
}
