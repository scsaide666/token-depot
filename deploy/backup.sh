#!/bin/sh
set -eu
umask 077
unset DOCKER_HOST DOCKER_CONTEXT DOCKER_TLS_VERIFY DOCKER_CERT_PATH
cd /opt/aihub
mkdir -p backups
chmod 700 backups
backup_dir=$(readlink -f backups)
# Fail closed instead of silently storing a new plaintext backup. Provision a
# separate 32-byte CSPRNG key, owned/readable only by the backup operator. Keep
# its independently protected recovery copy outside the backup destination.
key_file=${BACKUP_KEY_FILE:?Set BACKUP_KEY_FILE to a protected binary 32-byte key file}
key_file=$(readlink -f "$key_file")
case "$key_file" in "$backup_dir"|"$backup_dir"/*) echo 'Backup key must be separate from backups.' >&2; exit 1 ;; esac
test -f "$key_file"
test "$(wc -c < "$key_file")" -eq 32
case "$(stat -c %a "$key_file")" in 400|600) ;; *) echo 'Backup key permissions must be 400 or 600.' >&2; exit 1 ;; esac
test "$(stat -c %u "$key_file")" -eq "$(id -u)"
# Reuse the installed, reviewed recovery image; never pull an unpinned image.
crypto_image=$(sh deploy/compose-production.sh images -q recovery)
test -n "$crypto_image"
stamp=$(date -u +%Y%m%dT%H%M%SZ)
file="backups/aihub-$stamp-$$.dump.enc"
tmp=$(mktemp "backups/.aihub-$stamp.XXXXXX.tmp")
trap 'rm -f "$tmp"' 0
sh deploy/compose-production.sh exec -T postgres pg_dump -U aihub_admin -d aihub -Fc > "$tmp"
# Check the custom-format archive before encryption. Plaintext staging is short
# lived under mode-700 backups; the trap removes it on success or failure.
sh deploy/compose-production.sh exec -T postgres pg_restore --list < "$tmp" > /dev/null
sh deploy/docker-production.sh run --rm --pull never --network none --read-only --cap-drop ALL --security-opt no-new-privileges \
  --user "$(id -u):$(id -g)" \
  --mount "type=bind,src=/opt/aihub/deploy/backup-crypto.mjs,dst=/backup-crypto.mjs,readonly" \
  --mount "type=bind,src=$backup_dir,dst=/backup" \
  --mount "type=bind,src=$key_file,dst=/run/backup-key,readonly" \
  --entrypoint node "$crypto_image" /backup-crypto.mjs encrypt \
  "/backup/$(basename "$tmp")" "/backup/$(basename "$file")" /run/backup-key
sha256sum "$file" > "$file.sha256"
# Legacy plaintext archives are NOT automatically deleted. After verifying an
# encrypted replacement and offsite recovery, operators can retire them safely.
find "$backup_dir" -maxdepth 1 -type f \( -name 'aihub-*.dump.enc' -o -name 'aihub-*.dump.enc.sha256' \) -mtime +14 -delete
