#!/bin/sh
set -eu
# Initialization of a NEW volume only. Credentials stay out of CLI arguments/logs.
AIHUB_APP_PASSWORD=$(cat /run/secrets/app_db_password)
export AIHUB_APP_PASSWORD
psql --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" --set ON_ERROR_STOP=1 <<'SQL'
\getenv app_password AIHUB_APP_PASSWORD
CREATE ROLE aihub LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD :'app_password';
ALTER DATABASE aihub OWNER TO aihub;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
ALTER SCHEMA public OWNER TO aihub;
SQL
unset AIHUB_APP_PASSWORD
