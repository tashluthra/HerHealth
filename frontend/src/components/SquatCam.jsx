import React, { useEffect, useRef, useState } from "react";
import { FilesetResolver, PoseLandmarker, DrawingUtils } from "@mediapipe/tasks-vision";
import { scoreRepAgainstRef, classifyScore,} from "../utils/squatSimilarity"; 
import { scoreSessionReps } from "../metrics/repQuality";
import { checkForm } from "../utils/formChecks";


export default function SquatCam() {

  //refs to DOM elements and other mutable objects
  const videoRef = useRef(null); //<video> element that shows the webcam stream
  const canvasRef = useRef(null); //<canvas> overlay for drawing lines
  const rafRef = useRef(null);
  const landmarkerRef = useRef(null);
  const phaseRef = useRef("Top");
  const currentRepTraceRef = useRef([]);
  const currentRepStats = useRef(null);
  const repModeRef = useRef(null); //"front" | "side" for the current rep (locked)

  const [simDebug, setSimDebug] = useState(null); //DEBUG- CAN BE REMOVED LATER!!
  const frontDbgRef = useRef({ eligibleOk: 0, eligibleNo: 0, featOk: 0, featNo: 0 });
  const [frontDbg, setFrontDbg] = useState(frontDbgRef.current);

  const [crash, setCrash] = useState(null); //ALSO REMOVE LATER!!
    useEffect(() => {
      const onErr = (e) => setCrash(e?.message || String(e));
      const onRej = (e) => setCrash(e?.reason?.message || String(e?.reason || e));

      window.addEventListener("error", onErr);
      window.addEventListener("unhandledrejection", onRej);

      return () => {
        window.removeEventListener("error", onErr);
        window.removeEventListener("unhandledrejection", onRej);
      };
    }, []);


  //current view mode for UI + logic
  const [viewMode, setViewMode] = useState("front");      //"front" | "side"
 
  const viewModeRef = useRef("front"); 
    useEffect(() => { viewModeRef.current = viewMode; }, [viewMode]);
 
  const modeStickyRef = useRef({ mode: "front", wins: 0 });
  const modeWinsRef   = useRef(0);
  const lastFrameInfoRef = useRef({ ang: null, mode: "front", side: "L" });
  const [lastRepScore, setLastRepScore] = useState(null);


  //state variables for rendering
  const [ready, setReady] = useState(false); //is the webcam ready
  const [modelReady, setModelReady] = useState(false); //is the pose model ready 
  const [modelRoot, setModelRoot] = useState(""); //which mediapipe root was used
  const [error, setError] = useState(null); //error messages
  //state to hold the last detected coords (for hip, knee, ankle, shoulder)
  const [coords, setCoords] = useState({ 
  hip: "–", knee: "–", ankle: "–", shoulder: "–" 
  });

  const [fps, setFps] = useState(0);
  const [repCount, setRepCount] = useState(0);
  const [phase, setPhase] = useState("Top"); // Top | Down | Bottom | Up
  const [session, setSession] = useState({
    startedAt: null,
    endedAt: null,
    frames: [],       // optional diagnostics (kept small)
    reps: [],         // per-rep metrics
    summary: null
  });

  const [techniqueFirst, setTechniqueFirst] = useState(true);
  const [lastFormFeedback, setLastFormFeedback] = useState(null);

  // smoothing + timing refs
  const smoothBuf = useRef({ knee: [], hip: [], torso: [], ankle: [] });
  const lastFrameTs = useRef(performance.now());
  const bottomSince = useRef(null);


// Reference templates produced by build_reference_templates.py
const [refTemplates, setRefTemplates] = useState(null);

useEffect(() => {
  let mounted = true;

  (async () => {
    try {
      const res = await fetch(`/reference/reference_clips.json?v=${Date.now()}`);
      const data = await res.json();
      if (mounted) setRefTemplates(data);
      console.log("[Similarity] reference_clips.json loaded keys:", Object.keys(data));
    } catch (e) {
      console.warn("[Similarity] Failed to load reference_clips.json", e);
    }
  })();

  return () => { mounted = false; };
}, []);

  const refTemplatesRef = useRef(null);
    useEffect(() => {
      refTemplatesRef.current = refTemplates;
    }, [refTemplates]);


const REP_DETECTION = {       // temporary hold values (will change with algorithm from video)
  kneeTop: 168,        // can replace with professional values
  kneeBottom: 115,     
  torsoStay: 25,
  minBottomMs: 80,
  minFootLift: 0.06,
  minHipDrop: 0.04
};

const SAFETY_LIMITS = {
  minHipDrop: 0.04,    // was 0.04
  maxFootLift: 0.6,   // was 0.05
  minTorsoDelta: 3     // was 4 (your torso delta is often small)
};


  // which anatomical side we’re using for angles (auto L/R with hysteresis)
const [sideUsed, setSideUsed] = useState("L");
const sideStickyRef = useRef({ side: "L", wins: 0 });



// live per-frame signals + baseline captured at Top
const curSig = useRef({ hipY: null, ankleY: null, heelY: null });
const topBaseline = useRef(null);
const frontBaselineRef = useRef({ sym0: null }); //front view symmetry baseline
const footLiftEmaRef = useRef(0);  //exponential moving average for footLift

  const DEBUG = true;

    // --- geometry helpers ---
  function angleDeg(a, b, c) {
    const v1 = { x: a.x - b.x, y: a.y - b.y };
    const v2 = { x: c.x - b.x, y: c.y - b.y };
    const dot = v1.x * v2.x + v1.y * v2.y;
    const n1 = Math.hypot(v1.x, v1.y), n2 = Math.hypot(v2.x, v2.y);
    const cos = Math.min(1, Math.max(-1, dot / (n1 * n2 || 1)));
    return Math.round((Math.acos(cos) * 180) / Math.PI);
  }

  function lowerBodyEligible(lms, side) {
  const I = IDX[side];
  const pts = [lms[I.hip], lms[I.knee], lms[I.ankle]];
  if (pts.some(p => !p)) return false;
  const visOK = pts.every(p => (p.visibility ?? 0) > 0.3); // was 0.5
  const inFrameOK = pts.every(p => p.x>0 && p.x<1 && p.y>0 && p.y<0.99);
  return visOK && inFrameOK;
  }


  function computeFrontFeatures(lms) {
    const lh = lms[23], rh = lms[24];
    const lk = lms[25], rk = lms[26];
    const la = lms[27], ra = lms[28];

    if (!(lh && rh && lk && rk && la && ra)) return null;

    // valgus (same definition as reference builder)
    const stanceWidth = Math.abs(la.x - ra.x) + 1e-6;
    const leftValgus  = (lk.x - la.x) / stanceWidth;
    const rightValgus = (rk.x - ra.x) / stanceWidth;
    const valgus = (leftValgus + rightValgus) / 2;

    // symmetry baseline correction (matches Python: raw_sym - baseline_sym)
    const hipWidth = Math.abs(lh.x - rh.x) + 1e-6;
    const rawSym = (lk.x - rk.x) / hipWidth;

    if (frontBaselineRef.current.sym0 == null) {
      frontBaselineRef.current.sym0 = rawSym;
    }
    const symmetry = rawSym - frontBaselineRef.current.sym0;

    // pelvic drop normalised (matches Python: (lh.y - rh.y) / h ; lms coords already normalised)
    const pelvic = (lh.y - rh.y);

    // depth proxy: hip centre y (normalised)
    const hipCentreY = (lh.y + rh.y) / 2;
    const depth = hipCentreY;

    return { valgus, symmetry, pelvic, depth };
  }




  // Use LEFT side to match coords panel (11,23,25,27)
  function getJoints(lms) {
    const s = lms[11], h = lms[23], k = lms[25], a = lms[27];
    return { s, h, k, a };
  }

  function computeAngles(lms) {
    const { s, h, k, a } = getJoints(lms);
    if (!s || !h || !k || !a) return null;
    const knee = angleDeg(h, k, a);
    const hip  = angleDeg(s, h, k);
    // torso vs vertical (0° = upright)
    const tx = h.x - s.x, ty = h.y - s.y;
    const torso = Math.round((Math.acos((ty) / (Math.hypot(tx, ty) || 1)) * 180) / Math.PI);
    return { knee, hip, torso };
  }

  function torsoUprightFromLR(lms) {
  const shL = lms[11], shR = lms[12], hipL = lms[23], hipR = lms[24];
  if (!shL || !shR || !hipL || !hipR) return null;
  const shoulder = { x: (shL.x + shR.x) / 2, y: (shL.y + shR.y) / 2 };
  const hip      = { x: (hipL.x + hipR.x) / 2, y: (hipL.y + hipR.y) / 2 };
  const tx = hip.x - shoulder.x, ty = hip.y - shoulder.y;
  return Math.round((Math.acos(ty / (Math.hypot(tx, ty) || 1)) * 180) / Math.PI);
}

function visibilityScore(lms, idxs) {
  const vals = idxs.map(i => (lms[i]?.visibility ?? 0));
  return vals.reduce((a,b)=>a+b,0) / Math.max(vals.length,1);
}

function buildRefTraceForMode(refTemplates, mode) {
  if (!refTemplates) return [];

  const ref = refTemplates[mode];
  const T = ref?.trajectories;
  if (!T) return [];

  const keys = mode === "side"
    ? ["knee", "hip", "torso", "ankle"]
    : ["valgus", "symmetry", "pelvic", "depth"];

  const n = Math.max(...keys.map(k => (T[k]?.length ?? 0)));
  if (!n) return [];

  const frames = [];
  for (let i = 0; i < n; i++) {
    const frame = {};
    for (const k of keys) frame[k] = T[k]?.[i] ?? null;
    frames.push(frame);
  }
  return frames;
}



function computeAnglesFrontView(lms) {
  // Left
  const sL=lms[11], hL=lms[23], kL=lms[25], aL=lms[27];
  // Right
  const sR=lms[12], hR=lms[24], kR=lms[26], aR=lms[28];
  if (!(sL&&hL&&kL&&aL) && !(sR&&hR&&kR&&aR)) return null;

  const haveL = (sL&&hL&&kL&&aL);
  const haveR = (sR&&hR&&kR&&aR);

  const kneeL = haveL ? angleDeg(hL, kL, aL) : null;
  const hipL  = haveL ? angleDeg(sL, hL, kL) : null;
  const kneeR = haveR ? angleDeg(hR, kR, aR) : null;
  const hipR  = haveR ? angleDeg(sR, hR, kR) : null;

  // visibility weighting (helps when one leg is occluded)
  const wL = haveL ? visibilityScore(lms, [11,23,25,27]) : 0;
  const wR = haveR ? visibilityScore(lms, [12,24,26,28]) : 0;

  function wAvg(a, wa, b, wb) {
    const num = (a!=null? a*wa : 0) + (b!=null? b*wb : 0);
    const den = (a!=null? wa : 0)    + (b!=null? wb : 0);
    return den > 1e-6 ? Math.round(num/den) : null;
  }

  const knee  = wAvg(kneeL, wL, kneeR, wR) ?? (kneeL ?? kneeR);
  const hip   = wAvg(hipL,  wL, hipR,  wR) ?? (hipL  ?? hipR);
  const torso = torsoUprightFromLR(lms);
  if (knee==null || hip==null || torso==null) return null;

  return { knee, hip, torso, side: "F" };
}

function lowerBodyEligibleFront(lms) {
  // OK if EITHER leg is reasonably visible and in-frame
  const leftOK  = [11,23,25,27].every(i => {
    const p = lms[i]; return p && (p.visibility ?? 0) > 0.35 && p.x>0 && p.x<1 && p.y>0 && p.y<0.99;
  });
  const rightOK = [12,24,26,28].every(i => {
    const p = lms[i]; return p && (p.visibility ?? 0) > 0.35 && p.x>0 && p.x<1 && p.y>0 && p.y<0.99;
  });
  return leftOK || rightOK;
}


  function smoothAngles(ang) {
    const N = 5;
    ["knee","hip","torso","ankle"].forEach(k => {
      if (ang[k] == null) return;
      const buf = smoothBuf.current[k];
      buf.push(ang[k]);
      if (buf.length > N) buf.shift();
    });
    const avg = arr => arr.reduce((a,b)=>a+b,0) / Math.max(arr.length,1);
    return {
      knee: Math.round(avg(smoothBuf.current.knee)),
      hip: Math.round(avg(smoothBuf.current.hip)),
      torso: Math.round(avg(smoothBuf.current.torso)),
      ankle: smoothBuf.current.ankle.length
        ? Math.round(avg(smoothBuf.current.ankle))
        : null,
    };
  }

  function collectSignals(lms, side) {
  const I = IDX[side] || IDX.L;
  const hipY   = lms[I.hip]?.y ?? null;
  const ankleY = lms[I.ankle]?.y ?? null;
  // Heel landmarks: L=29, R=30
  const heelIdx = side === "R" ? 30 : 29;
  const heelY = lms[heelIdx]?.y ?? null;
  return { hipY, ankleY, heelY };
}


  // --- FPS + reps ---
  function tickFps() {
    const now = performance.now();
    const dt = now - lastFrameTs.current;
    lastFrameTs.current = now;
    const inst = 1000 / Math.max(dt, 1);
    setFps(f => Math.round(0.8 * f + 0.2 * inst)); // gentle smoothing
  }
  //Rep-state + scoring
  function updateRepState(lms, ang, ts, onRepComplete) {
  let cur = phaseRef.current;

  const atTopKnee = ang.knee >= REP_DETECTION.kneeTop;
  const atBotKnee = ang.knee <= REP_DETECTION.kneeBottom;
  const leaveTop  = ang.knee < (REP_DETECTION.kneeTop - 5);

  // Anti-fake signals
  const base = topBaseline.current;
  const sig  = curSig.current || {};

  const hipDrop   = base && sig.hipY   != null ? (sig.hipY - base.hipY) : 0;
  const ankleLift = base && sig.ankleY != null ? Math.abs(sig.ankleY - base.ankleY) : 0;
  const heelLift  = base && sig.heelY  != null ? Math.abs(sig.heelY  - base.heelY)  : 0;

  const rawFoot = Math.max(ankleLift, heelLift || 0);
  const alpha = 0.2;
  footLiftEmaRef.current = alpha * rawFoot + (1 - alpha) * (footLiftEmaRef.current ?? 0);
  const footLift = footLiftEmaRef.current;

  const bottomOK =
    atBotKnee &&
    hipDrop >= SAFETY_LIMITS.minHipDrop &&
    footLift <= SAFETY_LIMITS.maxFootLift;

  // Update running min/max *only if rep is active*
  if (currentRepStats.current) {
    currentRepStats.current.minKnee = Math.min(currentRepStats.current.minKnee, ang.knee);
    currentRepStats.current.maxTorso = Math.max(currentRepStats.current.maxTorso, ang.torso);
  }

  // Phase transitions
  if (cur === "Top" && leaveTop) {
    cur = "Down";

    // --- start rep (ONLY HERE) ---
    bottomSince.current = null; // important: reset bottom timer for new rep

    currentRepStats.current = {
      startTs: ts,
      minKnee: ang.knee,
      maxTorso: ang.torso,
      topTorso: ang.torso, // optional
    };

    repModeRef.current = viewModeRef.current;   // lock mode for this rep
    currentRepTraceRef.current = [];            // reset trace for this rep

    // capture baseline for front mode
    if (repModeRef.current === "front") {
      const f0 = computeFrontFeatures(lms);
      frontBaselineRef.current = {
        valgus0: typeof f0?.valgus === "number" ? f0.valgus : null,
        sym0:    typeof f0?.symmetry === "number" ? f0.symmetry : null,
      };
    } else {
      frontBaselineRef.current = { valgus0: null, sym0: null };
    }

  } else if (cur === "Down" && bottomOK) {
    cur = "Bottom";
    bottomSince.current = ts;

  } else if (cur === "Down" && atTopKnee && !bottomSince.current) {
    // aborted rep: never reached bottom
    cur = "Top";
    currentRepStats.current = null;
    repModeRef.current = null;
    currentRepTraceRef.current = [];
    topBaseline.current = { ...curSig.current, torso: ang.torso };

  } else if (cur === "Bottom") {
    if (bottomSince.current && ts - bottomSince.current >= REP_DETECTION.minBottomMs) {
      if (!atBotKnee) cur = "Up";
    }

  } else if (cur === "Up" && atTopKnee) {
    cur = "Top";

    let repSummary = {
      tEnd: ts,
      knee: ang.knee,
      hip: ang.hip,
      torso: ang.torso,
    };

    if (currentRepStats.current) {
      repSummary = {
        ...repSummary,
        tStart: currentRepStats.current.startTs ?? null,
        minKnee: currentRepStats.current.minKnee,
        maxTorso: currentRepStats.current.maxTorso,
        durationMs:
          currentRepStats.current.startTs != null ? ts - currentRepStats.current.startTs : null,
      };
    }

    currentRepStats.current = null;

    if (typeof onRepComplete === "function") onRepComplete(repSummary);

    repModeRef.current = null;
  }

  if (cur !== phaseRef.current) {
    phaseRef.current = cur;
    setPhase(cur);
  }
}


function autoDetectMode(lms) {
  const sL = scoreSide(lms, "L");
  const sR = scoreSide(lms, "R");

  const BOTH_OK = Math.min(sL, sR) > 1.2;
  const DIFF = Math.abs(sL - sR);
  const next = (BOTH_OK && DIFF < 0.25) ? "front" : "side";

  const prev = modeStickyRef.current.mode;
  if (next !== prev) {
    modeStickyRef.current.wins += 1;
    if (modeStickyRef.current.wins >= 4) {
      modeStickyRef.current = { mode: next, wins: 0 };
      viewModeRef.current = next;
      setViewMode(next);  // updates “Mode: …” pill
    }
  } else {
    if (modeStickyRef.current.wins) modeStickyRef.current.wins = 0;
  }
  return modeStickyRef.current.mode;
}


function handlePoseResults(res) {
  if (DEBUG) console.count("[HerHealth] handlePoseResults calls");
  tickFps();

  const lms = res?.landmarks?.[0];
  if (!lms) return;
  setSession(s => (s.startedAt ? s : { ...s, startedAt: Date.now() }));

  // --- Decide front vs side, with hysteresis (your requested block) ---
  const modeNow = repModeRef.current ? repModeRef.current : autoDetectMode(lms);

  if (!repModeRef.current) {
    if (modeNow !== viewModeRef.current) {
      modeWinsRef.current += 1;
      if (modeWinsRef.current >= 4) {           // require 4 consecutive frames to flip
        viewModeRef.current = modeNow;          // update fast-path ref
        setViewMode(modeNow);                   // update UI badge
        modeWinsRef.current = 0;
      }
    } else {
      // same as last frame → reset wins and ensure UI is in sync
      if (modeWinsRef.current) modeWinsRef.current = 0;
      if (viewMode !== viewModeRef.current) setViewMode(viewModeRef.current);
    }
  }

  const curMode = repModeRef.current ?? viewModeRef.current;

  // ① Compute angles with maths for the current mode
  const angRaw = (curMode === "front")
    ? computeAnglesFrontView(lms)   // visibility-weighted L/R + torso from midpoints
    : computeAnglesSideAware(lms);  // best single side + torso from that side

  if (!angRaw) return;

  const ang = smoothAngles(angRaw); // { knee, hip, torso }
  setSideUsed(angRaw.side ?? (curMode === "front" ? "F" : sideStickyRef.current.side));

  // ② Signals/baseline: still track ONE side’s Y positions
  const sideForSignals = (curMode === "front") ? selectStableSide(lms) : angRaw.side;
  const sig = collectSignals(lms, sideForSignals);
  curSig.current = sig;

  // --- Ensure/refresh Top baseline ---
  const atTopKneeNow = ang.knee >= (REP_DETECTION .kneeTop - 5);
  if (!topBaseline.current && atTopKneeNow) {
    topBaseline.current = { ...curSig.current, torso: ang.torso };
    if (DEBUG) console.log("[HerHealth] baseline initialised (knee:", ang.knee.toFixed(1), ")");
  }
  if (phaseRef.current === "Top" && atTopKneeNow) {
    topBaseline.current = { ...curSig.current, torso: ang.torso };
  }

  //Coords panel uses the side we track for signals
  const I = IDX[sideForSignals];
  setCoords({
    hip:      `${lms[I.hip].x.toFixed(3)}, ${lms[I.hip].y.toFixed(3)}`,
    knee:     `${lms[I.knee].x.toFixed(3)}, ${lms[I.knee].y.toFixed(3)}`,
    ankle:    `${lms[I.ankle].x.toFixed(3)}, ${lms[I.ankle].y.toFixed(3)}`,
    shoulder: `${lms[I.shoulder].x.toFixed(3)}, ${lms[I.shoulder].y.toFixed(3)}`
  });
  lastFrameInfoRef.current = {
  ang,
  mode: curMode,
  side: sideForSignals
};
// FRONT DEBUG (doesn't affect logic)
if (curMode === "front") {
  const okFront = lowerBodyEligibleFront(lms);
  if (okFront) frontDbgRef.current.eligibleOk += 1;
  else frontDbgRef.current.eligibleNo += 1;

  const f = computeFrontFeatures(lms);
  const hasAny =
    f && ["valgus", "symmetry", "pelvic", "depth"].some(k => typeof f[k] === "number");

  if (hasAny) frontDbgRef.current.featOk += 1;
  else frontDbgRef.current.featNo += 1;

  if ((frontDbgRef.current.eligibleOk + frontDbgRef.current.eligibleNo) % 10 === 0) {
    setFrontDbg({ ...frontDbgRef.current });
  }
}

  //Mode-specific eligibility
  const ok = (curMode === "front")
    ? true
    : lowerBodyEligible(lms, angRaw.side);


  if (currentRepStats.current) {
    if (curMode === "front") {
      const f = computeFrontFeatures(lms);

      // pull the baseline captured at rep-start (Top -> Down)
      const b = frontBaselineRef.current ?? {};
      const sym0 = typeof b.sym0 === "number" ? b.sym0 : null;
      const valgus0 = typeof b.valgus0 === "number" ? b.valgus0 : null;

      const valgus = typeof f?.valgus === "number" ? f.valgus : null;
      const symmetry = typeof f?.symmetry === "number" ? f.symmetry : null;
      const pelvic = typeof f?.pelvic === "number" ? f.pelvic : null;
      const depth = typeof f?.depth === "number" ? f.depth : null;

      // deltas (only if we have a baseline)
      const valgusDelta =
        (typeof valgus === "number" && typeof valgus0 === "number")
          ? (valgus - valgus0)
          : null;

      const symmetryDelta =
        (typeof symmetry === "number" && typeof sym0 === "number")
          ? (symmetry - sym0)
          : null;

      currentRepTraceRef.current.push({
        valgus: valgusDelta,       // <-- use delta, not raw
        symmetry: symmetryDelta,   // <-- use delta, not raw
        pelvic,
        depth,
      });

    } else {
      currentRepTraceRef.current.push({
        knee:  typeof ang?.knee  === "number" ? ang.knee  : null,
        hip:   typeof ang?.hip   === "number" ? ang.hip   : null,
        torso: typeof ang?.torso === "number" ? ang.torso : null,
        ankle: typeof ang?.ankle === "number" ? ang.ankle : null,
      });
    }
  }

    

  // Rep-state + scoring + form checks
updateRepState(lms, ang, performance.now(), (repSummary) => {
  // 1. Grab & reset the full trace for this rep
  const repMode = repModeRef.current ?? viewModeRef.current;
  const userTrace = currentRepTraceRef.current;
  currentRepTraceRef.current = [];

  // 1a. Derive a simple valgus metric for the rep (max over frames)
  const isFront = repMode === "front";

  const valgusValues = isFront
    ? userTrace.map(f => f.valgus).filter(v => typeof v === "number")
    : [];

  const peakValgus = valgusValues.length ? Math.max(...valgusValues) : null;
  const meanValgus = valgusValues.length
    ? valgusValues.reduce((a, b) => a + b, 0) / valgusValues.length
    : null;

  const repWithValgus = { ...repSummary, peakValgus, meanValgus };


  // 2. Pick the right reference trace (front / side)
  const templates = refTemplatesRef.current;
  const refTrace = buildRefTraceForMode(templates, repMode);


  // 3. Compute a 0–100 similarity score
  const score = scoreRepAgainstRef(userTrace, refTrace, repMode, 60);
  const label = classifyScore(score);

  // DEBUG info!!! REMOVE LATER
  setSimDebug({
    mode: repMode,
    userFrames: userTrace.length,
    refFrames: Array.isArray(refTrace) ? refTrace.length : 0,
    score,
  });


  // 4. Form check
  const form = checkForm({
    ...repWithValgus,
    viewMode: repMode,
  });

  setLastFormFeedback(form);
  setLastRepScore({ score, label, form });

  // 5. Technique-first logic
  if (techniqueFirst && !form.overallOK) {
    console.log("[HerHealth] Rep rejected due to form", form);
    return;
  }

  // 6. Otherwise, count and store the rep
  setRepCount(c => c + 1);

  setSession(s => ({
    ...s,
    reps: [
      ...s.reps,
      {
        ...repWithValgus,
        trace: userTrace,
        score,
        label,
        form,
        viewMode: repMode,
      },
    ],
  }));
});


  lastFrameInfoRef.current = {
    ang,
    mode: viewModeRef.current,      // the stabilised mode we’re using
    side: sideForSignals            // the side we chose for signals
  };

  setSession(s => s.startedAt
    ? { ...s, frames: s.frames.length < 2000 ? [...s.frames, { t: Date.now(), ...ang, side: angRaw.side }] : s.frames }
    : s
  );
}



  // session controls
function startSession() {
  setRepCount(0);
  setPhase("Top");
  phaseRef.current = "Top";
  bottomSince.current = null;
  topBaseline.current = null;
  frontBaselineRef.current = { sym0: null };
  currentRepStats.current = null;
  repModeRef.current = null;
  setSession({ startedAt: Date.now(), endedAt: null, frames: [], reps: [], summary: null });
}

  function endSessionAndSave() {
    setSession(s => {
      if (s.endedAt) return s; //already ended
      const now = Date.now();
      const startedAt = s.startedAt ?? now; //fallback so duration isn't always 0
      const durationSec = Math.round((now - startedAt) / 1000);

    let summary = {
      reps: s.reps.length,    
      meanFps: fps,
      durationSec,
      date: new Date().toISOString(),
    };

    //compute quality using the reference JSON (current view mode)
    let quality = null;
    try {
      if (refTemplates?.aggregate) {
        quality = scoreSessionReps(s.reps, refTemplates.aggregate);
        if (quality) {
          summary = {
            ...summary,
            avgQuality: quality.avgQuality,
            goodReps: quality.goodReps,
          };
          console.log("[HerHealth] rep quality summary:", quality);
        }
      }
    } catch (e) {
      console.warn("[HerHealth] quality scoring failed:", e);
    }

    const finished = { ...s, startedAt, endedAt: now, summary, quality };

    // Persist to localStorage as before
    try {
      const key = "herhealth_sessions";
      const all = JSON.parse(localStorage.getItem(key) || "[]");
      all.push(finished);
      localStorage.setItem(key, JSON.stringify(all));
    } catch (_) {}

    return finished;
  });
}

// --- Side-aware landmark selection ---
const IDX = {
  L: { shoulder: 11, hip: 23, knee: 25, ankle: 27 },
  R: { shoulder: 12, hip: 24, knee: 26, ankle: 28 },
};
const TOE = { L: 31, R: 32 }; // MediaPipe foot index landmarks

function getJointsBySide(lms, side) {
  const I = IDX[side];
  return { s: lms[I.shoulder], h: lms[I.hip], k: lms[I.knee], a: lms[I.ankle] };
}

function scoreSide(lms, side) {
  const { s, h, k, a } = getJointsBySide(lms, side);
  const pts = [s, h, k, a];
  if (pts.some(p => !p)) return 0;
  const inFrame = (p) => (p.x > 0 && p.x < 1 && p.y > 0 && p.y < 1) ? 0.2 : 0;
  return pts.reduce((sum, p) => sum + (p.visibility ?? 0) + inFrame(p), 0);
}

function selectStableSide(lms) {
  const sL = scoreSide(lms, "L");
  const sR = scoreSide(lms, "R");
  const prev = sideStickyRef.current.side;
  const MARGIN = 0.15; // new side must beat old by this to switch
  let side = prev;

  if (prev === "L" && sR > sL + MARGIN) {
    sideStickyRef.current.wins += 1;
    if (sideStickyRef.current.wins >= 3) { side = "R"; sideStickyRef.current.wins = 0; }
  } else if (prev === "R" && sL > sR + MARGIN) {
    sideStickyRef.current.wins += 1;
    if (sideStickyRef.current.wins >= 3) { side = "L"; sideStickyRef.current.wins = 0; }
  } else {
    sideStickyRef.current.wins = 0;
  }

  if (side !== prev) sideStickyRef.current.side = side;
  return sideStickyRef.current.side;
}

function downloadSessions() {
  try {
    const sessions = JSON.parse(localStorage.getItem("herhealth_sessions") || "[]");
    const blob = new Blob([JSON.stringify(sessions, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "herhealth_sessions.json";
    a.click();
    URL.revokeObjectURL(url);
  } catch (e) {
    console.error("Failed to download sessions:", e);
  }
}

// --- Angle maths (reuse your angleDeg) ---
function computeAnglesSideAware(lms) {
  const side = selectStableSide(lms);
  const { s, h, k, a } = getJointsBySide(lms, side);
  const toe = lms[TOE[side]];

  if (!s || !h || !k || !a || !toe) return null;

  const knee = angleDeg(h, k, a);
  const hip  = angleDeg(s, h, k);

  // ankle dorsiflexion proxy: angle at ankle (knee-ankle-toe)
  const ankle = angleDeg(k, a, toe);

  const tx = h.x - s.x, ty = h.y - s.y;
  const torso = Math.round((Math.acos(ty / (Math.hypot(tx, ty) || 1)) * 180) / Math.PI);

  return { knee, hip, ankle, torso, side };
}



  useEffect(() => { 
    let mounted = true;

    //initalise mediapipe pose landmarker from 2 roots (more robust)
    async function initLandmarker() {
      
      const roots = ["/mediapipe/wasm", "/mediapipe"];
      let lastErr = null;

      for (const root of roots) {
        try {
          console.info("[HerHealth] Trying fileset root:", root);
          const resolver = await FilesetResolver.forVisionTasks(root); //loads model files from root
          const landmarker = await PoseLandmarker.createFromOptions(resolver, { //create the landmarker
            baseOptions: { modelAssetPath: "/mediapipe/pose_landmarker_lite.task" },
            runningMode: "VIDEO",
            numPoses: 1,
            minPoseDetectionConfidence: 0.6,
            minPosePresenceConfidence: 0.6,
            minTrackingConfidence: 0.6,
          });
          return { landmarker, root };
        } catch (e) {
          console.warn("[HerHealth] Landmarker init failed for", root, e);
          lastErr = e;
        }
      }
      throw lastErr || new Error("Could not load MediaPipe assets");
    }

    async function init() {
      try {
        //camera setup (ask permission to user camera)
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "user" },
          audio: false,
        });
        if (!mounted || !videoRef.current) return;
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        setReady(true);

        //mediapipe pose landmarker setup
        const { landmarker, root } = await initLandmarker(); //calls function to load the pose model
        if (!mounted) return;
        landmarkerRef.current = landmarker; //store the landmarker in a state to use later 
        setModelRoot(root); 
        setModelReady(true); 
        console.info("[HerHealth] Model ready from root:", root); //log which root was used

        //render loop (runs on every animation frame)
        const tick = () => {
          if (!mounted) return;
          // grab the current video and canvas DOM nodes
          const video = videoRef.current;
          const canvas = canvasRef.current;
          if (!video || !canvas) { 
            rafRef.current = requestAnimationFrame(tick);
            return;
          }

          const ctx = canvas.getContext("2d"); //gives the 2d canvas context to draw on (drawing API)
          if (ctx && video.readyState >= 2) { //checks  the video is ready also
            // match canvas size to video size
            if (canvas.width !== video.videoWidth) canvas.width = video.videoWidth; 
            if (canvas.height !== video.videoHeight) canvas.height = video.videoHeight;
            
            //clear previous frame
            ctx.clearRect(0, 0, canvas.width, canvas.height);

            //border (helps see the overlay is aligns with the video)
            ctx.strokeStyle = "rgba(255,255,255,0.5)";
            ctx.lineWidth = 2;
            ctx.strokeRect(6, 6, canvas.width - 12, canvas.height - 12);

            //if pose landmarker ready, try to detect landmarks for this video frame
            if (landmarkerRef.current) {
              try {
                const now = performance.now();
                const res = landmarkerRef.current.detectForVideo(video, now);
                if (DEBUG) console.log("[HerHealth] detectForVideo ok. landmarks:", res?.landmarks?.[0]?.length || 0);


                //tasks-vision uses `landmarks`
                const lm = res?.landmarks?.[0];

                if (!lm || !lm.length) {
                  // Show a small hint when nothing is detected
                  ctx.font = "14px system-ui, sans-serif";
                  ctx.fillStyle = "rgba(255,0,0,0.8)";
                  ctx.fillText("No pose detected", 12, 20);

                  // Keep the panel blank
                  setCoords({ hip: "–", knee: "–", ankle: "–", shoulder: "–" });
                } else {
                  // Update the coords panel (left side indices)

                  // Draw the skeleton
                  const utils = new DrawingUtils(ctx);
                  utils.drawLandmarks(lm);
                  utils.drawConnectors(lm, PoseLandmarker.POSE_CONNECTIONS);
                  handlePoseResults(res);

                  const info = lastFrameInfoRef.current;

                if (info?.ang) {
                const { knee, hip, torso } = info.ang;
                const side = info.side ?? "L";
                const mode = info.mode ?? "front";

                ctx.fillStyle = "rgba(0,0,0,0.6)";
                ctx.fillRect(10, 30, 260, 90);
                ctx.fillStyle = "white";
                ctx.font = "14px system-ui, sans-serif";
                ctx.fillText(`Knee: ${knee}°`, 18, 50);
                ctx.fillText(`Hip:  ${hip}°`, 18, 68);
                ctx.fillText(`Torso:${torso}°`, 18, 86);
                ctx.fillText(`Phase: ${phaseRef.current}  Side: ${side}  Mode: ${mode}`, 18, 104);
              }

                  // --- DEBUG OVERLAY (after handlePoseResults) ---
                    const base = topBaseline.current;
                    const sig  = curSig.current || {};

                    const I = IDX[sideUsed] || IDX.L;
                    const s2 = lm[I.shoulder], h2 = lm[I.hip], k2 = lm[I.knee], a2 = lm[I.ankle];
                    const tx2 = h2.x - s2.x, ty2 = h2.y - s2.y;
                    const torsoLive = Math.round((Math.acos(ty2 / (Math.hypot(tx2,ty2)||1)) * 180) / Math.PI);

                    const hipDrop   = base && sig.hipY   != null ? (sig.hipY - base.hipY) : 0;  // + = down
                    const ankleLift = base && sig.ankleY != null ? Math.abs(sig.ankleY - base.ankleY) : 0;
                    const heelLift  = base && sig.heelY  != null ? Math.abs(sig.heelY  - base.heelY)  : 0;
                    const footLift  = Math.max(ankleLift, heelLift || 0);
                    const torsoD    = base ? (torsoLive - (base.torso ?? torsoLive)) : 0;

                    ctx.fillStyle = "rgba(0,0,0,0.6)";
                    ctx.fillRect(10, 200, 300, 72);
                    ctx.fillStyle = "white";
                    ctx.font = "12px system-ui, sans-serif";
                    ctx.fillText(`hipDrop: ${hipDrop.toFixed(3)}  footLift: ${footLift.toFixed(3)}`, 18, 220);
                    ctx.fillText(`torsoΔ: ${Math.round(torsoD)}°  Phase: ${phase}`, 18, 238);
                    // --- END DEBUG OVERLAY ---

                  

                                    // === ANGLE OVERLAY (left side indices 11,23,25,27) ===
                  const s = lm[11], h = lm[23], k = lm[25], a = lm[27];
                  const deg = (A,B,C) => {
                    const v1 = { x: A.x - B.x, y: A.y - B.y };
                    const v2 = { x: C.x - B.x, y: C.y - B.y };
                    const cos = Math.min(1, Math.max(-1,
                      (v1.x*v2.x + v1.y*v2.y) / ((Math.hypot(v1.x,v1.y)||1)*(Math.hypot(v2.x,v2.y)||1))
                    ));
                    return Math.round((Math.acos(cos) * 180) / Math.PI);
                  };
                  const knee = deg(h,k,a);
                  const hip  = deg(s,h,k);
                  const tx = h.x - s.x, ty = h.y - s.y;
                  const torso = Math.round((Math.acos(ty / (Math.hypot(tx,ty)||1)) * 180) / Math.PI);

                  // draw a small HUD box
                  ctx.fillStyle = "rgba(0,0,0,0.6)";
                  ctx.fillRect(10, 30, 220, 78);
                  ctx.fillStyle = "white";
                  ctx.font = "14px system-ui, sans-serif";
                  ctx.fillText(`Knee: ${knee}°`, 18, 50);
                  ctx.fillText(`Hip:  ${hip}°`, 18, 68);
                  ctx.fillText(`Torso:${torso}°`, 18, 86);
                  ctx.fillText(`Phase: ${phaseRef.current}  Side: ${sideUsed}`, 18, 104);
                  // === END ANGLE OVERLAY ===


                }
              } catch (e) {
                console.error("[HerHealth] detectForVideo error:", e);
              }
            }

          }
          rafRef.current = requestAnimationFrame(tick);
        };
        tick();
      } catch (e) {
        console.error("[HerHealth] init error:", e);
        setError(e?.message || "Camera/model init failed");
      }
    }

    init();

    return () => {
      mounted = false;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      const stream = videoRef.current && videoRef.current.srcObject;
      if (stream) Array.from(stream.getTracks()).forEach((t) => t.stop());
      if (landmarkerRef.current) landmarkerRef.current.close();
    };
  }, []);

  return (

    <>
    {crash && (
      <div className="fixed inset-0 z-[9999] bg-black/90 text-white p-6 overflow-auto">
        <div className="text-lg font-semibold">App crashed</div>
        <pre className="mt-3 whitespace-pre-wrap text-sm">{crash}</pre>
      </div>
    )}
    
      <div className="fixed top-3 right-3 z-50 bg-black/70 text-white px-3 py-2 rounded-xl">
          Mode: {viewMode === "front" ? "Front" : "Side"}
      </div>
      <button
        className="fixed bottom-3 right-3 px-3 py-1 rounded-xl bg-black/60 text-white"
        onClick={() => setViewMode(m => (m === "front" ? "side" : "front"))}
      >
        Mode Button: {viewMode === "front" ? "Front" : "Side"}
      </button>

    {simDebug && (
      <div className="fixed bottom-40 left-3 z-50 bg-black/80 text-white px-3 py-2 rounded-xl text-xs">
        <div>Similarity debug</div>
        <div>Mode: {simDebug.mode}</div>
        <div>User frames: {simDebug.userFrames}</div>
        <div>Ref frames: {simDebug.refFrames}</div>
        <div>Score: {simDebug.score}</div>
      </div>
    )}

    <div className="fixed bottom-56 left-3 z-50 bg-black/80 text-white px-3 py-2 rounded-xl text-xs">
      <div className="font-semibold">Front debug</div>
      <div>eligible ok: {frontDbg.eligibleOk}</div>
      <div>eligible no: {frontDbg.eligibleNo}</div>
      <div>features ok: {frontDbg.featOk}</div>
      <div>features no: {frontDbg.featNo}</div>
    </div>

    {refTemplates && (
      <div className="fixed top-16 right-3 z-50 bg-emerald-700/80 text-white px-3 py-2 rounded-xl text-xs">
        <div>Ref loaded ✓</div>
        <div>Mode: {viewMode}</div>
        <div>Front file: {refTemplates.front?.file}</div>
        <div>Side file: {refTemplates.side?.file}</div>
      </div>
    )}


      <div className="w-full max-w-3xl mx-auto p-4 grid gap-3">
        <div className="relative rounded-2xl overflow-hidden shadow">
          <video ref={videoRef} className="w-full h-auto" playsInline muted />
          <canvas ref={canvasRef} className="absolute inset-0 w-full h-full pointer-events-none" />
        </div>

        {/* HUD */}
        <div className="fixed bottom-3 left-3 z-50 bg-black/70 text-white px-3 py-2 rounded-xl flex gap-3 items-center">
          <button onClick={startSession} className="px-3 py-1 rounded-lg bg-white/10 hover:bg-white/20">Start</button>
          <button onClick={endSessionAndSave} className="px-3 py-1 rounded-lg bg-white/10 hover:bg-white/20">End &amp; Save</button>
          <button onClick={downloadSessions} className="px-3 py-1 rounded-lg bg-white/10 hover:bg-white/20">Download Data</button>

          <button
            onClick={() => setTechniqueFirst(v => !v)}
            className={`px-3 py-1 rounded-lg border ${
              techniqueFirst ? "bg-emerald-600/70" : "bg-white/10"
            }`}
          >
            {techniqueFirst ? "Technique first" : "Count all reps"}
          </button>

          <span>FPS: {fps}</span>
          <span>Reps: {repCount}</span>
          <span>Phase: {phase}</span>
        </div>

        {lastRepScore && (
          <div className="fixed bottom-20 left-3 z-50 bg-black/70 text-white px-3 py-2 rounded-xl text-sm max-w-xs">
            <div>Score: {lastRepScore.score} ({lastRepScore.label})</div>
            {lastFormFeedback && !lastFormFeedback.overallOK && (
              <ul className="mt-1 list-disc list-inside text-xs text-red-200">
                {lastFormFeedback.issues.map((msg, i) => (
                  <li key={i}>{msg}</li>
                ))}
              </ul>
            )}
            {lastFormFeedback && lastFormFeedback.overallOK && (
              <div className="mt-1 text-xs text-emerald-200">
                Nice – form looks solid on that rep.
              </div>
            )}
          </div>
        )}

        {/* existing status + coords panels */}
        <div className="text-sm opacity-70">...</div>
        <div className="grid grid-cols-2 gap-2 text-sm rounded-2xl border p-3">...</div>
      </div>
    </>
  );

}