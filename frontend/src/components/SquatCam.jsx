import React, { useEffect, useRef, useState } from "react";
import { FilesetResolver, PoseLandmarker, DrawingUtils } from "@mediapipe/tasks-vision";
import { scoreRepAgainstRef, classifyScore,} from "../utils/squatSimilarity"; 
import { scoreSessionReps } from "../metrics/repQuality";
import { checkForm } from "../utils/formChecks";


export default function SquatCam() {

  // === NEW: runtime-loaded reference targets ===
  const [refAgg, setRefAgg] = useState(null);   // will hold data.aggregate
  const [refErr, setRefErr] = useState(null); 

  //refs to DOM elements and other mutable objects
  const videoRef = useRef(null); //<video> element that shows the webcam stream
  const canvasRef = useRef(null); //<canvas> overlay for drawing lines
  const rafRef = useRef(null);
  const landmarkerRef = useRef(null);
  const phaseRef = useRef("Top");
  const currentRepTraceRef = useRef([]);
  const currentRepStats = useRef(null);


  // current view mode for UI + logic
  const [viewMode, setViewMode] = useState("front");      // "front" | "side"
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
  const smoothBuf = useRef({ knee: [], hip: [], torso: [] });
  const lastFrameTs = useRef(performance.now());
  const bottomSince = useRef(null);


const refUrl = viewMode === "front"
  ? "/reference/reference_clips_front.json"
  : "/reference/reference_clips.json";
const [refTargets, setRefTargets] = useState(null);
useEffect(() => {
  if (!refTargets) return;
  console.log("[Similarity] refTargets loaded", Object.keys(refTargets));
}, [refTargets]);

useEffect(() => {
  let mounted = true;
  async function fetchRefTargets() {
    try {
      const res = await fetch(refUrl);
      const data = await res.json();
      if (mounted) setRefTargets(data);
    } catch (e) {
      // handle error if needed
    }
  }
  fetchRefTargets();
  return () => { mounted = false; };
}, [refUrl]);


const THRESH = {       // temporary hold values (will change with algorithm from video)
  kneeTop: 168,        // can replace with professional values
  kneeBottom: 115,     
  torsoStay: 25,
  minBottomMs: 80,
  minFootLift: 0.06,
  minHipDrop: 0.04
};

const GEO = {
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
const footLiftEmaRef = useRef(0);  // exponential moving average for footLift




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

  // Front-view knee valgus: positive when knees are closer than feet.
  function computeValgusMetricFront(lms) {
    const kL = lms[25], kR = lms[26];
    const aL = lms[27], aR = lms[28];
    if (!kL || !kR || !aL || !aR) return null;

    const kneeDist  = Math.abs(kL.x - kR.x);
    const ankleDist = Math.abs(aL.x - aR.x);

    // If knees come much closer together than feet, this becomes positive.
    return ankleDist - kneeDist;
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
    ["knee","hip","torso"].forEach(k => {
      const buf = smoothBuf.current[k];
      buf.push(ang[k]);
      if (buf.length > N) buf.shift();
    });
    const avg = arr => arr.reduce((a,b)=>a+b,0) / Math.max(arr.length,1);
    return {
      knee: Math.round(avg(smoothBuf.current.knee)),
      hip: Math.round(avg(smoothBuf.current.hip)),
      torso: Math.round(avg(smoothBuf.current.torso)),
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
  function updateRepState(ang, ts, onRepComplete) {
    let cur = phaseRef.current;

    const atTopKnee = ang.knee >= THRESH.kneeTop;
    const atBotKnee = ang.knee <= THRESH.kneeBottom;
    const leaveTop  = ang.knee < (THRESH.kneeTop - 5); // 5° hysteresis

    // light anti-fake using the last Top baseline
    const base = topBaseline.current;
    const sig  = curSig.current || {};
    const hipDrop   = base && sig.hipY   != null ? (sig.hipY - base.hipY) : 0;           // + = down
    const ankleLift = base && sig.ankleY != null ? Math.abs(sig.ankleY - base.ankleY) : 0;
    const heelLift  = base && sig.heelY  != null ? Math.abs(sig.heelY  - base.heelY)  : 0;

    const rawFoot   = Math.max(ankleLift, heelLift || 0);
    const alpha = 0.2; // smoothing factor
    footLiftEmaRef.current = alpha * rawFoot + (1 - alpha) * (footLiftEmaRef.current ?? 0);
    const footLift = footLiftEmaRef.current;

    const bottomOK = atBotKnee && hipDrop >= GEO.minHipDrop && footLift <= GEO.maxFootLift;
    const topOK    = atTopKnee;

    // --- Track per-rep stats (min knee, max torso, timing) ---
    if (!currentRepStats.current && phaseRef.current === "Top" && leaveTop) {
      // Just leaving Top -> new rep starting
      currentRepStats.current = {
        startTs: ts,
        minKnee: ang.knee,
        maxTorso: ang.torso,
      };
    } else if (currentRepStats.current) {
      // Rep in progress: update stats each frame
      currentRepStats.current.minKnee = Math.min(
        currentRepStats.current.minKnee,
        ang.knee
      );
      currentRepStats.current.maxTorso = Math.max(
        currentRepStats.current.maxTorso,
        ang.torso
      );
    }

    // Phase transitions
    if (cur === "Top" && leaveTop) {
      cur = "Down";
    } else if (cur === "Down" && bottomOK) {
      cur = "Bottom";
      bottomSince.current = ts;
    } else if (cur === "Down" && atTopKnee && !bottomSince.current) { 
      cur = "Top";
      currentRepStats.current = null;
      topBaseline.current = { ...curSig.current, torso: ang.torso };
      if (DEBUG) console.log("[HerHealth] Resetting phase to Top (no bottom reached)");
    } else if (cur === "Bottom") {
      if (bottomSince.current && ts - bottomSince.current >= THRESH.minBottomMs) {
        if (!atBotKnee) cur = "Up";
      }
    } else if (cur === "Up" && topOK) {
      cur = "Top";

      // Rep has just finished.
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
          durationMs: currentRepStats.current.startTs != null
            ? ts - currentRepStats.current.startTs
            : null,
        };
      }

      currentRepStats.current = null;

      if (typeof onRepComplete === "function") {
        onRepComplete(repSummary);
      }
    }

    if (cur !== phaseRef.current) {
      phaseRef.current = cur;
      setPhase(cur);
      if (DEBUG) console.log("[HerHealth] phase:", cur, {
        hipDrop: +hipDrop.toFixed(3),
        footLift: +footLift.toFixed(3),
      });
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

  // --- Decide front vs side, with hysteresis (your requested block) ---
  const modeNow = autoDetectMode(lms); // "front" | "side"

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

  const curMode = viewModeRef.current;

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
  const atTopKneeNow = ang.knee >= (THRESH.kneeTop - 5);
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

  //Mode-specific eligibility
  const ok = (curMode === "front")
    ? lowerBodyEligibleFront(lms)
    : lowerBodyEligible(lms, angRaw.side);
  if (!ok) return;

  let valgusMetric = null;
  if (curMode === "front") {
    valgusMetric = computeValgusMetricFront(lms);
  }

  currentRepTraceRef.current.push({
    knee:  ang.knee,
    hip:   ang.hip,
    torso: ang.torso,
    valgus: valgusMetric,
  });
    // Rep-state + scoring
  // Rep-state + scoring + form checks
updateRepState(ang, performance.now(), (repSummary) => {
    // 1. Grab & reset the full trace for this rep
    const userTrace = currentRepTraceRef.current;
    currentRepTraceRef.current = [];

    // 1a. Derive a simple valgus metric for the rep (max over frames)
    const valgusValues = userTrace
      .map(f => f.valgus)
      .filter(v => v != null);

    const valgusMetric = valgusValues.length
      ? Math.max(...valgusValues)   // bigger => knees closer than feet
      : null;

    const repWithValgus = {
      ...repSummary,
      valgusMetric,
    };

    // 2. Pick the right reference trace (front/side file)
    const refTrace = refTargets?.aggregate || [];

    // 3. Compute a 0–100 similarity score
    const score = scoreRepAgainstRef(userTrace, refTrace);
    const label = classifyScore(score); // "green" | "amber" | "red"

    // 4. Form check
    const form = checkForm({
      ...repWithValgus,
      viewMode: viewModeRef.current,
    });

    setLastFormFeedback(form);
    setLastRepScore({ score, label, form });

    // 5. Technique-first logic:
    //    - If techniqueFirst is on and form is not OK, do NOT count or save the rep.
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
          viewMode: viewModeRef.current,
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
  topBaseline.current = null;     // ← reset baseline
  currentRepStats.current = null;
  setSession({ startedAt: Date.now(), endedAt: null, frames: [], reps: [], summary: null });
}

  function endSessionAndSave() {
  setSession(s => {
    const now = Date.now();
    const durationSec = s.startedAt ? Math.round((now - s.startedAt) / 1000) : 0;

    let summary = {
      reps: repCount,
      meanFps: fps,
      durationSec,
      date: new Date().toISOString(),
    };

    //compute quality using the reference JSON (current view mode)
    let quality = null;
    try {
      if (refTargets?.aggregate) {
        quality = scoreSessionReps(s.reps, refTargets.aggregate);
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

    const finished = { ...s, endedAt: now, summary, quality };

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
  if (!s || !h || !k || !a) return null;

  const knee = angleDeg(h, k, a);
  const hip  = angleDeg(s, h, k);
  const tx = h.x - s.x, ty = h.y - s.y;
  const torso = Math.round((Math.acos(ty / (Math.hypot(tx, ty) || 1)) * 180) / Math.PI);

  return { knee, hip, torso, side };
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
      <div className="fixed top-3 right-3 z-50 bg-black/70 text-white px-3 py-2 rounded-xl">
          Mode: {viewMode === "front" ? "Front" : "Side"}
      </div>
      <button
        className="fixed bottom-3 right-3 px-3 py-1 rounded-xl bg-black/60 text-white"
        onClick={() => setViewMode(m => (m === "front" ? "side" : "front"))}
      >
        Mode Button: {viewMode === "front" ? "Front" : "Side"}
      </button>


    {refTargets && (
      <div className="fixed top-16 right-3 z-50 bg-emerald-700/80 text-white px-3 py-2 rounded-xl text-xs">
        <div>Ref mode: {viewMode}</div>
        <div>Athlete: {refTargets.athlete}</div>
        <div>Clips: {refTargets.clips?.length ?? 0}</div>
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