#!/bin/sh
# Local Ubuntu Docker CE only; never inherit a remote daemon or TLS context.
set -eu
unset DOCKER_HOST DOCKER_CONTEXT DOCKER_TLS_VERIFY DOCKER_CERT_PATH
for task_argument in "$@"; do
  case "$task_argument" in
    -H|-H?*|--host|--host=*|--context|--context=*)
      echo 'Docker daemon overrides are not permitted by this wrapper.' >&2
      exit 1 ;;
  esac
done
exec docker --host unix:///var/run/docker.sock "$@"
