//Tweak values later to make user specific
export const FORM_THRESHOLDS = {
    //Depth: smaller knee angle at the bottom = deeper squat.
    minDepthKnee: 115,   
    //Forward lean: torso angle from vertical. Bigger = more forward.
    maxForwardTorso: 45,     
    //Valgus: our metric is "feet width – knee width" in normalised x.
    //Bigger positive value = knees closer together than feet.
    maxValgusMetric: 0.025,   //2.5% of frame width- may drop to 2% later

    sideMaxTorso: 42, //stricter but allows earlier catching of forward lean
    maxTorsoDelta: 18,  //max change in torso angle during rep
    bottomTorsoMax: 42,  //max torso angle allowed at the bottom of squat

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
    let depthPct = null;

    // 1) Depth – contextualized when romCalibration present for this view, else absolute
    const kneeTop = cfg.kneeTop ?? 168;
    const depthPctThreshold = cfg.depthPctThreshold ?? 80;
    const rom = cfg.romCalibration;
    const romForView = rom && rep.viewMode ? rom[rep.viewMode] : null;
    const romMinKnee = romForView && typeof romForView.minKnee === "number" ? romForView.minKnee : null;

    let depthOK;
    if (romMinKnee != null && typeof rep.minKnee === "number") {
        const denom = kneeTop - romMinKnee;
        depthPct = denom > 0
            ? Math.max(0, Math.min(100, ((kneeTop - rep.minKnee) / denom) * 100))
            : 100;
        depthOK = depthPct >= depthPctThreshold;
        if (!depthOK) {
            issues.push(`You hit ${Math.round(depthPct)}% of your comfortable depth – aim for at least ${depthPctThreshold}%.`);
        }
    } else {
        depthOK =
            typeof rep.minKnee === "number" &&
            rep.minKnee <= cfg.minDepthKnee;
        if (!depthOK) {
            issues.push("Go a bit deeper- aim to bend your knees more at the bottom.");
        }
    }

    // 2) Forward lean – side view only
    let forwardLeanOK = true; // front view: don't fail on this
    if (isSide) {
    forwardLeanOK =
        typeof rep.maxTorso === "number" &&
        rep.maxTorso <= cfg.maxForwardTorso;

    if (!forwardLeanOK) {
        issues.push("Try to keep your chest a little more upright.");
    }
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

    let bottomTorsoOK = true;
        if (isSide && typeof rep.bottomTorso === "number") {
            bottomTorsoOK = rep.bottomTorso <= cfg.bottomTorsoMax;

            if (!bottomTorsoOK) {
                issues.push(
                    "At the bottom, try to keep your chest from leaning too far forward- maintain a more upright back position."
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

    const overallOK = depthOK && forwardLeanOK && sideBackOK && torsoDeltaOK && bottomTorsoOK && valgusOK;

    return {
        depthOK,
        forwardLeanOK,
        sideBackOK,
        torsoDeltaOK,
        bottomTorsoOK,
        valgusOK,
        overallOK,
        issues,
        depthPct,
    };
}