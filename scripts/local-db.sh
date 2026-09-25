#!/bin/sh
set -eu

local_port="${KNEEBOARD_DB_PORT:-54329}"
case "$local_port" in
  ''|*[!0-9]*|??????*) echo 'KNEEBOARD_DB_PORT must be a local TCP port from 1024 to 65535' >&2; exit 2 ;;
esac
if [ "$local_port" -lt 1024 ] || [ "$local_port" -gt 65535 ]; then
  echo 'KNEEBOARD_DB_PORT must be a local TCP port from 1024 to 65535' >&2
  exit 2
fi

case "${DOCKER_HOST:-}" in
  ''|unix://*|npipe://*) ;;
  *) echo 'Local database commands require a local Docker socket' >&2; exit 2 ;;
esac
docker_context_host="$(docker context inspect --format '{{.Endpoints.docker.Host}}')"
case "$docker_context_host" in
  unix://*|npipe://*) ;;
  *) echo 'Local database commands require a local Docker socket' >&2; exit 2 ;;
esac

case "${1:-}" in
  start)
    docker compose up -d --wait postgres
    ;;
  stop)
    docker compose stop postgres
    ;;
  migrate)
    case "${2:-}" in
      dev) database=kneeboard_dev ;;
      test) database=kneeboard_test ;;
      *) echo 'Usage: scripts/local-db.sh migrate dev|test' >&2; exit 2 ;;
    esac
    DATABASE_URL="postgresql://kneeboard:local_only_kneeboard@127.0.0.1:$local_port/$database" \
      mise exec -- pnpm db:migrate
    ;;
  verify)
    case "${2:-}" in
      dev) database=kneeboard_dev ;;
      test) database=kneeboard_test ;;
      *) echo 'Usage: scripts/local-db.sh verify dev|test' >&2; exit 2 ;;
    esac
    docker compose exec -T postgres psql -v ON_ERROR_STOP=1 -U kneeboard -d "$database" \
      < scripts/verify-local-schema.sql
    ;;
  reset)
    database="${2:-}"
    case "$database" in
      dev) database=kneeboard_dev ;;
      test) database=kneeboard_test ;;
      *) echo 'Usage: scripts/local-db.sh reset dev|test' >&2; exit 2 ;;
    esac
    docker compose exec -T postgres psql -v ON_ERROR_STOP=1 -U kneeboard -d postgres \
      -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '$database' AND pid <> pg_backend_pid()" \
      -c "DROP DATABASE \"$database\"" \
      -c "CREATE DATABASE \"$database\""
    ;;
  *)
    echo 'Usage: scripts/local-db.sh start|stop|migrate dev|test|verify dev|test|reset dev|test' >&2
    exit 2
    ;;
esac
