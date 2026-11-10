#!/bin/sh
# Hands the bind-mounted /backups folder to the dfa user, then drops root.
set -eu
if [ "$(id -u)" = 0 ]; then
  mkdir -p /backups
  chown dfa:dfa /backups
  exec su-exec dfa:dfa "$0" "$@"
fi
exec "$@"
