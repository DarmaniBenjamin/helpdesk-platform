#!/usr/bin/env bash
# =====================================================================
#  Start the helpdesk on your server (production)
# =====================================================================
# Run it from the project folder:
#   sudo bash deploy/start.sh
#
# What it does:
#   1. switches server/.env to production settings:
#      NODE_ENV=production, and HOST=127.0.0.1 so the app can only be
#      reached through Caddy (https on your domains), not on the IP
#   2. installs the packages and builds the website, if that hasn't
#      been done yet
#   3. runs the app as a service: starts it now, after every reboot,
#      and again if it ever stops
#   4. closes the test ports (the app's own port and Vite's 5173) in
#      the server's firewall, so the site can't be opened on the IP
#   5. checks the app and Caddy are both working
#
# Safe to run again. To update the code, use update-uplink (or
# git pull, npm ci, npm run build), then run this again.
# =====================================================================

set -Eeuo pipefail

ok()   { printf '  \e[32m✓\e[0m %s\n' "$1"; }
warn() { printf '  \e[33m!\e[0m %s\n' "$1"; }
die()  { printf '\n\e[31m✗ %s\e[0m\n' "$1" >&2; exit 1; }
trap 'die "Stopped on line $LINENO."' ERR

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$APP_DIR/server/.env"
SERVICE=/etc/systemd/system/helpdesk.service

[[ $EUID -eq 0 ]] || die "Run it with sudo:  sudo bash deploy/start.sh"
[[ -f "$ENV_FILE" ]] || die "No settings file at $ENV_FILE. Create it first (see server/.env.example)."
command -v node >/dev/null || die "Node.js isn't installed. Install Node.js 22 first."
[[ "$(node -v)" == v22.* ]] || die "Node.js 22 is needed (this server has $(node -v))."
command -v systemctl >/dev/null || die "This server doesn't use systemd."

# The user who owns the project folder runs the app (not root)
APP_USER="$(stat -c %U "$APP_DIR")"
[[ "$APP_USER" != "root" ]] || die "The project folder belongs to root. Clone it as your normal user instead."
as_app() { sudo -u "$APP_USER" -H bash -c "cd '$1' && $2"; }

# Reads and changes one setting in server/.env
env_get() {
  { grep -E "^$1=" "$ENV_FILE" || true; } | tail -n 1 | cut -d= -f2-
}
env_set() {
  if grep -qE "^#? *$1=" "$ENV_FILE"; then
    sed -i -E "s|^#? *$1=.*|$1=$2|" "$ENV_FILE"
  else
    echo "$1=$2" >>"$ENV_FILE"
  fi
}

# ---------------------------------------------------------------------
echo
echo "1/5 Production settings"
env_set NODE_ENV production
env_set HOST 127.0.0.1
PORT="$(env_get PORT)"
PORT="${PORT:-4000}"
chown "$APP_USER:" "$ENV_FILE"
chmod 600 "$ENV_FILE"
ok "NODE_ENV=production, HOST=127.0.0.1 (port $PORT, only reachable on this server)"

# ---------------------------------------------------------------------
echo
echo "2/5 Packages and website"
if [[ ! -d "$APP_DIR/node_modules" ]]; then
  as_app "$APP_DIR" "npm ci --no-audit --no-fund" >/dev/null
  ok "Installed the website's packages"
fi
if [[ ! -f "$APP_DIR/dist/index.html" ]]; then
  as_app "$APP_DIR" "npm run build" >/dev/null
  ok "Built the website"
fi
if [[ ! -d "$APP_DIR/server/node_modules" ]]; then
  as_app "$APP_DIR/server" "npm ci --omit=dev --no-audit --no-fund" >/dev/null
  ok "Installed the server's packages"
fi
ok "Ready"

# ---------------------------------------------------------------------
echo
echo "3/5 The app as a service"
cat >"$SERVICE" <<EOF
[Unit]
Description=Helpdesk platform
After=network-online.target postgresql.service
Wants=network-online.target

[Service]
User=$APP_USER
WorkingDirectory=$APP_DIR/server
ExecStart=$(command -v npm) start
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable helpdesk >/dev/null 2>&1
systemctl restart helpdesk

healthy=false
for _ in $(seq 1 60); do
  if curl -fsS --max-time 2 "http://127.0.0.1:$PORT/api/health" >/dev/null 2>&1; then
    healthy=true
    break
  fi
  sleep 1
done
if ! $healthy; then
  journalctl -u helpdesk -n 20 --no-pager | sed 's/^/    /'
  die "The app didn't start. Its last messages are above."
fi
ok "Running as $APP_USER, starts by itself on boot"

# ---------------------------------------------------------------------
echo
echo "4/5 Closing direct access on the IP"
for port in "$PORT" 5173; do
  # iptables (Oracle Cloud and others)
  if command -v iptables >/dev/null; then
    while iptables -C INPUT -p tcp -m state --state NEW --dport "$port" -j ACCEPT 2>/dev/null; do
      iptables -D INPUT -p tcp -m state --state NEW --dport "$port" -j ACCEPT
    done
  fi
  # ufw
  if command -v ufw >/dev/null && ufw status 2>/dev/null | grep -q "Status: active"; then
    ufw delete allow "$port/tcp" >/dev/null 2>&1 || true
    ufw delete allow "$port" >/dev/null 2>&1 || true
  fi
done
if command -v netfilter-persistent >/dev/null; then
  netfilter-persistent save >/dev/null 2>&1
fi
ok "Ports $PORT and 5173 closed in the server's firewall"

# The app itself must only listen on 127.0.0.1
if ss -ltn 2>/dev/null | awk '{print $4}' | grep -qE "^(0\.0\.0\.0|\*|\[::\]):$PORT$"; then
  warn "Something is still listening on port $PORT for everyone. Is a dev server (npm run dev) still running? Stop it with Ctrl+C."
else
  ok "The app only listens on 127.0.0.1"
fi

# ---------------------------------------------------------------------
echo
echo "5/5 Caddy (https)"
if ! command -v caddy >/dev/null; then
  warn "Caddy isn't installed. Run:  sudo bash deploy/install-caddy.sh"
else
  configured=false
  for _ in $(seq 1 15); do
    if curl -fsS --max-time 2 http://127.0.0.1:2019/id/helpdesk >/dev/null 2>&1; then
      configured=true
      break
    fi
    sleep 1
  done
  if $configured; then
    ok "Caddy has the helpdesk's settings: https is on for your domains"
  else
    warn "Caddy doesn't have the helpdesk's settings yet. Check:  sudo systemctl status caddy"
  fi
fi

# (deploy/install.sh prints its own next steps)
[[ -n "${INSTALLING:-}" ]] && exit 0

DOMAIN="$(env_get SITE_DOMAIN | cut -d, -f1)"
echo
echo "Done. The site is only reachable on your domains, over https:"
if [[ -n "$DOMAIN" ]]; then
  echo "  https://$DOMAIN"
fi
echo "  (and any others in Settings → Domain & SSL)"
echo
echo "If you opened port $PORT or 5173 in your cloud provider's firewall"
echo "(e.g. Oracle's Security List), remove those rules there too."
echo