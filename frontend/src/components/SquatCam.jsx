import React, { useEffect, useRef, useState } from "react";
import { FilesetResolver, PoseLandmarker, DrawingUtils } from "@mediapipe/tasks-vision";

export default function SquatCam() {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const rafRef = useRef(null);
  const landmarkerRef = useRef(null);

  const [ready, setReady] = useState(false); //is the webcam ready
  const [modelReady, setModelReady] = useState(false); //is the pose model ready 
  const [modelRoot, setModelRoot] = useState(""); // shows which root worked
  const [error, setError] = useState(null);
  const [coords, setCoords] = useState({
  hip: "–", knee: "–", ankle: "–", shoulder: "–"
  });

  useEffect(() => {
    let mounted = true;

    async function initLandmarker() {
      // Try both layouts: .../mediapipe/wasm/* or .../mediapipe/* (no subfolder)
      const roots = ["/mediapipe/wasm", "/mediapipe"];
      let lastErr = null;

      for (const root of roots) {
        try {
          console.info("[HerHealth] Trying fileset root:", root);
          const resolver = await FilesetResolver.forVisionTasks(root);
          const landmarker = await PoseLandmarker.createFromOptions(resolver, {
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
        // 1) Camera
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "user" },
          audio: false,
        });
        if (!mounted || !videoRef.current) return;
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        setReady(true);

        // 2) MediaPipe model (robust path handling)
        const { landmarker, root } = await initLandmarker();
        if (!mounted) return;
        landmarkerRef.current = landmarker;
        setModelRoot(root);
        setModelReady(true);
        console.info("[HerHealth] Model ready from root:", root);

        // 3) Render loop
        const tick = () => {
          if (!mounted) return;
          const video = videoRef.current;
          const canvas = canvasRef.current;
          if (!video || !canvas) {
            rafRef.current = requestAnimationFrame(tick);
            return;
          }
          const ctx = canvas.getContext("2d");
          if (ctx && video.readyState >= 2) {
            if (canvas.width !== video.videoWidth) canvas.width = video.videoWidth;
            if (canvas.height !== video.videoHeight) canvas.height = video.videoHeight;

            ctx.clearRect(0, 0, canvas.width, canvas.height);

            // border (helps see the overlay is aligned)
            ctx.strokeStyle = "rgba(255,255,255,0.5)";
            ctx.lineWidth = 2;
            ctx.strokeRect(6, 6, canvas.width - 12, canvas.height - 12);

            // draw pose landmarks
            if (landmarkerRef.current) {
              try {
                const results = landmarkerRef.current.detectForVideo(video, performance.now());
                if (results?.poseLandmarks?.length) {
                  const lm = results.poseLandmarks[0];

                  // update coords here
                  setCoords({
                    hip: `${lm[23].x.toFixed(3)}, ${lm[23].y.toFixed(3)}`,
                    knee: `${lm[25].x.toFixed(3)}, ${lm[25].y.toFixed(3)}`,
                    ankle: `${lm[27].x.toFixed(3)}, ${lm[27].y.toFixed(3)}`,
                    shoulder: `${lm[11].x.toFixed(3)}, ${lm[11].y.toFixed(3)}`
                  });

                  // draw after
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
