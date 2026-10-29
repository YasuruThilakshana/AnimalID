# AnimalID (React + Express + MySQL)

Pet registration, photo-scan identification, and a lost & found alerts hub.

- **Frontend:** React + Vite + Tailwind (`src/`) — talks to the API with axios.
- **Backend:** Express + Sequelize ORM over MySQL (`server/`, Controller–Model–Route layout).

## Prerequisites

- Node.js 18+
- A running MySQL server (e.g. `root` / `2001@yasuruM` locally)

## Backend setup (`server/`)

1. `cd server && npm install`
2. Copy `.env.example` to `.env` and check the credentials:
   `DB_HOST`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`, `PORT`.
3. `npm run dev` (or `npm start`)

On boot the server creates the database if missing and runs
`sequelize.sync({ alter: true })`, so all tables (`animals`, `users`,
`alert_subscriptions`) are created automatically — no SQL imports needed.

Uploaded pet photos are stored in `server/uploads/` and served at `/uploads/*`.

### Photo scan (Meta AI SAM 3.1)

`POST /api/animals/scan` accepts a multipart `photo` file plus optional
`species` / `markings` / `location` hints. The backend embeds the image with
the SAM 3.1 API (key in `SAM_API_KEY`, never exposed to the frontend), then
ranks every stored record with cosine similarity and returns the best match
with a similarity percentage. Without a key it uses a deterministic local
embedding so development still works.

### API endpoints

| Method | Path                     | Description                        |
| ------ | ------------------------ | ---------------------------------- |
| GET    | /api/health              | Health check                       |
| GET    | /api/animals             | List animals (`?q=&species=&status=&location=&owner=`) |
| GET    | /api/animals/:id         | Get one record                     |
| POST   | /api/animals             | Register (multipart photo angles)  |
| PUT    | /api/animals/:id         | Update a record                    |
| DELETE | /api/animals/:id         | Delete a record                    |
| POST   | /api/animals/:id/sightings | Report a sighting                |
| POST   | /api/animals/scan        | Photo search (multipart `photo`)   |
| POST   | /api/auth/register       | Create account (returns JWT)       |
| POST   | /api/auth/login          | Sign in (returns JWT)              |
| GET    | /api/auth/me             | Current user (Bearer token)        |
| POST   | /api/alerts/subscribe    | Area-alert signup                  |

New animals get an auto-generated tag number (`TAG-001-0001`, …) derived from
the auto-incremented primary key.

## Frontend setup (repo root)

1. `npm install`
2. Optionally copy `.env.example` to `.env` to point `VITE_API_URL` at a
   remote API (defaults to `/api`, proxied to `localhost:5000` in dev).
3. `npm run dev` (start the backend first)

## Project layout

```
src/            React frontend (pages, components, lib/store.jsx, lib/api.js)
server/src/
  server.js     Express app + automatic DB sync
  config/       Sequelize connection + DB auto-create
  models/       Animal (animals), User (users), AlertSubscription
  controllers/  Request handlers (animals, auth)
  routes/       /api/animals, /api/auth, /api/alerts
  services/     SAM 3.1 embedding client (+ local fallback)
  utils/        Cosine similarity
  middleware/   Multer image-upload handling
```
