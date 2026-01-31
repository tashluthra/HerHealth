# HerHealth

3rd Year Project focusing on women's health – camera-based squat analysis with pose detection and form feedback.

## Dev Quickstart

### Frontend (main app)

- `cd frontend && npm install && npm run dev`
- Visit `http://localhost:5173` – squat analysis with live camera, rep counting, ROM calibration, and form feedback

### Tests

- `cd frontend && npm run test` – runs Vitest unit tests

### Backend (reference data only)

- `cd backend` – contains `build_reference_templates.py` for processing videos into reference trajectories
- No API server; the frontend runs standalone with MediaPipe pose detection
