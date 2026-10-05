#!/usr/bin/env bash
# =====================================================================
#  Install the helpdesk on a brand-new server, in one go
# =====================================================================
# For a fresh Ubuntu or Debian server (e.g. after the old one was lost).
# As your normal user (not root):
#
#   git clone https://github.com/DarmaniBenjamin/helpdesk-platform.git
#   cd helpdesk-platform
#   sudo bash deploy/install.sh
#
# What it does, by itself:
#   1. installs Node.js 22, PostgreSQL, and the tools it needs
#   2. makes the database and its user, with a long random password
#   3. writes server/.env: the database link, production settings, and a
#      one-time setup code (no passwords to type in)
#   4. installs Caddy (https and certificates, deploy/install-caddy.sh)
#   5. installs the packages, builds the website, and starts the app as a
#      service (deploy/start.sh), which also starts after every reboot
#   6. adds the update-uplink command, for pulling updates later
# and finishes by printing a link: open it, make your Super Admin, then
# Settings → Domain & SSL, and Settings → Backup → Copies in the cloud to
# bring everything back from Backblaze.
#
# Safe to run again: anything already done is left as it is (the
# database password and server/.env are only made the first time).
# =====================================================================

set -Eeuo pipefail

ok()   { printf '  \e[32m✓\e[0m %s\n' "$1"; }
warn() { printf '  \e[33m!\e[0m %s\n' "$1"; }
die()  { printf '\n\e[31m✗ %s\e[0m\n' "$1" >&2; exit 1; }
trap 'die "Stopped on line $LINENO."' ERR

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$APP_DIR/server/.env"
DB_NAME=helpdesk_db
DB_USER=helpdesk

[[ $EUID -eq 0 ]] || die "Run it with sudo:  sudo bash deploy/install.sh"
command -v apt-get >/dev/null || die "This script is for Ubuntu or Debian servers."

# The user who cloned the project runs the app (never root)
APP_USER="$(stat -c %U "$APP_DIR")"
[[ "$APP_USER" != "root" ]] ||
  die "The project folder belongs to root. Clone it as your normal user (not with sudo), then run this again."
APP_HOME="$(getent passwd "$APP_USER" | cut -d: -f6)"
as_app() { sudo -u "$APP_USER" -H bash -c "cd '$1' && $2"; }

# A long random password or code (letters and numbers only)
random() { tr -dc 'A-Za-z0-9' </dev/urandom | head -c "$1" || true; }

export DEBIAN_FRONTEND=noninteractive

# ---------------------------------------------------------------------
echo
echo "1/6 Tools, Node.js 22 and PostgreSQL"
apt-get update -qq
apt-get install -y -qq curl ca-certificates gnupg git tar postgresql >/dev/null
ok "curl, git, tar, PostgreSQL"
if ! command -v node >/dev/null || [[ "$(node -v)" != v22.* ]]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null
  apt-get install -y -qq nodejs >/dev/null
fi
ok "Node.js $(node -v)"
systemctl enable --now postgresql >/dev/null 2>&1
ok "PostgreSQL running"

# ---------------------------------------------------------------------
echo
echo "2/6 The database"
as_pg() { sudo -u postgres psql -v ON_ERROR_STOP=1 -qtAc "$1"; }
if [[ -f "$ENV_FILE" ]] && grep -q "^DATABASE_URL=" "$ENV_FILE"; then
  ok "server/.env already has a database link: left as it is"
else
  DB_PASSWORD="$(random 40)"
  if [[ "$(as_pg "select 1 from pg_roles where rolname = '$DB_USER'")" == "1" ]]; then
    as_pg "alter role $DB_USER with login password '$DB_PASSWORD'"
  else
    as_pg "create role $DB_USER with login password '$DB_PASSWORD'"
  fi
  ok "Database user $DB_USER, with a new random password"
fi
if [[ "$(as_pg "select 1 from pg_database where datname = '$DB_NAME'")" != "1" ]]; then
  as_pg "create database $DB_NAME owner $DB_USER"
  ok "Database $DB_NAME made"
else
  ok "Database $DB_NAME already there"
fi

# ---------------------------------------------------------------------
echo
echo "3/6 Settings (server/.env)"
if [[ ! -f "$ENV_FILE" ]]; then
  SETUP_CODE="$(random 32)"
  cat >"$ENV_FILE" <<EOF
# Made by deploy/install.sh on $(date -u +"%Y-%m-%d %H:%M UTC").
# The database password below is random and only used by this server.
DATABASE_URL=postgres://$DB_USER:$DB_PASSWORD@localhost:5432/$DB_NAME
PORT=4000
HOST=127.0.0.1
NODE_ENV=production

# The link printed at the end of the install uses this, to make the
# first Super Admin (it stops working once there is one)
SETUP_CODE=$SETUP_CODE

# Optional (see server/.env.example): SITE_DOMAIN, SERVER_IP, CADDY_EMAIL
SITE_DOMAIN=
SERVER_IP=
EOF
  ok "Made server/.env"
elif [[ -n "${DB_PASSWORD:-}" ]]; then
  echo "DATABASE_URL=postgres://$DB_USER:$DB_PASSWORD@localhost:5432/$DB_NAME" >>"$ENV_FILE"
  ok "Added the database link to server/.env"
else
  ok "server/.env already there: left as it is"
fi
if ! grep -q "^SETUP_CODE=." "$ENV_FILE"; then
  echo "SETUP_CODE=$(random 32)" >>"$ENV_FILE"
fi
SETUP_CODE="$(grep "^SETUP_CODE=" "$ENV_FILE" | tail -n 1 | cut -d= -f2-)"
chown "$APP_USER:" "$ENV_FILE"
chmod 600 "$ENV_FILE"
ok "Only $APP_USER can read it"

# ---------------------------------------------------------------------
echo
echo "4/6 Caddy (https)"
if command -v caddy >/dev/null; then
  ok "Already installed"
else
  bash "$APP_DIR/deploy/install-caddy.sh"
fi

# ---------------------------------------------------------------------
echo
echo "5/6 Packages, website and the app as a service"
as_app "$APP_DIR" "npm ci --no-audit --no-fund" >/dev/null
ok "Website packages"
as_app "$APP_DIR" "npm run build" >/dev/null
ok "Website built"
as_app "$APP_DIR/server" "npm ci --omit=dev --no-audit --no-fund" >/dev/null
ok "Server packages"
INSTALLING=1 bash "$APP_DIR/deploy/start.sh"

# ---------------------------------------------------------------------
echo
echo "6/6 The update-uplink command"
BASHRC="$APP_HOME/.bashrc"
if ! grep -q "alias update-uplink=" "$BASHRC" 2>/dev/null; then
  echo "alias update-uplink='cd $APP_DIR && git pull && npm ci && npm run build && cd server && npm ci --omit=dev && sudo systemctl restart helpdesk'" >>"$BASHRC"
  chown "$APP_USER:" "$BASHRC"
  ok "Added (open a new terminal to use it)"
else
  ok "Already there"
fi

# ---------------------------------------------------------------------
IP="$(curl -fsS --max-time 5 https://api.ipify.org 2>/dev/null || hostname -I | awk '{print $1}')"
echo
printf '\e[32m%s\e[0m\n' "Done! The helpdesk is installed and running."
echo
if sudo -u postgres psql -qtAc "select 1 from users where role = 'owner' and status = 'active' limit 1" "$DB_NAME" 2>/dev/null | grep -q 1; then
  echo "This helpdesk already has a Super Admin: sign in at http://$IP"
else
  echo "Next, open this link in your browser to make the Super Admin:"
  echo
  printf '    \e[1mhttp://%s/setup/%s\e[0m\n' "$IP" "$SETUP_CODE"
  echo
  echo "Keep it to yourself: whoever opens it first becomes the Super Admin."
fi
echo
echo "Then, in the helpdesk:"
echo "  1. Settings → Domain & SSL: add your domain, and point its DNS"
echo "     A record at $IP"
echo "  2. Settings → Backup → Copies in the cloud: fill in your Backblaze"
echo "     details and backup password, then Restore the newest copy."
echo "     Everything comes back: tickets, customers, the team, files."
echo
echo "Your cloud provider's firewall (e.g. Oracle's Security List) must"
echo "allow ports 80 and 443 for the link and https to work."
echo
