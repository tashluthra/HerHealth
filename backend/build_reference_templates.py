import json
import cv2 
import numpy as np 
import mediapipe as mp
from mediapipe.python.solutions.pose import Pose, PoseLandmark
from pathlib import Path

#config
ref_directory = Path("../frontend/public/reference")  
output_json = ref_directory / "reference_clips.json"
#number of samples per rep trajectory
#creates a fixed reference length regardless of rep speed
n_samples = 60  #30 down, 30 up per rep

#helpers for signal processing- smoothing and resampling
def moving_average(x, k=5):
    "Basic smoothing to reduce frame-to-frame noise."
    if len(x) < k:
        return x
    kernel = np.ones(k) / k
    return np.convolve(x, kernel, mode="same")

def angle(a, b, c):
    """
    Angle at point b given three 2D points (in degrees).
    """
    a, b, c = np.array(a), np.array(b), np.array(c)
    ba = a - b
    bc = c - b
    cosang = np.dot(ba, bc) / (np.linalg.norm(ba) * np.linalg.norm(bc) + 1e-8)
    cosang = np.clip(cosang, -1.0, 1.0)
    return np.degrees(np.arccos(cosang))

def torso_angle(hip, shoulder):
    """
    Torso forward-lean relative to vertical (in degrees).
    0 = upright, positive = leaning forward.
    Used in side-view algorithm only.
    """
    hip = np.array(hip)
    shoulder = np.array(shoulder)
    vec = shoulder - hip
    # vertical vector (pointing up)
    v = np.array([0, -1])
    cosang = np.dot(vec, v) / (np.linalg.norm(vec) * np.linalg.norm(v) + 1e-8)
    cosang = np.clip(cosang, -1.0, 1.0)
    return np.degrees(np.arccos(cosang))

def resample(traj, n=n_samples):
    """
    Resample trajectory to fixed length n using linear interpolation.
    Safe for very short trajectories.
    """
    traj = np.array(traj, dtype=float)
    if len(traj) == 0:
        return np.zeros(n)
    if len(traj) == 1:
        return np.full(n, traj[0])
    x = np.linspace(0, 1, len(traj))
    xi = np.linspace(0, 1, n)
    return np.interp(xi, x, traj)



def detect_rep_from_hip_y(hip_y):
    """ 
    Simple rep detection from hip vertical motion.
    - find bottom of squat (max hip_y)
    - find start/end using local minima before/after bottom
    Returns (start_idx, bottom_idx, end_idx)
    """
    y = np.array(hip_y)
    y_smooth = moving_average(y, k=7)

    #bottom = global max (hip goes down in image coordinates)
    bottom_idx = int(np.argmax(y_smooth))

    #start = last local minimum before bottom
    start_idx = np.argmin(y_smooth[:bottom_idx+1])

    #end = first local minimum after bottom
    after = y_smooth[bottom_idx:]
    end_local = np.argmin(after)
    end_idx = bottom_idx + int(end_local)

    #basic sanity
    if end_idx <= start_idx:
        start_idx = 0
        end_idx = len(y_smooth) - 1

    return start_idx, bottom_idx, end_idx

#SIDE-VIEW PROCESSING (sagittal biomechanics)

def process_video_side(path: Path):
    """
    Extract hip/knee/ankle angles and torso lean
    """
    cap = cv2.VideoCapture(str(path))
    fps = cap.get(cv2.CAP_PROP_FPS)
    total_frames = 0
    valid_frames = 0


    #time series data
    hip_y = []
    angles_hip = []
    angles_knee = []
    angles_ankle = []
    angles_torso = []

    with Pose(static_image_mode=False,
              model_complexity=1,
              enable_segmentation=False) as pose:
        while True:
            ok, frame = cap.read()
            if not ok:
                break
            
            total_frames += 1

            h, w, _ = frame.shape
            rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            res = pose.process(rgb)
            pose_landmarks = getattr(res, "pose_landmarks", None)
            if pose_landmarks is None:
                continue
            valid_frames += 1
            lm = pose_landmarks.landmark

            def xy(i):
                return lm[i].x * w, lm[i].y * h

            #extract joints
            hip = xy(PoseLandmark.RIGHT_HIP)
            knee = xy(PoseLandmark.RIGHT_KNEE)
            ankle = xy(PoseLandmark.RIGHT_ANKLE)
            shoulder = xy(PoseLandmark.RIGHT_SHOULDER)

            toe = xy(PoseLandmark.RIGHT_FOOT_INDEX)

            hip_y.append(hip[1])

            hip_ang = angle(shoulder, hip, knee)         # hip flexion-ish
            knee_ang = angle(hip, knee, ankle)           # knee flexion
            ankle_ang = angle(knee, ankle, toe)          # DF
            torso_ang = torso_angle(hip, shoulder)       # forward lean

            #compute biomechanical angles
            angles_hip.append(hip_ang)
            angles_knee.append(knee_ang)
            angles_ankle.append(ankle_ang)
            angles_torso.append(torso_ang)

    cap.release()

    # --- quality gating ---
    if total_frames == 0:
        print(f"[side] {path.name}: no frames read")
        return None

    if valid_frames < 60:
        print(f"[side] {path.name}: too few valid frames ({valid_frames}/{total_frames})")
        return None

    detection_rate = valid_frames / total_frames
    if detection_rate < 0.6:
        print(f"[side] {path.name}: low detection rate ({valid_frames}/{total_frames})")
        return None


    #smoothing
    for arr in (angles_hip, angles_knee, angles_ankle, angles_torso, hip_y):
        arr[:] = moving_average(arr)

    #rep detection
    s, b, e = detect_rep_from_hip_y(hip_y)
    if (e - s) < 20:
        print(f"[side] {path.name}: rep segment too short ({e - s} frames)")
        return None
    if b <= s + 3 or b >= e - 3:
        print(f"[side] {path.name}: bottom too close to edge")
        return None



    #cut and resample
    def cut_and_resample(arr):
        return resample(arr[s:e+1], n_samples).tolist()

    template = {
        "file": path.name,
        "fps": fps,
        "view": "side",
        "rep_indices": {"start": int(s), "bottom": int(b), "end": int(e)},
        "trajectories": {
            "hip": cut_and_resample(angles_hip),
            "knee": cut_and_resample(angles_knee),
            "ankle": cut_and_resample(angles_ankle),
            "torso": cut_and_resample(angles_torso),
        },
        "quality": {
            "total_frames": int(total_frames),
            "valid_frames": int(valid_frames),
            "detection_rate": float(valid_frames / max(1, total_frames)),
        },

    }
    return template

#FRONT-VIEW PROCESSING (frontal biomechanics)
def process_video_front(path: Path):
    """
    Builds front-view template. For now we keep it simple:
    - valgus index per frame
    - symmetry index (left vs right knee x)
    - pelvic drop (hip y diff)
    - depth proxy (hip centre y)
    """
    cap = cv2.VideoCapture(str(path))
    fps = cap.get(cv2.CAP_PROP_FPS)
    total_frames = 0
    valid_frames = 0


    #time series data for frontal plane features
    hip_y_centre = []
    valgus = []
    symmetry = []
    pelvic_drop = []
    depth_proxy = []

    #baseline symmetry at the start of the rep (first valid frame)
    baseline_sym = None


    with Pose(static_image_mode=False,
              model_complexity=1,
              enable_segmentation=False) as pose:
        while True:
            ok, frame = cap.read()
            if not ok:
                break
            
            total_frames += 1

            h, w, _ = frame.shape
            rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            res = pose.process(rgb)
            pose_landmarks = getattr(res, "pose_landmarks", None)
            if pose_landmarks is None:
                continue
            valid_frames += 1
            lm = pose_landmarks.landmark

            def xy(i):
                return lm[i].x * w, lm[i].y * h

            #extract knee, hips, ankles, shoulders (key points for frontal biomechanics)
            lh, rh = xy(PoseLandmark.LEFT_HIP), xy(PoseLandmark.RIGHT_HIP)
            lk, rk = xy(PoseLandmark.LEFT_KNEE), xy(PoseLandmark.RIGHT_KNEE)
            la, ra = xy(PoseLandmark.LEFT_ANKLE), xy(PoseLandmark.RIGHT_ANKLE)
            ls, rs = xy(PoseLandmark.LEFT_SHOULDER), xy(PoseLandmark.RIGHT_SHOULDER)

            hip_centre = ((lh[0] + rh[0]) / 2, (lh[1] + rh[1]) / 2)
            shoulder_centre = ((ls[0] + rs[0]) / 2, (ls[1] + rs[1]) / 2)

            hip_y_centre.append(hip_centre[1])

            #knee valgus index: normalised knee x relative to ankle x
            stance_width = abs(la[0] - ra[0]) + 1e-6
            left_valgus = (lk[0] - la[0]) / stance_width
            right_valgus = (rk[0] - ra[0]) / stance_width
            valgus.append((left_valgus + right_valgus) / 2)

            #left-right symmetry: normalised knee x difference relative to hip width
            hip_width = abs(lh[0] - rh[0]) + 1e-6
            raw_sym = (lk[0] - rk[0]) / hip_width
            
            #on the first valid frame, capture the baseline stance asymmetry.
            #after that, measure change relative to baseline.
            if baseline_sym is None:
                baseline_sym = raw_sym

            symmetry.append(raw_sym - baseline_sym)


            #pelvic drop: hip y difference
            pelvic_drop.append((lh[1] - rh[1]) / h)

            #depth proxy: hip vertical motion (normalised)
            depth_proxy.append(hip_centre[1] / h)

    cap.release()

    # --- quality gating ---
    if total_frames == 0:
        print(f"[front] {path.name}: no frames read")
        return None

    if valid_frames < 60:
        print(f"[front] {path.name}: too few valid frames ({valid_frames}/{total_frames})")
        return None

    detection_rate = valid_frames / total_frames
    if detection_rate < 0.6:
        print(f"[front] {path.name}: low detection rate ({valid_frames}/{total_frames})")
        return None


    #smooth signals
    for arr in (hip_y_centre, valgus, symmetry, pelvic_drop, depth_proxy):
        arr[:] = moving_average(arr)

    #rep detection
    s, b, e = detect_rep_from_hip_y(hip_y_centre)
    if (e - s) < 20:
        print(f"[front] {path.name}: rep segment too short ({e - s} frames)")
        return None
    if b <= s + 3 or b >= e - 3:
        print(f"[front] {path.name}: bottom too close to edge")
        return None



    #cut and resample
    def cut_and_resample(arr):
        return resample(arr[s:e+1], n_samples).tolist()

    template = {
        "file": path.name,
        "fps": fps,
        "view": "front", 
        "rep_indices": {"start": int(s), "bottom": int(b), "end": int(e)},
        "trajectories": {
            "valgus": cut_and_resample(valgus),
            "symmetry": cut_and_resample(symmetry),
            "pelvic": cut_and_resample(pelvic_drop),
            "depth": cut_and_resample(depth_proxy),
        },
        "quality": {
            "total_frames": int(total_frames),
            "valid_frames": int(valid_frames),
            "detection_rate": float(valid_frames / max(1, total_frames)),
        },

    }
    return template

def process_directory(view_dir: Path, view: str):
    """
    Process all mp4 clips in a directory and return list of per-clip templates.
    view must be "front" or "side".
    """
    templates = []
    for path in sorted(view_dir.glob("*.mp4")):
        try:
            if view == "front":
                t = process_video_front(path)
            else:
                t = process_video_side(path)

            # skip failed / low-quality clips (process_* will return None if we add gating)
            if t is not None:
                templates.append(t)

        except Exception as e:
            print(f"Skipping {path.name} due to error: {e}")
    return templates

def distance_to_centre(template, centre):
    """
    Mean absolute error between template trajectories and centre trajectories
    across all keys and timesteps.
    """
    keys = centre.keys()
    total = 0.0
    count = 0
    for k in keys:
        a = np.array(template["trajectories"][k], dtype=float)
        b = np.array(centre[k], dtype=float)
        m = min(len(a), len(b))
        total += np.mean(np.abs(a[:m] - b[:m]))
        count += 1
    return total / max(1, count)

def aggregate_templates(templates, drop_worst_pct=0.2, use_median=True):
    """
    Create robust aggregate template + spread band from per-clip templates.
    Returns dict with centre/spread + kept/dropped lists.
    """
    if len(templates) == 0:
        return None
    
    if len(templates) < 5:
        drop_worst_pct = 0.0

    keys = list(templates[0]["trajectories"].keys())
    T = len(templates[0]["trajectories"][keys[0]])

    # stack: (num_clips, T) per key
    stack = {k: np.array([t["trajectories"][k] for t in templates], dtype=float) for k in keys}

    # preliminary centre
    if use_median:
        centre0 = {k: np.median(stack[k], axis=0) for k in keys}
    else:
        centre0 = {k: np.mean(stack[k], axis=0) for k in keys}

    # distances + drop worst %
    dists = [(t["file"], distance_to_centre(t, centre0)) for t in templates]
    dists_sorted = sorted(dists, key=lambda x: x[1])

    keep_n = max(1, int(round(len(templates) * (1 - drop_worst_pct))))
    kept_files = set([f for f, _ in dists_sorted[:keep_n]])
    dropped_files = [f for f, _ in dists_sorted[keep_n:]]

    kept = [t for t in templates if t["file"] in kept_files]

    # recompute final centre/spread on kept
    stack2 = {k: np.array([t["trajectories"][k] for t in kept], dtype=float) for k in keys}

    if use_median:
        centre = {k: np.median(stack2[k], axis=0) for k in keys}
        spread = {k: np.median(np.abs(stack2[k] - centre[k]), axis=0) for k in keys}  # MAD per timestep
        spread_name = "mad"
    else:
        centre = {k: np.mean(stack2[k], axis=0) for k in keys}
        spread = {k: np.std(stack2[k], axis=0) for k in keys}
        spread_name = "std"

    return {
        "keys": keys,
        "n_samples": int(T),
        "centre": {k: centre[k].tolist() for k in keys},
        "spread": {k: spread[k].tolist() for k in keys},
        "spread_type": spread_name,
        "kept": sorted(list(kept_files)),
        "dropped": dropped_files,
        "distances": [{"file": f, "distance": float(d)} for f, d in dists_sorted],
    }


#Run both processors and save template json
def main():
    front_dir = ref_directory / "front"
    side_dir = ref_directory / "side"

    front_templates = process_directory(front_dir, "front")
    side_templates = process_directory(side_dir, "side")

    if len(front_templates) == 0:
        raise RuntimeError("No valid front-view templates produced.")
    if len(side_templates) == 0:
        raise RuntimeError("No valid side-view templates produced.")

    front_agg = aggregate_templates(front_templates, drop_worst_pct=0.2, use_median=True)
    side_agg = aggregate_templates(side_templates, drop_worst_pct=0.2, use_median=True)

    data = {
        "created_at": __import__("datetime").datetime.utcnow().isoformat() + "Z",
        "front": {
            "clips": front_templates,
            "aggregate": front_agg,
        },
        "side": {
            "clips": side_templates,
            "aggregate": side_agg,
        },
    }

    output_json.write_text(json.dumps(data, indent=2))
    print(f"Saved templates to {output_json}")


if __name__ == "__main__":
    main()