#!/bin/sh
set -eu

case "${1:-}" in
  start)
    docker compose up -d --wait postgres
    ;;
  stop)
    docker compose stop postgres
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
    echo 'Usage: scripts/local-db.sh start|stop|reset dev|test' >&2
    exit 2
    ;;
esac
