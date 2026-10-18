#!/bin/sh
# Ubuntu Docker CE only. File-based inputs cannot be shadowed by exported shell
# variables, another Compose file/profile/project, or a remote Docker context.
# This wrapper does not grant permission to migrate or open the public profile.
set -eu
task_project_dir=$(CDPATH= cd -P "$(dirname "$0")/.." && pwd)
cd "$task_project_dir"
test -f .env.production || { echo 'Explicit production Compose inputs are missing.' >&2; exit 1; }
unset SITE_DOMAIN API_DOMAIN ACME_EMAIL APP_IMAGE TOOLS_IMAGE CADDY_IMAGE \
  APP_SECRET_FILE DB_PASSWORD_FILE APP_DB_PASSWORD_FILE REDIS_PASSWORD_FILE PAYMENT_KEYS_DIR \
  COMPOSE_FILE COMPOSE_PROJECT_NAME COMPOSE_PROFILES COMPOSE_ENV_FILES COMPOSE_DISABLE_ENV_FILE \
  COMPOSE_REMOVE_ORPHANS DOCKER_HOST DOCKER_CONTEXT DOCKER_TLS_VERIFY DOCKER_CERT_PATH
for task_argument in "$@"; do
  case "$task_argument" in
    -f|--file|--file=*|-f?*|-p|--project-name|--project-name=*|-p?*|--project-directory|--project-directory=*|--env-file|--env-file=*)
      echo 'Production file, project and input overrides are not permitted by this wrapper.' >&2
      exit 1 ;;
  esac
done
exec sh "$task_project_dir/deploy/docker-production.sh" compose \
  --project-directory "$task_project_dir" --project-name aihub \
  --env-file "$task_project_dir/.env.production" --file "$task_project_dir/compose.yaml" "$@"
