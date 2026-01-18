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

def resample(traj, n= n_samples):
    """
    Resample trajectory to fixed length n using linear interpolation.
    """
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

            h, w, _ = frame.shape
            rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            res = pose.process(rgb)
            pose_landmarks = getattr(res, "pose_landmarks", None)
            if pose_landmarks is None:
                continue
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

    #smoothing
    for arr in (angles_hip, angles_knee, angles_ankle, angles_torso, hip_y):
        arr[:] = moving_average(arr)

    #rep detection
    s, b, e = detect_rep_from_hip_y(hip_y)

    #cut and resample
    def cut_and_resample(arr):
        return resample(arr[s:e+1], n_samples).tolist()

    template = {
        "file": path.name,
        "fps": fps,
        "rep_indices": {"start": int(s), "bottom": int(b), "end": int(e)},
        "trajectories": {
            "hip": cut_and_resample(angles_hip),
            "knee": cut_and_resample(angles_knee),
            "ankle": cut_and_resample(angles_ankle),
            "torso": cut_and_resample(angles_torso),
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

    #time series data for frontal plane features
    hip_y_centre = []
    valgus = []
    symmetry = []
    pelvic_drop = []
    depth_proxy = []

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

            h, w, _ = frame.shape
            rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            res = pose.process(rgb)
            pose_landmarks = getattr(res, "pose_landmarks", None)
            if pose_landmarks is None:
                continue
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

    #smooth signals
    for arr in (hip_y_centre, valgus, symmetry, pelvic_drop, depth_proxy):
        arr[:] = moving_average(arr)

    #rep detection
    s, b, e = detect_rep_from_hip_y(hip_y_centre)

    #cut and resample
    def cut_and_resample(arr):
        return resample(arr[s:e+1], n_samples).tolist()

    template = {
        "file": path.name,
        "fps": fps,
        "rep_indices": {"start": int(s), "bottom": int(b), "end": int(e)},
        "trajectories": {
            "valgus": cut_and_resample(valgus),
            "symmetry": cut_and_resample(symmetry),
            "pelvic": cut_and_resample(pelvic_drop),
            "depth": cut_and_resample(depth_proxy),
        },
    }
    return template

#Run both processors and save template json
def main():
    front_path = ref_directory / "front_view.mp4"
    side_path = ref_directory / "side_view.mp4"

    front_template = process_video_front(front_path)
    side_template = process_video_side(side_path)

    #save to json
    data = {"front": front_template, "side": side_template}
    output_json.write_text(json.dumps(data, indent=2))
    print(f"Saved templates to {output_json }")

if __name__ == "__main__":
    main()