#!/usr/bin/env bash
set -euo pipefail
# Hold a kernel lock for the full release and recovery sequence. A maintenance
# marker alone is not a mutex: two operators must never restore each other's DB.
exec 9</srv/miova
flock -n 9 || { echo "Another deployment is running." >&2; exit 1; }
release_commit=${1:?commit required}
[[ "$release_commit" =~ ^[0-9a-f]{40}$ ]]
release="/srv/miova/releases/${release_commit}"
previous=$(readlink -f /srv/miova/current)
[[ "$previous" =~ ^/srv/miova/releases/[0-9a-f]{40}$ ]]
test -d "$release" && test "$(readlink -f "$release")" = "$release"
test -d "$previous" && test "$previous" != "$release"
test -f "$release/web/dist-node/server/index.js"
test -f "$release/backend/backend_web/dist-node/server/index.js"
lock=/srv/miova/data/deployment.lock
test ! -e "$lock" && test ! -L "$lock"
backup_file=""
rollback() {
  trap - ERR HUP INT TERM
  sudo -n systemctl stop miova-web.service miova-admin.service
  if test -n "$backup_file"; then
    # New services have been read-only throughout validation: no accepted order
    # or operator mutation can be lost when restoring the pre-upgrade snapshot.
    sudo -n -u miova node "$release/scripts/selfhost/backup.mjs" --database /srv/miova/data/commerce.sqlite --directory /srv/miova/data/backups
    sudo -n -u miova node "$release/scripts/selfhost/restore-upgrade-backup.mjs" "$backup_file"
  fi
  rollback_link="/srv/miova/rollback-${release_commit}"
  test ! -e "$rollback_link" && test ! -L "$rollback_link"
  sudo -n ln -s "$previous" "$rollback_link"
  sudo -n mv -Tf "$rollback_link" /srv/miova/current
  sudo -n rm -f -- /srv/miova/data/deployment.lock
  sudo -n systemctl start miova-web.service miova-admin.service
  echo "UPGRADE_FAILED_ROLLED_BACK=$previous" >&2
  exit 1
}
trap rollback ERR HUP INT TERM
sudo -n install -o root -g root -m 600 /dev/null "$lock"
sudo -n systemctl stop miova-web.service miova-admin.service
backup_json=$(sudo -n -u miova node "$previous/scripts/selfhost/backup.mjs" --database /srv/miova/data/commerce.sqlite --directory /srv/miova/data/backups)
backup_file=$(node -e 'const r=JSON.parse(process.argv[1]);if(!r.verified)process.exit(1);console.log(r.filename)' "$backup_json")
[[ "$backup_file" =~ ^/srv/miova/data/backups/commerce-[A-Za-z0-9.-]+\.sqlite$ ]]
echo "$backup_json"
sudo -n chown -R root:root "$release"
sudo -n chmod -R a-w "$release"
link="/srv/miova/current.next-${release_commit}"
test ! -e "$link" && test ! -L "$link"
sudo -n ln -s "$release" "$link"
sudo -n mv -Tf "$link" /srv/miova/current
sudo -n systemctl start miova-web.service miova-admin.service
healthy=0
for attempt in {1..30}; do
  if curl -fsS --max-time 3 http://127.0.0.1:3100/api/v1/catalog >/dev/null && curl -fsS --max-time 3 http://127.0.0.1:3101/ >/dev/null; then healthy=1; break; fi
  sleep 1
done
test "$healthy" = 1
sudo -n node /home/ubuntu/miova-verify-admin.mjs
sudo -n node /home/ubuntu/miova-verify-state.mjs
test "$(curl -s -o /dev/null -w '%{http_code}' https://150.158.141.45/ops)" = 404
test "$(curl -s -o /dev/null -w '%{http_code}' https://150.158.141.45/api/admin/orders)" = 404
test "$(curl -s -o /dev/null -w '%{http_code}' -X POST -H 'Content-Type: application/json' --data '{}' https://150.158.141.45/api/v1/orders)" = 503
systemctl is-active miova-web.service miova-admin.service
# Successful checks are the publication boundary. Do not roll the database back
# after writes reopen: subsequent incidents need a forward fix or reviewed recovery.
trap - ERR HUP INT TERM
sudo -n rm -- /srv/miova/data/deployment.lock
echo "UPGRADE_READY=${release_commit}"
echo "PREVIOUS_RELEASE=${previous}"
