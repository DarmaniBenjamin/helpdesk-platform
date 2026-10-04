#!/usr/bin/env bash
# =====================================================================
#  Install Caddy, for Settings → Domain & SSL
# =====================================================================
# Only installs what https needs, nothing else:
#   1. Caddy (the web server that gets and renews Let's Encrypt
#      certificates), started now and on every boot
#   2. ports 80 and 443 opened, if a firewall is turned on
#
# There's nothing to set up afterwards: the helpdesk server gives Caddy
# its settings by itself (server/src/caddy.js).
#
# Run it from the project folder:
#   sudo bash deploy/install-caddy.sh
#
# Works on Ubuntu/Debian, Arch (Omarchy), Fedora and macOS (Homebrew).
# Safe to run again.
# =====================================================================

set -Eeuo pipefail

ok()   { printf '  \e[32m✓\e[0m %s\n' "$1"; }
info() { printf '  %s\n' "$1"; }
die()  { printf '\n\e[31m✗ %s\e[0m\n' "$1" >&2; exit 1; }
trap 'die "Stopped on line $LINENO."' ERR

# ---------------------------------------------------------------------
# 1. Install Caddy
# ---------------------------------------------------------------------
echo
echo "1/2 Caddy"

if [[ "$(uname)" == "Darwin" ]]; then
  # macOS: Homebrew, run as yourself (not with sudo). Macs let normal
  # programs use ports 80 and 443, and have no firewall rules to add.
  [[ $EUID -ne 0 ]] || die "On a Mac, run it without sudo:  bash deploy/install-caddy.sh"
  command -v brew >/dev/null || die "Install Homebrew first: https://brew.sh"
  command -v caddy >/dev/null || brew install caddy
  brew services restart caddy
  ok "Caddy $(caddy version | awk '{print $1}') is running"
  echo
  echo "Done. The helpdesk sets Caddy up by itself when its server is running."
  exit 0
fi

[[ $EUID -eq 0 ]] || die "Run it with sudo:  sudo bash deploy/install-caddy.sh"

if command -v caddy >/dev/null; then
  ok "Already installed ($(caddy version | awk '{print $1}'))"
elif command -v apt-get >/dev/null; then
  # Ubuntu / Debian: Caddy's own package source (always the newest)
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq
  apt-get install -y -qq curl gnupg debian-keyring debian-archive-keyring apt-transport-https >/dev/null
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' |
    gpg --batch --yes --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
    >/etc/apt/sources.list.d/caddy-stable.list
  chmod o+r /usr/share/keyrings/caddy-stable-archive-keyring.gpg /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -qq
  apt-get install -y -qq caddy >/dev/null
  ok "Installed $(caddy version | awk '{print $1}')"
elif command -v pacman >/dev/null; then
  # Arch / Omarchy
  pacman -S --needed --noconfirm caddy >/dev/null
  ok "Installed $(caddy version | awk '{print $1}')"
elif command -v dnf >/dev/null; then
  # Fedora (and RHEL-type systems with EPEL)
  dnf install -y -q caddy >/dev/null
  ok "Installed $(caddy version | awk '{print $1}')"
else
  die "Couldn't tell how to install software here. See https://caddyserver.com/docs/install"
fi

# Start it now and on every boot
systemctl enable caddy >/dev/null 2>&1
systemctl restart caddy
ok "Caddy is running, and starts by itself on boot"

# ---------------------------------------------------------------------
# 2. Ports 80 and 443 (only if a firewall is on)
# ---------------------------------------------------------------------
echo
echo "2/2 Ports 80 and 443"

opened=false

# ufw (Ubuntu and others), only if it's turned on
if command -v ufw >/dev/null && ufw status 2>/dev/null | grep -q "Status: active"; then
  ufw allow 80/tcp >/dev/null
  ufw allow 443/tcp >/dev/null
  ok "Opened in ufw"
  opened=true
fi

# firewalld (Fedora and others), only if it's running
if command -v firewall-cmd >/dev/null && firewall-cmd --state >/dev/null 2>&1; then
  firewall-cmd --quiet --permanent --add-service=http --add-service=https
  firewall-cmd --quiet --reload
  ok "Opened in firewalld"
  opened=true
fi

# Oracle Cloud's images block everything but SSH with saved iptables
# rules: add 80 and 443 just above the "block the rest" rule
if command -v netfilter-persistent >/dev/null && iptables -S INPUT 2>/dev/null | grep -q -- '-j REJECT'; then
  for port in 80 443; do
    if ! iptables -C INPUT -p tcp -m state --state NEW --dport "$port" -j ACCEPT 2>/dev/null; then
      line="$(iptables -L INPUT --line-numbers -n | awk '/REJECT/{print $1; exit}')"
      iptables -I INPUT "${line:-1}" -p tcp -m state --state NEW --dport "$port" -j ACCEPT
    fi
  done
  netfilter-persistent save >/dev/null 2>&1
  ok "Opened in iptables"
  opened=true
fi

$opened || info "No firewall is turned on here, so nothing to open."

echo
echo "Done. The helpdesk sets Caddy up by itself within 30 seconds of its"
echo "server running. Then add your domain in Settings → Domain & SSL."
echo
echo "On a cloud server, also open ports 80 and 443 in the provider's own"
echo "firewall if it has one (Linode Cloud Firewall, Google Cloud, Oracle"
echo "Security List, AWS Security Group)."
echo