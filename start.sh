#!/bin/zsh
# Start Onboarding Hub locally: Postgres (Docker) + Next.js dev server on http://localhost:3000
set -e
cd "$(dirname "$0")"

# 1. Make sure Docker Desktop is running
if ! docker info >/dev/null 2>&1; then
  echo "Starting Docker Desktop..."
  open -a Docker
  until docker info >/dev/null 2>&1; do sleep 2; done
fi

# 2. Start the database and wait until it accepts connections
docker compose up -d db
until docker compose exec -T db pg_isready -U onboarding >/dev/null 2>&1; do sleep 1; done

# 3. Install deps / apply migrations (fast no-ops when nothing changed)
[ -d node_modules ] || npm install
npm run db:migrate

# 4. Run the app
npm run dev
