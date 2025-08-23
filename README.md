# HerHealth

3rd Year Project focuisng on women's health

## HerHealth — Dev Quickstart

### Backend (Docker)

- `docker compose up -d`
- Test: `curl http://localhost:8000/ping` → `{"status":"ok","env":"local"}`

### Frontend

- `cd frontend && npm install && npm run dev`
- Visit `http://localhost:5173` (shows /ping result)

### Cloud

- API: `https://herhealth-api.onrender.com/ping`
- Frontend `.env`: `VITE_API_URL=https://herhealth-api.onrender.com`
