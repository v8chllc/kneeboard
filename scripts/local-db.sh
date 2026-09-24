#!/bin/sh
set -eu

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
    DATABASE_URL="postgresql://kneeboard:local_only_kneeboard@127.0.0.1:54329/$database" \
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
