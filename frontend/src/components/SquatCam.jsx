import React, { useEffect, useRef, useState } from "react";
import { FilesetResolver, PoseLandmarker, DrawingUtils } from "@mediapipe/tasks-vision";

export default function SquatCam() {
  //refs to DOM elements and other mutable objects
  const videoRef = useRef(null); //<video> element that shows the webcam stream
  const canvasRef = useRef(null); //<canvas> overlay for drawing lines
  const rafRef = useRef(null);
  const landmarkerRef = useRef(null);

  //state variables for rendering
  const [ready, setReady] = useState(false); //is the webcam ready
  const [modelReady, setModelReady] = useState(false); //is the pose model ready 
  const [modelRoot, setModelRoot] = useState(""); //which mediapipe root was used
  const [error, setError] = useState(null); //error messages
  //state to hold the last detected coords (for hip, knee, ankle, shoulder)
  const [coords, setCoords] = useState({ 
  hip: "–", knee: "–", ankle: "–", shoulder: "–" 
  });

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

                // ✅ tasks-vision uses `landmarks`
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
                  setCoords({
                    hip:      `${lm[23].x.toFixed(3)}, ${lm[23].y.toFixed(3)}`,
                    knee:     `${lm[25].x.toFixed(3)}, ${lm[25].y.toFixed(3)}`,
                    ankle:    `${lm[27].x.toFixed(3)}, ${lm[27].y.toFixed(3)}`,
                    shoulder: `${lm[11].x.toFixed(3)}, ${lm[11].y.toFixed(3)}`
                  });

                  // Draw the skeleton
                  const utils = new DrawingUtils(ctx);
                  utils.drawLandmarks(lm);
                  utils.drawConnectors(lm, PoseLandmarker.POSE_CONNECTIONS);
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

      <div className="text-sm opacity-70">
        {error
          ? `Camera/model error: ${error}`
          : ready
            ? `Webcam ready${modelReady ? ` • Model ready (${modelRoot})` : " • Loading model…"}`
            : "Requesting camera…"}
      </div>

      <div className="grid grid-cols-2 gap-2 text-sm rounded-2xl border p-3">
        <div className="opacity-70">Hip</div><div>{coords.hip}</div>
        <div className="opacity-70">Knee</div><div>{coords.knee}</div>
        <div className="opacity-70">Ankle</div><div>{coords.ankle}</div>
        <div className="opacity-70">Shoulder</div><div>{coords.shoulder}</div>
    </div>
    </div>
  );
}
