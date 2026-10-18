#!/bin/sh
set -eu
# Disposable --network none container only; no real secret/DB/host data mounts.
mkdir -p /opt/aihub /tmp/backup-target
ln -s /tmp/backup-target /opt/aihub/backups
head -c 32 /dev/urandom > /tmp/backup-target/backup.key
chmod 600 /tmp/backup-target/backup.key
if BACKUP_KEY_FILE=/tmp/backup-target/backup.key sh /tested-backup.sh 2>/tmp/guard-error; then
  echo 'FAIL co-located key accepted' >&2; exit 1
fi
grep -q 'Backup key must be separate' /tmp/guard-error
echo 'PASS symlinked backup directory cannot contain its encryption key'
if env -u BACKUP_KEY_FILE sh /tested-backup.sh 2>/tmp/guard-error; then
  echo 'FAIL missing key accepted' >&2; exit 1
fi
grep -q 'Set BACKUP_KEY_FILE' /tmp/guard-error
echo 'PASS missing key fails closed before dump/encryption'
sh -n /tested-backup.sh
