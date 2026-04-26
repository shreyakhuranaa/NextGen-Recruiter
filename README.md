# NextGen-Recruiter

AI Interview Platform with separate Student and Recruiter dashboards.

## Stack

- Frontend: React + Vite + Tailwind CSS
- Backend: Flask + SQLAlchemy + JWT
- Database: PostgreSQL via `DATABASE_URL`
- Auth: JWT-based authentication

## Features

- Students can sign up, browse jobs, apply, take AI interviews, and track scores
- Recruiters can sign up, create jobs, review candidates, and inspect interview outcomes
- AI interview engine generates role-aware questions and returns structured scoring + feedback
- OpenAI-backed question/evaluation flow when `OPENAI_API_KEY` is set, with heuristic fallback for local development
- Rate-limited auth and interview endpoints for safer defaults
- Docker Compose stack for PostgreSQL + backend + frontend

## Project Structure

- `backend/`: Flask API, PostgreSQL models, JWT auth, recruiter/student endpoints
- `app.py`: the existing Streamlit interview application
- `frontend/`: React + Tailwind SPA for auth, student dashboard, and recruiter dashboard

## Local Backend Setup

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp backend/.env.example backend/.env
python3 backend/run.py
```

Set `DATABASE_URL` to PostgreSQL for production, for example:

```bash
export DATABASE_URL=postgresql://postgres:postgres@localhost:5432/nextgen_recruiter
```

Optional sample users:

```bash
python3 backend/seed.py
```

Sample credentials after seeding:

- Recruiter: `recruiter@nextgen.ai` / `password123`
- Student: `student@nextgen.ai` / `password123`

## Database Migrations

Flask-Migrate is wired in through [backend/manage.py](/Users/shreyakhurana/Downloads/NextGen-Recruiter/backend/manage.py).

Typical commands:

```bash
export FLASK_APP=backend/manage.py
flask db init
flask db migrate -m "initial schema"
flask db upgrade
```

## Frontend Setup

```bash
cd frontend
npm install
npm run dev
```

The Vite dev server proxies `/api` requests to `http://127.0.0.1:5000`.

For a separately hosted frontend build, set:

```bash
VITE_API_BASE_URL=http://localhost:5000/api
```

## Docker Stack

Run the full stack with PostgreSQL:

```bash
docker compose up --build
```

Services:

- Frontend: `http://localhost:8080`
- Backend API: `http://localhost:5000/api`
- PostgreSQL: `localhost:5432`

## OpenAI Integration

Set these in `backend/.env` to enable model-backed interviews:

```bash
OPENAI_API_KEY=your_key_here
OPENAI_MODEL=gpt-4o-mini
```

Implementation note: the backend uses the OpenAI Responses API with structured JSON output, following the official Responses and Structured Outputs docs.

## Verification

- Frontend build: `npm run build`
- Backend syntax check: `python3 -m compileall backend`
