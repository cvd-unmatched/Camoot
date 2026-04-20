# Camoot

Live quiz app inspired by Kahoot, with host/player realtime gameplay over Socket.IO.

## Features

- Create quizzes in the manager UI (`/create`)
- Host live sessions with join PINs and QR code (`/host`)
- Players join on mobile/desktop (`/play`)
- Admin page for active sessions (`/admin`)
- Multiple question types:
  - Multiple choice (single/multi-select)
  - Slider
  - Click location (with pinch/drag zoom on mobile)
  - Order
  - Match pairs
  - Odd color out

## Tech stack

- Frontend: React + TypeScript + Vite
- Backend: Node.js + Express + Socket.IO
- Storage: local JSON files in `data/`

## Quick start

### 1) Install

```bash
npm install
```

### 2) Configure env

```bash
cp .env.example .env
```

On Windows PowerShell:

```powershell
Copy-Item .env.example .env
```

### 3) Run in dev mode

```bash
npm run dev
```

- Client: Vite dev server
- Server: `server/index.js`

## Scripts

- `npm run dev` - run client + server together
- `npm run dev:client` - run Vite only
- `npm run dev:server` - run Node server only
- `npm run build` - build frontend
- `npm run preview` - preview frontend build
- `npm run start` - run server in production mode

## Environment variables

See `.env.example`.

- `PORT` - server port (default `3001`)
- `MANAGER_PASSWORD` - password for manager login
- `JOIN_BASE_URL` - base URL used in join QR codes (optional)
- `LOGGING` - enable general logs (`1`/`0`)
- `CAMOOT_PLAYER_DEBUG` - enable verbose player answer logs (`1`/`0`)

## Docker

Build:

```bash
docker build -t camoot-live .
```

Run:

```bash
docker run --rm -p 3001:3001 --env-file .env camoot-live
```

## Release flow

- Use `release.ps1` (Windows) or `release.sh` (Unix)
- Fill `RELEASE_NOTES.md` before running a release
- Script bumps version, tags, pushes, and then resets `RELEASE_NOTES.md` template

## Project routes

- `/` - home
- `/create` - quiz manager
- `/host` - host/live control
- `/play` - player join/gameplay
- `/admin` - live session admin
