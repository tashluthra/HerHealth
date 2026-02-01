# Logic Layer Viva Prep — buildRepData, scoreRep, scoringWeights

**Purpose:** The logic layer takes the user's squat trace and the expert reference trace, aligns them, and produces a 0–100 score plus form feedback flags.

---

## 1. Big Picture

```
Backend: reference_clips.json (aggregate.centre)
    │
    ▼
SquatCam: buildRefTraceForMode() → rawRefTrace (60 frames)
    │
    │  User: currentRepTraceRef → rawUserTrace (variable length)
    │
    ▼
buildRepData(rawUserTrace, rawRefTrace, mode, 60)
    │
    │  Output: { user: user60, ref: ref60, keys, mode, targetN }
    │
    ▼
scoreRep({ userTrace60, refTrace60, mode })
    │
    │  Output: { score, weightedSimilarity, perKeySimilarity, flags }
    │
    ▼
SquatCam: displays score, flags, feedback
```

**In one sentence:** buildRepData aligns user and reference traces to 60 frames (using phase-based resampling when a valid bottom is detected); scoreRep compares them with cosine similarity and weights to produce a 0–100 score and form flags.

---

## 2. Files in the Logic Layer

| File                | Purpose                                                                            |
| ------------------- | ---------------------------------------------------------------------------------- |
| `buildRepData.js`   | Aligns user and reference traces (pick keys, phase-based or linear resample to 60) |
| `scoreRep.js`       | Scores a rep against reference (cosine similarity, weights, flags)                 |
| `scoringWeights.js` | Defines keys and weights per mode (front/side)                                     |
| `trajectory.js`     | `resampleTrace`, `resampleTraceByPhase` — resampling helpers                       |

---

## 3. buildRepData.js

### 3.1 Purpose

Takes raw user and reference traces (any length) and produces aligned 60-frame traces ready for scoring.

### 3.2 Inputs

| Input          | Source                                     | Meaning                                        |
| -------------- | ------------------------------------------ | ---------------------------------------------- |
| `userRawTrace` | SquatCam `currentRepTraceRef`              | Per-frame features collected during user's rep |
| `refRawTrace`  | `buildRefTraceForMode(refTemplates, mode)` | Reference from backend aggregate.centre        |
| `mode`         | `"front"` or `"side"`                      | Which view (determines keys)                   |
| `targetN`      | 60 (default)                               | Output length per trace                        |

### 3.3 Output

```javascript
{
  user: [{ knee: 168, hip: 120, ... }, ...],  // 60 frames
  ref:  [{ knee: 165, hip: 118, ... }, ...],  // 60 frames
  keys: ["knee", "hip", "ankle", "torso"],    // or front keys
  mode: "side",
  targetN: 60
}
```

### 3.4 Algorithm

1. **getTraceKeys(mode)** — Get keys for mode:
   - Front: `["valgus", "symmetry", "pelvic", "depth"]`
   - Side: `["knee", "hip", "torso", "ankle"]`

2. **pickKeys(trace, keys)** — Keep only the keys we care about; drop everything else.

3. **detectBottom(userRaw, keys, mode)** — Detect bottom frame:
   - Side: min knee angle = bottom (knee most flexed)
   - Front: max depth = bottom (hip lowest)

4. **User trace resampling:**
   - If valid bottom (bottomIdx > 0 and < length-1): **resampleTraceByPhase** — split at bottom, resample down phase to 30 frames, up phase to 30 frames (bottom at frame 30)
   - Else: **resampleTrace** — linear resample to 60

5. **resampleTrace(refRaw, keys, 60)** — Reference is already phase-aligned from backend; linear resample is fine (ref is 60 frames).

6. Return `{ user, ref, keys, mode, targetN }`.

### 3.5 Link to Backend

- Backend outputs `aggregate.centre` with keys `hip`, `knee`, `ankle`, `torso` (side) or `valgus`, `symmetry`, `pelvic`, `depth` (front).
- buildRepData expects the same keys. **Any mismatch breaks scoring.**

### 3.6 Link to trajectory.js

- `resampleTrace(trace, keys, N)` — Resamples each key's series to N points using linear interpolation, then rebuilds frames. Same idea as backend `resample()`: map progress 0→1, interpolate.
- `resampleTraceByPhase(trace, keys, bottomIdx, N)` — Phase-based resampling: split at bottomIdx, resample down phase to N/2 and up phase to N/2. Bottom aligns at frame N/2 (30). Falls back to linear if phases too short.

---

## 4. scoringWeights.js

### 4.1 Purpose

Defines which features matter and how much for each view. Weights must sum to 1.0.

### 4.2 Keys

| Mode      | Keys                                    |
| --------- | --------------------------------------- |
| **Front** | `valgus`, `symmetry`, `pelvic`, `depth` |
| **Side**  | `knee`, `hip`, `ankle`, `torso`         |

### 4.3 Weights

**Front:**
| Key | Weight | Rationale |
|-----|--------|-----------|
| valgus | 0.40 | Knee collapse — highest ACL injury risk |
| symmetry | 0.25 | Left–right balance |
| pelvic | 0.20 | Pelvic drop / hip control |
| depth | 0.15 | Squat depth proxy |

**Side:**
| Key | Weight | Rationale |
|-----|--------|-----------|
| knee | 0.35 | Main depth indicator, most visible |
| hip | 0.25 | Hip flexion |
| torso | 0.25 | Forward lean |
| ankle | 0.15 | Ankle dorsiflexion |

### 4.4 Why These Weights?

- **Research decision:** Based on biomechanical importance and injury risk.
- **Valgus highest (front):** Linked to ACL injury in women.
- **Knee highest (side):** Primary depth cue, most relevant for squat quality.
- **Weights sum to 1:** So weighted similarity is in [0, 1].

---

## 5. scoreRep.js

### 5.1 Purpose

Scores a single squat rep against the expert reference. Returns a 0–100 score and form flags.

### 5.2 Inputs

```javascript
scoreRep({
  userTrace60, // from buildRepData.user
  refTrace60, // from buildRepData.ref
  mode, // "front" or "side"
});
```

### 5.3 Output

```javascript
{
  score,              // 0–100
  weightedSimilarity, // raw weighted cosine (0–1)
  perKeySimilarity,   // { knee: 0.93, hip: 0.88, ... }
  flags,              // ["Excessive forward lean", ...]
}
```

### 5.4 Algorithm (Step by Step)

1. **Get keys and weights** from scoringWeights (FRONT_KEYS/SIDE_KEYS, FRONT_WEIGHTS/SIDE_WEIGHTS).

2. **Front view: normalise both traces** with `normaliseTrace()` from squatSimilarity.js:
   - Resample to 60 if needed
   - Baseline subtraction: subtract first-frame value from each channel
   - Aligns user (deltas) and reference (raw) for fair cosine comparison

3. **Side view:** Use traces as-is (no extra normalisation).

4. **cosineSimilarityByKey(userForSim, refForSim, keys)** — Compute cosine similarity per feature (see Section 6).

5. **Weighted sum:** `weighted = Σ (weights[k] × perKey[k])` for each key.

6. **similarityToScore(weighted, minSim)** — Map weighted similarity to 0–100 (see Section 7).

7. **detectFormIssues(perKey, mode)** — Generate flags from per-key similarities (see Section 8).

---

## 6. Cosine Similarity (squatSimilarity.js)

### 6.1 What It Measures

How similar two vectors are in **direction**, not magnitude. Range: [-1, 1].

- **1** = same direction (perfect match)
- **0** = orthogonal (no correlation)
- **-1** = opposite direction

### 6.2 Formula

For vectors **u** and **r**:

```
cos(θ) = (u · r) / (|u| × |r|)
```

- `u · r` = dot product
- `|u|` = norm (length) of u

### 6.3 How It's Used

For each key (e.g. knee):

- **userTrace** → vector of 60 values: `[168, 165, 120, ..., 168]`
- **refTrace** → vector of 60 values: `[165, 162, 118, ..., 165]`
- `cosineVec(userVec, refVec)` → similarity for that key

### 6.4 Why Cosine (Not Euclidean)?

- **Cosine** focuses on **shape** (direction of change over time).
- **Euclidean** is sensitive to scale (absolute values).
- We care about movement pattern, not absolute angle size.

### 6.5 cosineSimilarityByKey

- For each key, extracts numeric values from both traces (only indices where both are numeric).
- Computes cosine similarity for that key.
- Returns `{ perKey: { knee: 0.93, hip: 0.88, ... }, coverage: {...} }`.
- If fewer than 5 overlapping numeric points, returns 0 for that key.

---

## 7. normaliseTrace (Front View Only)

### 7.1 Why It's Used for Front View

- **User trace:** Uses baseline-relative deltas (symmetry, pelvic, depth already have baseline subtracted in SquatCam).
- **Reference trace:** May use raw values from backend.
- **normaliseTrace** aligns both: resample to 60 + subtract first-frame value per channel.
- Result: both traces start at 0 for each channel → fair shape comparison.

### 7.2 What It Does

1. Resample to 60 frames (linear interpolation) if needed.
2. For each key: subtract `out[0][k]` from all frames → trace starts at 0.
3. Focuses on **change during the rep**, not absolute position.

### 7.3 Why Not for Side View?

- Side view uses angles (knee, hip, ankle, torso) — already comparable across people.
- Front view uses normalised positions (valgus, symmetry, etc.) — baseline subtraction needed for alignment.

---

## 8. similarityToScore

### 8.1 Formula

```javascript
score = ((sim - minSim) / (1 - minSim)) * 100;
```

Clamped to [0, 100].

### 8.2 Parameters

| Mode      | minSim | Why                                              |
| --------- | ------ | ------------------------------------------------ |
| **Side**  | 0.6    | Angles are stable; expect higher similarity      |
| **Front** | 0.3    | 2D projection more sensitive; cosine tends lower |

### 8.3 Interpretation

- `sim = 1` → score = 100
- `sim = minSim` → score = 0
- `sim < minSim` → score = 0 (clamped)
- Linear mapping between minSim and 1.

---

## 9. detectFormIssues

### 9.1 Purpose

Turns per-key similarities into human-readable flags for feedback.

### 9.2 Thresholds

**Front:**
| Key | Threshold | Flag |
|-----|-----------|------|
| valgus | < 0.35 | "Knee valgus detected" |
| symmetry | < 0.70 | "Left–right imbalance" |
| depth | < 0.65 | "Insufficient depth" |

**Side:**
| Key | Threshold | Flag |
|-----|-----------|------|
| torso | < 0.70 | "Excessive forward lean" |
| knee | < 0.75 | "Poor knee tracking" |

### 9.3 Logic

- Low similarity for a key → that aspect of form differs from reference → flag it.
- Thresholds are tuned empirically; can be adjusted.

---

## 10. Links to Other Parts

### 10.1 Backend → Logic

| Backend                                                                             | Logic                                     |
| ----------------------------------------------------------------------------------- | ----------------------------------------- |
| `aggregate.centre` keys (hip, knee, ankle, torso / valgus, symmetry, pelvic, depth) | `getTraceKeys`, `SIDE_KEYS`, `FRONT_KEYS` |
| 60 samples per rep (phase-aligned: bottom at frame 30)                              | `targetN = 60`, `resampleTrace(..., 60)`  |

**Reference data notes:** The front-view symmetry in the reference uses small varied values (±0.02) rather than flat zeros, representing ideal left–right balance with subtle natural variation. Side-view boundary frames (0, 59) may be corrected for artifacts. See backend VIVA_BACKEND_PREP.md §9.6 for details.

### 10.2 Utils → Logic

| Util                                    | Used By               | Purpose                                         |
| --------------------------------------- | --------------------- | ----------------------------------------------- |
| `trajectory.resampleTrace`              | buildRepData          | Linear resample traces to 60 frames             |
| `trajectory.resampleTraceByPhase`       | buildRepData          | Phase-based resample when valid bottom detected |
| `squatSimilarity.normaliseTrace`        | scoreRep (front only) | Baseline subtraction for front view             |
| `squatSimilarity.cosineSimilarityByKey` | scoreRep              | Per-key cosine similarity                       |

### 10.3 SquatCam → Logic

| SquatCam                             | Logic                                        |
| ------------------------------------ | -------------------------------------------- |
| `rawUserTrace` (currentRepTraceRef)  | buildRepData(userRawTrace, ...)              |
| `rawRefTrace` (buildRefTraceForMode) | buildRepData(..., refRawTrace, ...)          |
| `repMode` ("front" \| "side")        | buildRepData(..., mode), scoreRep(..., mode) |
| `result.score`, `result.flags`       | Displayed in UI, passed to checkForm         |

### 10.4 Logic → formChecks

- `scoreRep` returns `flags` (cosine-based).
- `checkForm` (formChecks.js) does rule-based checks (depth, valgus, torso).
- Both feed into `lastFormFeedback`; `cosineFlags` merged with `form.issues`.

---

## 11. Two Scoring Paths (Important)

The codebase has **two** scoring approaches:

| Path                                       | Used By          | Method                                           |
| ------------------------------------------ | ---------------- | ------------------------------------------------ |
| **scoreRep** (logic)                       | SquatCam (main)  | Cosine similarity vs reference trace             |
| **scoreRepAgainstTargets** (repQuality.js) | scoreSessionReps | Target-based (depth, torso vs aggregate targets) |

- **scoreRep** is the primary path: shape-based comparison to reference.
- **repQuality** uses aggregate targets (e.g. knee_bottom, torso) for session-level scoring.
- They can coexist; SquatCam primarily uses scoreRep.

---

## 12. Design Decisions & Reasoning

| Decision                          | Why                                                     |
| --------------------------------- | ------------------------------------------------------- |
| **60 frames**                     | Match backend; fixed length for comparison              |
| **Phase-based resampling**        | Bottom at frame 30; handles asymmetric squat timing     |
| **Cosine similarity**             | Shape-based; less sensitive to scale                    |
| **Weights sum to 1**              | Weighted similarity stays in [0, 1]                     |
| **normaliseTrace for front only** | Front uses baseline-relative features; side uses angles |
| **minSim lower for front (0.3)**  | 2D projection more variable; cosine tends lower         |
| **detectFormIssues thresholds**   | Empirical; tuned for interpretable feedback             |
| **Valgus highest weight (front)** | ACL injury risk in women                                |

---

## 13. Tests

### 13.1 buildRepData.test.js

- `getTraceKeys`: returns correct keys for front/side; throws for unknown mode
- `detectBottom`: side uses min knee; front uses max depth; returns null for invalid
- `buildRepData`: resamples both to 60; uses phase-based when valid bottom; picks only specified keys; handles empty traces; default targetN 60

### 13.2 trajectory.test.js

- `resampleTraceByPhase`: bottom at frame 30; fallback when phases too short or bottom at edge

### 13.3 scoreRep.test.js

- `similarityToScore`: maps 1→100, minSim→0, clamps, custom minSim
- `detectFormIssues`: flags valgus, symmetry, depth (front); torso, knee (side) at thresholds
- `scoreRep`: integration (mocks cosineSimilarityByKey)

### 13.4 scoringWeights.test.js

- Keys match expected arrays
- Weights sum to 1
- All weights positive
- Weight for each key

---

## 14. Viva Q&A — Logic Layer

**Q: What does buildRepData do?**  
A: It takes raw user and reference traces (any length), picks the relevant keys for the mode, and resamples both to 60 frames. When a valid bottom is detected (side: min knee; front: max depth), it uses phase-based resampling so the bottom aligns at frame 30. Otherwise it falls back to linear resampling. Output is aligned traces ready for scoring.

**Q: Why phase-based resampling for the user trace?**  
A: The reference is already phase-aligned from the backend (bottom at frame 30). If the user has asymmetric timing (e.g. slow down, fast up), linear resampling would misalign their bottom with the reference. Phase-based resampling ensures both bottoms align at frame 30 for fair comparison.

**Q: Why 60 frames?**  
A: Matches the backend. Fixed length lets us compare rep shapes regardless of speed. Frame 0 = start, frame ~30 = bottom, frame 59 = end.

**Q: Why cosine similarity instead of Euclidean distance?**  
A: Cosine measures direction (shape), not magnitude. We care about movement pattern, not absolute angle values. Euclidean would penalise small scale differences.

**Q: Why normaliseTrace for front view only?**  
A: Front view uses baseline-relative features (symmetry, pelvic, depth). User and reference may have different baselines. Subtracting the first frame aligns both so we compare shape, not absolute position. Side view uses angles, which are already comparable.

**Q: Why different minSim for front (0.3) vs side (0.6)?**  
A: Front view uses 2D projection; cosine similarity tends to be lower due to camera angle sensitivity. Side view angles are more stable. So we use a lower threshold for front to avoid unfairly low scores.

**Q: How were the weights chosen?**  
A: Research-based: valgus and knee get highest weight due to injury risk and squat quality. Weights sum to 1 so the weighted similarity stays in [0, 1].

**Q: What's the difference between scoreRep and scoreRepAgainstTargets?**  
A: scoreRep uses cosine similarity vs a reference trace (shape-based). scoreRepAgainstTargets uses target values (e.g. knee_bottom, torso) from aggregate data. SquatCam mainly uses scoreRep.

**Q: What do the flags mean?**  
A: They're generated from per-key similarities. Low similarity for a key (e.g. valgus < 0.35) means that aspect of form differs from the reference, so we flag it for feedback.

---

## 15. Quick Reference

| Constant           | Value | Meaning                               |
| ------------------ | ----- | ------------------------------------- |
| targetN            | 60    | Frames per trace                      |
| minSim (side)      | 0.6   | Minimum similarity for non-zero score |
| minSim (front)     | 0.3   | Lower due to 2D sensitivity           |
| valgus threshold   | 0.35  | Flag "Knee valgus detected"           |
| symmetry threshold | 0.70  | Flag "Left–right imbalance"           |
| depth threshold    | 0.65  | Flag "Insufficient depth"             |
| torso threshold    | 0.70  | Flag "Excessive forward lean"         |
| knee threshold     | 0.75  | Flag "Poor knee tracking"             |

---

_End of Logic Layer Viva Prep_
