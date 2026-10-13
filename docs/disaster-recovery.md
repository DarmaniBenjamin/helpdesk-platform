# Disaster recovery: the helpdesk back from nothing

For when the server is gone (hacked, deleted, the provider failed) and
the only copy of the data is the backup in Backblaze. You need:

- a new Ubuntu or Debian server, with your normal (non-root) user that
  can use sudo
- your GitHub account (this repository is private)
- your Backblaze details, and the **backup password** (it's the only way
  to open the backups: keep it in a password manager, outside the
  helpdesk)

It takes about 20 minutes.

## 1. Give the new server its own key to GitHub

On the new server, as your normal user:

    ssh-keygen -t ed25519 -f ~/.ssh/helpdesk_deploy -N "" -C "helpdesk-server"
    cat ~/.ssh/helpdesk_deploy.pub

Copy the line it prints. On GitHub, open this repository → **Settings →
Deploy keys → Add deploy key**, paste it, and leave **Allow write
access** unticked. Delete the old server's key from that list while
you're there.

Then:

    cat >> ~/.ssh/config <<'EOF'
    Host github-helpdesk
      HostName github.com
      User git
      IdentityFile ~/.ssh/helpdesk_deploy
      IdentitiesOnly yes
    EOF
    ssh -T git@github-helpdesk

The last command says "You've successfully authenticated" (and that
there's no shell access, which is right).

## 2. Download the helpdesk and install everything

    git clone git@github-helpdesk:DarmaniBenjamin/helpdesk-platform.git
    cd helpdesk-platform
    sudo bash deploy/install.sh

It installs Node.js, PostgreSQL and Caddy, makes the database with its
own password, writes `server/.env`, builds and starts the app, and ends
by printing a **setup link**.

## 3. Super Admin, domain, and the data back

1. Open the setup link and make your Super Admin (your email and a new
   password), then sign in.
2. **Settings → Domain & SSL:** add your domain, and point its DNS at the
   new server's IP address.
3. **Settings → Backup → Copies in the cloud:** enter your Backblaze
   details and the backup password. The copies appear: restore the
   newest one. Everything comes back: tickets, customers, the team,
   settings and files.
4. Sign in again with your old account (the restore brought it back).

## 4. Put the rest back

These live in `server/.env`, which isn't backed up (it holds the
secrets). Set them again if you used them, then run
`sudo systemctl restart helpdesk`:

- **AI investigations** (docs/maintenance.md): `MAINT_GITHUB_REPO`,
  `MAINT_GITHUB_TOKEN`, `MAINT_GITHUB_WEBHOOK_SECRET`. Make a new token,
  and revoke the old one on GitHub, since the old server may be in
  someone else's hands. Do the same for the webhook secret, in the
  repository's webhook settings.
- Anything else you'd added to `server/.env` (see `server/.env.example`).

If the old server was hacked, also change on the services themselves:
the Backblaze application key, email passwords, the WhatsApp app secret,
and the phone system's webhook address (Integrations → Phone → Make a
new address).

## Updating afterwards

    update-uplink

That's `deploy/update.sh`: see docs/maintenance.md, "Deploying".
