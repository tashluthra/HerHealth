import React, { useEffect, useRef, useState } from "react";
import { FilesetResolver, PoseLandmarker, DrawingUtils } from "@mediapipe/tasks-vision";

export default function SquatCam() {
  //refs to DOM elements and other mutable objects
  const videoRef = useRef(null); //<video> element that shows the webcam stream
  const canvasRef = useRef(null); //<canvas> overlay for drawing lines
  const rafRef = useRef(null);
  const landmarkerRef = useRef(null);
  const phaseRef = useRef("Top");

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

  // smoothing + timing refs
  const smoothBuf = useRef({ knee: [], hip: [], torso: [] });
  const lastFrameTs = useRef(performance.now());
  const bottomSince = useRef(null);

  // thresholds (tune later on your clips)
  const THRESH = { 
    kneeBottom: 100, 
    kneeTop: 160, hipFold: 120, 
    minBottomMs: 80 };


  // which anatomical side we’re using for angles (auto L/R with hysteresis)
const [sideUsed, setSideUsed] = useState("L");
const sideStickyRef = useRef({ side: "L", wins: 0 });



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
  const visOK = pts.every(p => (p.visibility ?? 0) > 0.5);
  const inFrameOK = pts.every(p => p.x>0 && p.x<1 && p.y>0 && p.y<0.98);
  return visOK && inFrameOK;
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

  // --- FPS + reps ---
  function tickFps() {
    const now = performance.now();
    const dt = now - lastFrameTs.current;
    lastFrameTs.current = now;
    const inst = 1000 / Math.max(dt, 1);
    setFps(f => Math.round(0.8 * f + 0.2 * inst)); // gentle smoothing
  }

  function updateRepState(ang, ts) {
  let cur = phaseRef.current;                  // use the ref as the source of truth
  const atTop = ang.knee >= THRESH.kneeTop;
  const atBottom = ang.knee <= THRESH.kneeBottom;

  if (cur === "Top" && !atTop) cur = "Down";
  else if (cur === "Down" && atBottom) { cur = "Bottom"; bottomSince.current = ts; }
  else if (cur === "Bottom") {
    if (bottomSince.current && ts - bottomSince.current >= THRESH.minBottomMs) {
      if (!atBottom) cur = "Up";
    }
  } else if (cur === "Up" && atTop) {
    cur = "Top";
    setRepCount(c => c + 1);
    setSession(s => ({ ...s, reps: [...s.reps, { t: ts, knee: ang.knee, hip: ang.hip, torso: ang.torso }] }));
  }

  if (cur !== phaseRef.current) {
    phaseRef.current = cur;    // keep the ref in sync for the draw loop
    setPhase(cur);             // update React state for the HUD
    if (DEBUG) console.log("[HerHealth] Phase:", phaseRef.current);
  }
}


  // Call this for each MediaPipe result
  function handlePoseResults(res) {
  if (DEBUG) console.count("[HerHealth] handlePoseResults calls");
  tickFps();

  const lms = res?.landmarks?.[0];
  if (!lms) return;

  // use the SIDE-AWARE compute
  const angRaw = computeAnglesSideAware(lms);
  if (!angRaw) return;

  const ang = smoothAngles(angRaw);   // {knee, hip, torso}
  setSideUsed(angRaw.side);           // "L" or "R"

  // update the coords panel to match the chosen side
  const I = IDX[angRaw.side];
  setCoords({
    hip:      `${lms[I.hip].x.toFixed(3)}, ${lms[I.hip].y.toFixed(3)}`,
    knee:     `${lms[I.knee].x.toFixed(3)}, ${lms[I.knee].y.toFixed(3)}`,
    ankle:    `${lms[I.ankle].x.toFixed(3)}, ${lms[I.ankle].y.toFixed(3)}`,
    shoulder: `${lms[I.shoulder].x.toFixed(3)}, ${lms[I.shoulder].y.toFixed(3)}`
  });

  const ok = lowerBodyEligible(lms, angRaw.side);
  if (!ok) {
    // don’t advance the state machine when legs aren’t visible
    if (phaseRef.current !== "Down") { phaseRef.current = "Down"; setPhase("Down"); }
    return;
  }

  // update the HUD numbers + counter
  updateRepState(ang, performance.now());

  // optional diagnostics (capped)
  setSession(s => s.startedAt
    ? { ...s, frames: s.frames.length < 2000 ? [...s.frames, { t: Date.now(), ...ang, side: angRaw.side }] : s.frames }
    : s
  );
}


  // session controls
  function startSession() {
  setRepCount(0);
  setPhase("Top");
  phaseRef.current = "Top";    // ← add this
  bottomSince.current = null;
  setSession({ startedAt: Date.now(), endedAt: null, frames: [], reps: [], summary: null });
}

  function endSessionAndSave() {
    setSession(s => {
      const durationSec = s.startedAt ? Math.round((Date.now() - s.startedAt) / 1000) : 0;
      const summary = { reps: repCount, meanFps: fps, durationSec, date: new Date().toISOString() };
      const finished = { ...s, endedAt: Date.now(), summary };
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
  <div className="w-full max-w-3xl mx-auto p-4 grid gap-3">
    <div className="relative rounded-2xl overflow-hidden shadow">
      <video ref={videoRef} className="w-full h-auto" playsInline muted />
      <canvas ref={canvasRef} className="absolute inset-0 w-full h-full pointer-events-none" />
    </div>

    {/* HUD */}
    <div className="fixed bottom-3 left-3 z-50 bg-black/70 text-white px-3 py-2 rounded-xl flex gap-3 items-center">
      <button onClick={startSession} className="px-3 py-1 rounded-lg bg-white/10 hover:bg-white/20">Start</button>
      <button onClick={endSessionAndSave} className="px-3 py-1 rounded-lg bg-white/10 hover:bg-white/20">End &amp; Save</button>
      <span>FPS: {fps}</span>
      <span>Reps: {repCount}</span>
      <span>Phase: {phase}</span>
    </div>

    {/* existing status + coords panels */}
    <div className="text-sm opacity-70">...</div>
    <div className="grid grid-cols-2 gap-2 text-sm rounded-2xl border p-3">...</div>
  </div>
  );

}
