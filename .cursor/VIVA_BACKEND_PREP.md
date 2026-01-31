# Backend Viva Prep — build_reference_templates.py

**Purpose:** Turn raw squat videos into a reusable reference template that the frontend uses to score user squats.

---

## 1. Big Picture

```
Raw videos (front/*.mp4, side/*.mp4)
    → MediaPipe pose detection (per frame)
    → Extract biomechanical features (angles, valgus, etc.)
    → Detect one rep per video (start → bottom → end)
    → Cut & resample to 60 frames
    → Aggregate multiple clips → single "ideal" template
    → Save reference_clips.json
```

**Why this exists:** The frontend compares the user's live squat to this reference. Without the backend, there is no "good form" to compare against.

---

## 2. Dependencies (requirements.txt)

| Package         | Purpose                                                 |
| --------------- | ------------------------------------------------------- |
| `opencv-python` | Read video frames (`cv2.VideoCapture`), convert BGR→RGB |
| `mediapipe`     | Pose detection — 33 body landmarks per frame            |
| `numpy`         | Arrays, math (angles, resampling, aggregation)          |

**Why MediaPipe?** Free, well-documented, runs on CPU, good accuracy for full-body pose. Alternatives: OpenPose (heavier), MoveNet (lighter but fewer landmarks).

---

## 3. Config & Constants

```python
ref_directory = Path("../frontend/public/reference")   # Where videos live
output_json = ref_directory / "reference_clips.json"  # Where output goes
n_samples = 60   # Fixed length per rep (30 down, 30 up)
```

**Why 60 samples?**

- Rep speed varies (fast vs slow squat). Raw frame count would differ.
- Resampling to 60 makes every rep comparable: frame 0 = start, frame 30 ≈ bottom, frame 59 = end.
- Frontend uses the same 60-frame length → direct comparison.

**Expected directory structure:**

```
frontend/public/reference/
├── front/          ← *.mp4 videos (person facing camera)
├── side/           ← *.mp4 videos (person in profile)
└── reference_clips.json   ← output (created by script)
```

---

## 4. Helper Functions

### 4.1 `moving_average(x, k=5)`

**What it does:** Smooths a 1D signal with a sliding window of size k.

**Why:** Pose detection is noisy frame-to-frame. Smoothing reduces jitter so rep detection and angles are stable.

**How:** `np.convolve(x, kernel, mode="same")` — each point becomes the average of its neighbours.

---

### 4.2 `angle(a, b, c)` — Joint angle at b

**What it does:** Computes the angle at point **b** between vectors **ba** and **bc** (in degrees).

```
     a
      \
       \  angle
        b -------- c
```

**Formula:**

1. `ba = a - b`, `bc = c - b`
2. `cos(angle) = dot(ba, bc) / (|ba| * |bc|)`
3. `angle = arccos(cos)`, convert to degrees

**Why clip cos to [-1, 1]?** Floating-point errors can push cos slightly outside that range; arccos would fail.

**Used for:** Hip angle (shoulder–hip–knee), knee angle (hip–knee–ankle), ankle angle (knee–ankle–toe).

---

### 4.3 `torso_angle(hip, shoulder)` — Forward lean

**What it does:** Angle of torso (hip→shoulder) relative to vertical.

- 0° = upright
- Positive = leaning forward

**Formula:** Angle between `(shoulder - hip)` and vertical `(0, -1)` (up in image coords = negative y).

**Why:** Excessive forward lean is a common form issue; we track it in side view.

---

### 4.4 `resample(traj, n=60)` — Fixed-length interpolation

**What it does:** Takes a variable-length array and stretches/shrinks it to exactly `n` points using linear interpolation.

**How:**

1. Map original indices to [0, 1]: `x = linspace(0, 1, len(traj))`
2. Map target indices to [0, 1]: `xi = linspace(0, 1, n)`
3. `np.interp(xi, x, traj)` — interpolate

**Why:** Different videos have different frame rates and rep speeds. Resampling normalises time so we can compare rep shapes.

---

## 5. Rep Detection — `detect_rep_from_hip_y(hip_y)`

**Idea:** During a squat, the hip moves down (bottom) then up (back to top). Hip Y in image coordinates goes **up** at bottom (Y increases downward).

**Algorithm:**

1. Smooth `hip_y` with `moving_average(k=7)`
2. **Bottom** = frame with **max** hip_y (lowest point in image)
3. **Start** = frame with **min** hip_y before bottom (top of squat)
4. **End** = frame with **min** hip_y after bottom (back at top)

```
hip_y (image coords, down = larger)
    ^
    |     start          end
    |       *              *
    |        \            /
    |         \          /
    |          \   *    /    ← bottom (max)
    |           \     /
    +----------------------> frame index
```

**Returns:** `(start_idx, bottom_idx, end_idx)`

**Why hip Y?** Simple, robust. Hip is central and moves predictably. Knee angle could work but is noisier.

**Used by:** Both `process_video_side` (single hip) and `process_video_front` (hip centre).

---

## 6. Side-View Processing — `process_video_side(path)`

**Plane:** Sagittal (side view) — flexion/extension, forward lean.

### 6.1 Landmarks Used (MediaPipe Pose)

| Landmark         | Use                                           |
| ---------------- | --------------------------------------------- |
| RIGHT_SHOULDER   | Hip angle, torso angle                        |
| RIGHT_HIP        | Hip Y (rep detection), hip/knee angles, torso |
| RIGHT_KNEE       | Hip, knee angles                              |
| RIGHT_ANKLE      | Knee, ankle angles                            |
| RIGHT_FOOT_INDEX | Ankle angle (dorsiflexion)                    |

**Why right side only?** Side view shows one leg. We pick one side; both are equivalent for a symmetric squat.

### 6.2 Features Extracted (per frame)

| Feature   | Formula                    | Biomechanical meaning               |
| --------- | -------------------------- | ----------------------------------- |
| **hip**   | angle(shoulder, hip, knee) | Hip flexion                         |
| **knee**  | angle(hip, knee, ankle)    | Knee flexion (main depth indicator) |
| **ankle** | angle(knee, ankle, toe)    | Ankle dorsiflexion                  |
| **torso** | torso_angle(hip, shoulder) | Forward lean                        |

**Domain link:** Squat depth is often defined by knee flexion (e.g. 90° = parallel, 120°+ = deep). Torso control affects low-back load.

### 6.3 Pipeline

1. Open video with `cv2.VideoCapture`
2. For each frame: BGR→RGB, `pose.process(rgb)`, extract landmarks
3. Convert normalised (0–1) coords to pixels: `lm.x * w`, `lm.y * h`
4. Compute angles, append to lists
5. **Quality gating:** Reject if total_frames==0, valid_frames<60, or detection_rate<0.6
6. **Smooth** all signals
7. **Rep detection** via `detect_rep_from_hip_y(hip_y)`
8. **Rep gating:** Reject if rep too short (<20 frames) or bottom too close to edges
9. **Cut** arrays to `[start : end+1]`, **resample** each to 60
10. Return template dict

### 6.4 Output Template (side)

```json
{
  "file": "clip1.mp4",
  "fps": 30.0,
  "view": "side",
  "rep_indices": { "start": 10, "bottom": 45, "end": 80 },
  "trajectories": {
    "hip": [120, 118, ...],   // 60 values
    "knee": [168, 165, ...],
    "ankle": [90, 88, ...],
    "torso": [25, 28, ...]
  },
  "quality": { "total_frames": 100, "valid_frames": 95, "detection_rate": 0.95 }
}
```

---

## 7. Front-View Processing — `process_video_front(path)`

**Plane:** Frontal — valgus, symmetry, pelvic drop.

### 7.1 Landmarks Used

Both left and right: hip, knee, ankle, shoulder.

### 7.2 Features Extracted (per frame)

| Feature      | Formula                                  | Biomechanical meaning                                               |
| ------------ | ---------------------------------------- | ------------------------------------------------------------------- |
| **valgus**   | `(lk.x - la.x)/stanceWidth` averaged L+R | Knee inward collapse (valgus). Positive = knees closer than ankles. |
| **symmetry** | `(lk.x - rk.x)/hipWidth` minus baseline  | Left–right knee balance. Baseline = first frame.                    |
| **pelvic**   | `(lh.y - rh.y)/hipWidth` minus baseline  | Pelvic drop (one hip lower).                                        |
| **depth**    | `hip_centre.y/hipWidth` minus baseline   | Depth proxy (hip drops = deeper squat).                             |

**Why baseline subtraction?** Different people have different stance widths and positions. We care about **change during the rep**, not absolute position. Baseline = first valid frame (top of squat).

**Domain link:** Knee valgus is a known ACL injury risk factor in women. Pelvic drop relates to hip strength and control.

### 7.3 Pipeline

Same structure as side: video → pose → features → quality gate → smooth → rep detect → cut & resample → template.

### 7.4 Output Template (front)

```json
{
  "file": "frontRef1.mp4",
  "view": "front",
  "trajectories": {
    "valgus": [...],
    "symmetry": [...],
    "pelvic": [...],
    "depth": [...]
  },
  ...
}
```

---

## 8. Directory Processing — `process_directory(view_dir, view)`

**What it does:** Loops over `*.mp4` in `view_dir`, calls `process_video_front` or `process_video_side`, collects non-None templates.

**Note:** Expects `front/*.mp4` and `side/*.mp4`. Your `raw_videos/` has `.MOV` — you’d need to convert or add support.

---

## 9. Aggregation — `aggregate_templates(templates, drop_worst_pct=0.2, use_median=True)`

**Goal:** Many clips → one "ideal" template + spread (variability).

### 9.1 Algorithm

1. **Stack** all clips: for each key, shape `(num_clips, 60)`
2. **Preliminary centre:** median (or mean) across clips per timestep
3. **Distance:** For each clip, `distance_to_centre` = mean absolute error vs centre
4. **Drop worst 20%:** Keep clips with lowest distance
5. **Recompute** centre and spread on kept clips only
6. **Spread:** MAD (median absolute deviation) if median, else std

### 9.2 `distance_to_centre(template, centre)`

Mean absolute error between template trajectories and centre, averaged over all keys and timesteps.

### 9.3 Why median?

**Robust to outliers.** One bad clip (occlusion, wrong rep) won’t skew the centre. Mean would be pulled toward the outlier.

### 9.4 Why drop worst 20%?

Clips that are far from the median are likely bad (wrong angle, partial rep, noise). Dropping them improves the reference quality.

### 9.5 Output (aggregate)

```json
{
  "keys": ["hip", "knee", "ankle", "torso"],
  "n_samples": 60,
  "centre": { "hip": [...], "knee": [...], ... },
  "spread": { "hip": [...], "knee": [...], ... },
  "spread_type": "mad",
  "kept": ["clip1.mp4", "clip2.mp4", ...],
  "dropped": ["bad_clip.mp4"],
  "distances": [{"file": "...", "distance": 0.5}, ...]
}
```

**Frontend uses:** `aggregate.centre` (or `aggregate.center`) as the reference trace. Per-clip data is kept for debugging/analysis.

---

## 10. Main Flow — `main()`

```python
front_templates = process_directory(front_dir, "front")
side_templates = process_directory(side_dir, "side")
# Raise if either is empty
front_agg = aggregate_templates(front_templates, drop_worst_pct=0.2, use_median=True)
side_agg = aggregate_templates(side_templates, drop_worst_pct=0.2, use_median=True)
data = { "front": { "clips": ..., "aggregate": ... }, "side": { ... } }
output_json.write_text(json.dumps(data, indent=2))
```

---

## 11. Links to Frontend

| Backend                               | Frontend                                                                  |
| ------------------------------------- | ------------------------------------------------------------------------- |
| `reference_clips.json`                | Fetched by `SquatCam` on load: `fetch('/reference/reference_clips.json')` |
| `aggregate.centre`                    | `buildRefTraceForMode()` turns it into `[{knee: x, hip: y, ...}, ...]`    |
| Keys: hip, knee, ankle, torso         | `buildRepData`, `scoreRep`, `SIDE_KEYS`                                   |
| Keys: valgus, symmetry, pelvic, depth | `buildRepData`, `scoreRep`, `FRONT_KEYS`                                  |
| 60 samples                            | `TARGET_N = 60`, `resampleTrace`, `buildRepData`                          |

**Critical:** Frontend and backend must use the same keys and 60-frame length. Any mismatch breaks scoring.

---

## 12. Domain / Biomechanics Context

### 12.1 Why two views?

- **Side (sagittal):** Depth, knee/hip flexion, forward lean — main movement plane.
- **Front (frontal):** Valgus, symmetry, pelvic drop — injury risk and control.

### 12.2 Knee valgus (front view)

- **Definition:** Knees moving inward toward each other (valgus collapse).
- **Relevance:** Linked to ACL injury risk in women; hip strength can help control it.
- **Our metric:** Normalised knee X relative to ankle X. Positive = knees closer than ankles.

### 12.3 Squat depth (side view)

- **Definition:** Often by knee flexion (e.g. 90° parallel, 120°+ deep).
- **Our metric:** Knee angle (hip–knee–ankle). Smaller angle = deeper.

### 12.4 Forward lean (side view)

- **Definition:** Torso angle from vertical.
- **Relevance:** Too much lean increases low-back load; some lean is normal.

### 12.5 Pelvic drop (front view)

- **Definition:** One hip drops lower than the other.
- **Relevance:** Indicates hip strength/control asymmetry.

---

## 13. Design Decisions & Reasoning

| Decision                         | Why                                                    |
| -------------------------------- | ------------------------------------------------------ |
| **60 samples**                   | Fixed length for comparison; independent of rep speed. |
| **Median aggregation**           | Robust to outlier clips.                               |
| **Drop worst 20%**               | Removes bad clips before final centre.                 |
| **Baseline subtraction (front)** | Focus on movement shape, not stance.                   |
| **Hip Y for rep detection**      | Simple, robust, central to movement.                   |
| **Quality gating**               | Reject clips with poor pose detection.                 |
| **Separate front/side**          | Different planes, different features.                  |
| **Resampling**                   | Normalise time for shape comparison.                   |

---

## 14. Viva Q&A — Suggested Answers

**Q: Why did you use MediaPipe?**  
A: It’s free, well-documented, runs on CPU, and gives 33 landmarks. Good balance of accuracy and ease of use. Alternatives like OpenPose are heavier; MoveNet has fewer landmarks.

**Q: Why 60 samples per rep?**  
A: Rep speed varies. Resampling to 60 normalises time so we compare shapes, not raw frame counts. The frontend uses the same 60-frame length for direct comparison.

**Q: Why median instead of mean for aggregation?**  
A: One bad clip (occlusion, wrong rep) would skew the mean. Median is robust to outliers.

**Q: Why drop the worst 20% of clips?**  
A: Clips far from the median are likely bad. Dropping them improves the reference quality before we compute the final centre.

**Q: Why baseline subtraction for front-view features?**  
A: Different people have different stance widths and positions. We care about change during the rep, not absolute position. Baseline = top of squat.

**Q: Why hip Y for rep detection?**  
A: Hip moves predictably: down at bottom, up at top. Simple and robust. Knee angle could work but is noisier.

**Q: How does your valgus metric relate to what a physio would measure?**  
A: Physios often measure knee abduction angle or moment. We use a 2D proxy: knee X relative to ankle X, normalised by stance width. It captures inward collapse from a front view. It’s not a direct lab measure but is usable for feedback.

**Q: What are the limitations?**  
A: (1) 2D only — no true 3D angles. (2) Camera angle matters — side/front must be roughly correct. (3) Lighting and clothing can affect pose detection. (4) Single rep per video — no multi-rep support. (5) Reference is from one person/clips — may not generalise to all users.

**Q: What would you improve?**  
A: (1) Support .MOV or auto-convert. (2) Multiple reps per video. (3) User-specific or demographic-specific references. (4) Validate against lab-based motion capture. (5) 3D pose if multiple cameras available.

---

## 15. Quick Reference — Key Numbers

| Constant           | Value                       | Meaning                              |
| ------------------ | --------------------------- | ------------------------------------ |
| n_samples          | 60                          | Frames per rep                       |
| moving_average k   | 5 (helpers), 7 (rep detect) | Smoothing window                     |
| min valid_frames   | 60                          | Reject short clips                   |
| min detection_rate | 0.6                         | Reject poor pose detection           |
| min rep length     | 20 frames                   | Reject tiny reps                     |
| bottom margin      | 3 frames                    | Bottom must not be at very start/end |
| drop_worst_pct     | 0.2                         | Drop 20% worst clips                 |

---

_End of Backend Viva Prep_
