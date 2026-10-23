#!/usr/bin/env bash
# =====================================================================
#  update-uplink: update the live helpdesk to the latest version, safely
# =====================================================================
#   update-uplink              (the shortcut install.sh adds)
#   bash deploy/update.sh      (the same)
#
# Options:
#   --yes        don't ask when CI can't be checked (never skips a failed CI)
#   --backup     make a database backup first even without a migration
#   --skip-ci    deploy even though CI failed (you'll be asked to type yes)
#   --check      only say what would happen; change nothing
#
# What it does, in order. Anything that fails stops it; after the
# restart, a failure rolls back to the version that was running:
#   1. one update at a time (a lock)
#   2. no local edits on the server; the new version follows on from the
#      running one (GitHub's history wasn't rewritten)
#   3. CI passed for that exact commit (deploy/ci-status.mjs)
#   4. with a database migration in it: refuses one that edits an old
#      migration, asks you to type yes for one that deletes data, and
#      makes a database backup and checks it can be read
#   5. installs the packages, and builds the website into dist-next, so
#      the live site keeps working until it's switched
#   6. restarts the app (migrations run then), and checks it: the health
#      check with the database connected, the website and the API, and
#      no crashes or burst of errors for a minute
#   7. marks the approved fixes in it as deployed (Maintenance page)
#
# Rolling back puts the previous code and website back and restarts it.
# It never undoes database changes by itself (that would delete what was
# written since); if a migration ran, it prints how to restore the backup.
# Each update is written to ~/.helpdesk-deploy/history.log.
# =====================================================================
set -Eeuo pipefail

ok()   { printf '  \e[32m✓\e[0m %s\n' "$1"; }
warn() { printf '  \e[33m!\e[0m %s\n' "$1"; }
die()  { printf '\n\e[31m✗ %s\e[0m\n' "$1" >&2; exit 1; }
step() { printf '\n\e[1m%s\e[0m\n' "$1"; }

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$APP_DIR/server/.env"
STATE="${DEPLOY_STATE_DIR:-$HOME/.helpdesk-deploy}"
SERVICE="${DEPLOY_SERVICE:-helpdesk}"
BRANCH="${DEPLOY_BRANCH:-main}"
WATCH_SECONDS="${DEPLOY_WATCH_SECONDS:-60}"
MAX_ERRORS="${DEPLOY_MAX_ERRORS:-10}"
KEEP_BACKUPS="${DEPLOY_KEEP_BACKUPS:-5}"

YES=0; BACKUP=0; SKIP_CI=0; CHECK_ONLY=0
for arg in "$@"; do
  case "$arg" in
    --yes) YES=1 ;;
    --backup) BACKUP=1 ;;
    --skip-ci) SKIP_CI=1 ;;
    --check) CHECK_ONLY=1 ;;
    *) die "Unknown option: $arg (see the top of deploy/update.sh)" ;;
  esac
done

[[ $EUID -ne 0 ]] || die "Run it as your normal user, not with sudo (it asks for sudo when it needs it)."
[[ -f "$ENV_FILE" ]] || die "No server/.env: is this the live helpdesk's folder?"
setting() { grep -E "^$1=" "$ENV_FILE" | tail -n 1 | cut -d= -f2- | sed -E "s/^(['\"])(.*)\1$/\2/"; }
PORT="$(setting PORT)"; PORT="${PORT:-4000}"
URL="http://127.0.0.1:$PORT"

mkdir -p "$STATE/backups"
chmod 700 "$STATE"
log() { printf '%s %s\n' "$(date -Is)" "$*" >>"$STATE/history.log"; }

# ---------------------------------------------------------------------
# 1. One update at a time
exec 9>"$STATE/deploy.lock"
flock -n 9 || die "Another update is running right now. Wait for it to finish."

cd "$APP_DIR"
step "1/6 What's new"
if [[ -n "$(git status --porcelain --untracked-files=no)" ]]; then
  git status --short --untracked-files=no
  die "Files on the server were changed by hand (above). Undo them (git checkout -- <file>) or ask for help, then try again."
fi
PREV="$(git rev-parse HEAD)"
git fetch --quiet origin "$BRANCH" || die "Couldn't reach GitHub. Check the server's deploy key (docs/disaster-recovery.md)."
TARGET="$(git rev-parse "origin/$BRANCH")"
short() { git rev-parse --short "$1"; }
if [[ "$PREV" == "$TARGET" ]]; then
  ok "Already up to date ($(short "$PREV"))"
  exit 0
fi
git merge-base --is-ancestor "$PREV" "$TARGET" ||
  die "GitHub's $BRANCH doesn't follow on from the version running here (its history was rewritten). Not updating: ask for help."
COUNT="$(git rev-list --count "$PREV..$TARGET")"
ok "$COUNT new change(s): $(short "$PREV") → $(short "$TARGET")"
# (--max-count, not "| head": cutting git log short makes it fail, which
# stopped the script here when there were more than 15 changes)
git log --oneline --no-decorate --max-count=15 "$PREV..$TARGET" | sed 's/^/      /'
[[ $COUNT -le 15 ]] || echo "      ...and $((COUNT - 15)) more"

# ---------------------------------------------------------------------
# 3. CI
step "2/6 CI"
set +e
CI_LINE="$(cd "$APP_DIR/server" && node --env-file=.env ../deploy/ci-status.mjs "$TARGET" 2>&1 | tail -n 1)"
CI=$?
set -e
confirm() { # confirm "question": yes only if they type yes
  [[ -t 0 ]] || return 1
  read -r -p "  $1 Type yes to go on: " answer
  [[ "$answer" == "yes" ]]
}
case $CI in
  0) ok "$CI_LINE" ;;
  1) if [[ $SKIP_CI -eq 1 ]] && confirm "$CI_LINE Deploy anyway?"; then warn "Deploying although CI failed"
     else die "$CI_LINE Fix it first (or, if you're sure: update-uplink --skip-ci)."; fi ;;
  2) die "$CI_LINE Try again in a few minutes." ;;
  *) if [[ $YES -eq 1 ]] || confirm "$CI_LINE Deploy without knowing?"; then warn "$CI_LINE Going on."
     else die "$CI_LINE Not updating."; fi ;;
esac

# ---------------------------------------------------------------------
# 4. Database changes
step "3/6 Database"
MIGRATIONS="$(git diff --name-only --diff-filter=A "$PREV" "$TARGET" -- 'server/drizzle/*.sql')"
EDITED="$(git diff --name-only --diff-filter=MDR "$PREV" "$TARGET" -- 'server/drizzle/*.sql')"
[[ -z "$EDITED" ]] ||
  die "This update edits or removes migrations that already ran ($EDITED). That can break the database: not updating."
BACKUP_FILE=""
if [[ -n "$MIGRATIONS" ]]; then
  ok "New migration(s): $(echo "$MIGRATIONS" | xargs -n1 basename | tr '\n' ' ')"
  DESTRUCTIVE="$(git diff "$PREV" "$TARGET" -- 'server/drizzle/*.sql' | grep -E '^\+' |
    grep -iE '\b(DROP[[:space:]]+(TABLE|COLUMN|TYPE|SCHEMA|INDEX)|TRUNCATE|DELETE[[:space:]]+FROM|RENAME[[:space:]]+(COLUMN|TO)|ALTER[[:space:]]+COLUMN.*[[:space:]]TYPE)\b' || true)"
  if [[ -n "$DESTRUCTIVE" ]]; then
    warn "A migration in this update can delete or reshape data:"
    printf '%s\n' "$DESTRUCTIVE" | sed -n '1,10s/^/      /p'
    confirm "The code can be rolled back, but these database changes can't, except by restoring the backup." ||
      die "Not updating."
  fi
  BACKUP=1
else
  ok "No database changes"
fi
if [[ $BACKUP -eq 1 && $CHECK_ONLY -eq 0 ]]; then
  DB_URL="$(setting DATABASE_URL)"
  [[ -n "$DB_URL" ]] || die "No DATABASE_URL in server/.env: can't back up."
  BACKUP_FILE="$STATE/backups/before-$(date +%Y%m%d-%H%M%S)-$(short "$TARGET").dump"
  pg_dump --format=custom --no-owner --file="$BACKUP_FILE" "$DB_URL" ||
    die "The backup didn't work, so nothing was changed."
  chmod 600 "$BACKUP_FILE"
  # A backup only counts if it can be read back
  TABLES="$(pg_restore --list "$BACKUP_FILE" 2>/dev/null | grep -c 'TABLE DATA' || true)"
  [[ "${TABLES:-0}" -gt 0 ]] || die "The backup can't be read back, so nothing was changed."
  ok "Database backed up and checked ($TABLES tables): $BACKUP_FILE"
  # Only this script's own backups are tidied (never the Backblaze copies)
  ls -1t "$STATE"/backups/before-*.dump 2>/dev/null | tail -n +"$((KEEP_BACKUPS + 1))" | xargs -r rm -f
fi

if [[ $CHECK_ONLY -eq 1 ]]; then
  echo
  ok "Checked only (--check): nothing was changed."
  exit 0
fi

# ---------------------------------------------------------------------
# From here on, a failure rolls back
STAGE="installing"
RESTARTED=0
health() {
  curl -fsS --max-time 5 "$URL/api/health" 2>/dev/null | grep -q '"database":"connected"'
}
answers() { # answers <path> <codes...>: the app answers with one of them
  local code
  code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$URL$1" || true)"
  shift
  for c in "$@"; do [[ "$code" == "$c" ]] && return 0; done
  return 1
}
mark() { # mark deployed <sha> | mark rolled-back <from> <to>: the Maintenance page
  (cd "$APP_DIR/server" && node --env-file=.env src/db/deployed.js "$@") ||
    warn "Couldn't update the Maintenance page (the update itself is fine)."
}

rollback() {
  trap - ERR
  set +e
  printf '\n\e[31m✗ Failed while %s. Rolling back to %s.\e[0m\n' "$STAGE" "$(short "$PREV")"
  git reset --hard --quiet "$PREV"
  rm -rf "$APP_DIR/dist-next"
  if [[ -d "$APP_DIR/dist-prev" ]]; then
    rm -rf "$APP_DIR/dist" && mv "$APP_DIR/dist-prev" "$APP_DIR/dist"
  fi
  if ! git diff --quiet "$PREV" "$TARGET" -- server/package-lock.json; then
    (cd "$APP_DIR/server" && npm ci --omit=dev --no-audit --no-fund >/dev/null)
  fi
  if [[ $RESTARTED -eq 1 ]]; then
    sudo systemctl restart "$SERVICE"
    local i
    for i in $(seq 1 60); do health && break; sleep 2; done
    if health; then ok "Back on $(short "$PREV"), and healthy"
    else warn "Back on $(short "$PREV"), but it isn't healthy yet: sudo journalctl -u $SERVICE -n 100"; fi
    mark rolled-back "$PREV" "$TARGET"
    if [[ -n "$MIGRATIONS" ]]; then
      echo
      warn "The new version's migration(s) already ran on the database. Usually the previous"
      warn "version still works with them (migrations only add things). If it doesn't, restore"
      warn "the backup made before the update. This replaces everything written since:"
      echo "      sudo systemctl stop $SERVICE"
      echo "      pg_restore --clean --if-exists --no-owner --dbname=\"\$(grep ^DATABASE_URL= server/.env | cut -d= -f2-)\" $BACKUP_FILE"
      echo "      sudo systemctl start $SERVICE"
    fi
  else
    ok "Back on $(short "$PREV"). The live app was never restarted, so it kept running throughout."
  fi
  log "ROLLED BACK $(short "$PREV") -> $(short "$TARGET") (failed while $STAGE)"
  exit 1
}
trap rollback ERR

# ---------------------------------------------------------------------
# 5. Install and build, beside the live site
step "4/6 Installing and building"
git merge --ff-only --quiet "origin/$BRANCH"
npm ci --no-audit --no-fund >/dev/null
ok "Website packages"
STAGE="building the website"
rm -rf "$APP_DIR/dist-next"
npm run build -- --outDir dist-next --emptyOutDir >/dev/null
[[ -f "$APP_DIR/dist-next/index.html" ]] || false
ok "Website built"
STAGE="installing the server's packages"
(cd "$APP_DIR/server" && npm ci --omit=dev --no-audit --no-fund >/dev/null)
ok "Server packages"

# ---------------------------------------------------------------------
# 6. Switch, restart, check
step "5/6 Restarting"
STAGE="restarting"
rm -rf "$APP_DIR/dist-prev"
[[ -d "$APP_DIR/dist" ]] && mv "$APP_DIR/dist" "$APP_DIR/dist-prev"
mv "$APP_DIR/dist-next" "$APP_DIR/dist"
RESTARTS_BEFORE="$(systemctl show -p NRestarts --value "$SERVICE" 2>/dev/null || echo 0)"
SINCE="$(date '+%Y-%m-%d %H:%M:%S')"
RESTARTED=1
sudo systemctl restart "$SERVICE"

step "6/6 Checking it"
STAGE="waiting for it to be healthy"
for i in $(seq 1 60); do health && break; sleep 2; done
health
ok "Healthy: the server is up and the database is connected"
STAGE="checking the website and the API"
answers / 200
answers /api/tickets 401 403
ok "The website and the API answer"
# Watching: rolled back if it stops, crashes and restarts, stops answering,
# or logs too many errors. The message says which. A health check that
# fails is tried again twice first (a freshly started app on a busy or
# low-memory server can be slow to answer once); a real failure fails all
# three times.
watch_health() {
  curl -fsS --max-time 10 "$URL/api/health" 2>/dev/null | grep -q '"database":"connected"'
}
for i in $(seq 1 $((WATCH_SECONDS / 5))); do
  sleep 5
  STAGE="watching it for $WATCH_SECONDS seconds: it stopped running"
  systemctl is-active --quiet "$SERVICE"
  STAGE="watching it for $WATCH_SECONDS seconds: it crashed and restarted"
  [[ "$(systemctl show -p NRestarts --value "$SERVICE" 2>/dev/null || echo 0)" == "$RESTARTS_BEFORE" ]]
  if ! watch_health; then
    warn "It didn't answer its health check in time; trying again..."
    sleep 3
    if ! watch_health; then
      sleep 5
      STAGE="watching it for $WATCH_SECONDS seconds: it stopped answering its health check (3 tries)"
      watch_health
    fi
  fi
done
ERRORS="$(sudo journalctl -u "$SERVICE" --since "$SINCE" -o cat 2>/dev/null | grep -c '"level":"error"' || true)"
STAGE="watching it for $WATCH_SECONDS seconds: it logged ${ERRORS:-0} errors (the limit is $MAX_ERRORS)"
[[ "${ERRORS:-0}" -lt "$MAX_ERRORS" ]]
ok "No crashes, and ${ERRORS:-0} error(s) logged since the restart"

trap - ERR
rm -rf "$APP_DIR/dist-prev"
mark deployed "$TARGET"
log "DEPLOYED $(short "$PREV") -> $(short "$TARGET")${BACKUP_FILE:+ (backup: $BACKUP_FILE)}"
echo
printf '\e[32m%s\e[0m\n' "Done: the helpdesk is on $(short "$TARGET")."
