#!/bin/sh
# Run only in the disposable no-network Linux audit container. No Docker socket.
set -eu
task_fixture=$(mktemp -d /tmp/td-deploy-wrapper.XXXXXX)
trap 'rm -rf "$task_fixture"' 0
mkdir -p "$task_fixture/deploy" "$task_fixture/bin"
cp /tested-compose.sh "$task_fixture/deploy/compose-production.sh"
cp /tested-docker.sh "$task_fixture/deploy/docker-production.sh"
printf '# Non-secret fixture only\n' > "$task_fixture/.env.production"
printf 'services: {}\n' > "$task_fixture/compose.yaml"
cat > "$task_fixture/bin/docker" <<'STUB'
#!/bin/sh
set -eu
test "${SITE_DOMAIN+x}${API_DOMAIN+x}${ACME_EMAIL+x}${APP_IMAGE+x}${TOOLS_IMAGE+x}${CADDY_IMAGE+x}${APP_SECRET_FILE+x}${DB_PASSWORD_FILE+x}${APP_DB_PASSWORD_FILE+x}${REDIS_PASSWORD_FILE+x}${PAYMENT_KEYS_DIR+x}${COMPOSE_FILE+x}${COMPOSE_PROFILES+x}${COMPOSE_PROJECT_NAME+x}${COMPOSE_ENV_FILES+x}${COMPOSE_REMOVE_ORPHANS+x}${DOCKER_HOST+x}${DOCKER_CONTEXT+x}${DOCKER_TLS_VERIFY+x}${DOCKER_CERT_PATH+x}" = ''
printf '%s\n' "$@" > "$TEST_CAPTURE_FILE"
STUB
chmod 700 "$task_fixture/bin/docker"
export PATH="$task_fixture/bin:$PATH" TEST_CAPTURE_FILE="$task_fixture/args"
export SITE_DOMAIN=fixture-sentinel API_DOMAIN=fixture-sentinel ACME_EMAIL=fixture-sentinel
export APP_IMAGE=fixture-sentinel TOOLS_IMAGE=fixture-sentinel CADDY_IMAGE=fixture-sentinel
export APP_SECRET_FILE=fixture-sentinel DB_PASSWORD_FILE=fixture-sentinel APP_DB_PASSWORD_FILE=fixture-sentinel REDIS_PASSWORD_FILE=fixture-sentinel PAYMENT_KEYS_DIR=fixture-sentinel
export COMPOSE_FILE=fixture-sentinel COMPOSE_PROFILES=public COMPOSE_PROJECT_NAME=foreign COMPOSE_ENV_FILES=fixture-sentinel COMPOSE_REMOVE_ORPHANS=1
export DOCKER_HOST=ssh://not-contacted DOCKER_CONTEXT=foreign DOCKER_TLS_VERIFY=1 DOCKER_CERT_PATH=fixture-sentinel
sh "$task_fixture/deploy/compose-production.sh" config --quiet
grep -qx 'unix:///var/run/docker.sock' "$TEST_CAPTURE_FILE"
grep -qx "$task_fixture/.env.production" "$TEST_CAPTURE_FILE"
grep -qx "$task_fixture/compose.yaml" "$TEST_CAPTURE_FILE"
grep -qx aihub "$TEST_CAPTURE_FILE"
if grep -q 'fixture-sentinel\|foreign\|public\|ssh://' "$TEST_CAPTURE_FILE"; then exit 1; fi
echo 'PASS inherited Compose inputs/profiles/remote contexts cannot replace explicit local production configuration'
for task_override in --file=/not-read --env-file=/not-read --project-name=foreign --project-directory=/not-read; do
  if sh "$task_fixture/deploy/compose-production.sh" "$task_override" config > /dev/null 2>&1; then exit 1; fi
done
echo 'PASS file/project/input override arguments are rejected'
for task_override in --host=ssh://not-contacted --context=foreign; do
  if sh "$task_fixture/deploy/docker-production.sh" "$task_override" version > /dev/null 2>&1; then exit 1; fi
done
echo 'PASS standalone Docker daemon overrides are rejected'
rm "$task_fixture/.env.production"
if sh "$task_fixture/deploy/compose-production.sh" config > /dev/null 2>&1; then exit 1; fi
echo 'PASS missing production configuration fails before invoking the Docker stub'
sh -n /tested-compose.sh
sh -n /tested-docker.sh
