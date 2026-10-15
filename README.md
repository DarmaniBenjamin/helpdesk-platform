# Uplink — Helpdesk Platform

**Uplink** is a private, custom-built customer support and ticket
**Uplink** is a private, custom-built customer support and ticket
management system: tickets from email, WhatsApp, the phone system, the
website and the customer portal land in one Inbox, where the team works
them, with automations, SLAs, a calendar, a knowledge base, reports, and
backups that can bring everything back from nothing. Inside the app it's
called **Uplink** (the name is set in `src/brand.js`).

---

## 🔒 Copyright & Licensing

**Copyright © 2026 darmani. All rights reserved.**

This repository is **not open-source**. The source code, assets, and
documentation are the exclusive property of the author.

- **No Copying:** You may not copy, duplicate, or fork this repository for
  public or commercial reuse.
- **No Redistribution:** No part of this application may be shared or
  redistributed without express written permission.

---

## What it does

### Tickets

- **Inbox:** every ticket, with filters, statuses (open, pending,
  waiting, resolved, closed), priorities, teams and assignees.
- **The ticket:** the conversation with the customer, internal notes,
  attachments (photos play inline, voicemails and voice notes play in the
  page), and the full history of every change.
- **Ticket numbers:** a new ticket gets the highest number + 1. Tickets
  imported from Freshdesk keep their numbers, so after an import new
  tickets carry on after the last one (#8123 → #8124). Deleting a ticket
  frees its number: the next new ticket takes it.
- **SLAs:** each priority has first-reply and resolve targets, which set
  the due times on every ticket. Due-soon and overdue tickets are flagged.
- **Ticket Review:** where Admins check finished tickets and mark them
  reviewed.
- **Ratings:** customers rate finished tickets from a "how did we do?"
  link.

### Where tickets come from (Integrations)

- **Website form:** a public request form, which can also be embedded on
  your company website.
- **Email:** connect mailboxes with Sign in with Microsoft, Sign in with
  Google, or any IMAP/SMTP mailbox. Emails become tickets, and replies
  go back by email.
  - Newsletters, automatic emails and senders who aren't customers wait
    in **Email review** instead of becoming tickets: tick them all and
    make tickets or ignore them in one click.
  - Senders or whole domains can be always-allowed or always-ignored.
- **WhatsApp:** messages, photos and voice notes sent to each agent's
  WhatsApp Business number become tickets for that agent, through Meta's
  official platform. Agents keep using the WhatsApp Business app on their
  phone, and what they reply there goes on the ticket too.
- **Phone (any PBX: 3CX, FreePBX, Yeastar, Grandstream, hosted ones):**
  - voicemails become tickets for the agent whose extension it was
  - recorded calls go on the caller's ticket, to play back
  - missed calls can become tickets
  - the caller is matched to the customer by phone number
  - works through voicemail emails, a call webhook, and ready-made
    FreePBX scripts (`deploy/pbx`)
- **Backup alerts:** alerts from the backup gateway become tickets.

### Customers

- **Customers:** people and businesses, with their emails, phone numbers
  and ticket history.
- **Customer portal:** customers can sign in to see their tickets, reply,
  and send new requests.

### The team

- **Team:** invite staff and set their roles and teams (departments).
- **Ticket Assignment:** rules that assign new tickets to the right person
  or team.
- **Automation:** automations that act on tickets by themselves (for
  example "no reply for 24 hours").
- **Calendar:** jobs booked for a time (a site visit, a remote session, a
  call), done by one or more agents, usually for a ticket.
- **Knowledge Base:** saved answers (a problem and how it was fixed),
  written by hand or saved straight from a ticket's note.
- **Performance & Feedback**, and **Report and Statistics:** response
  times, SLA results, ratings, and where tickets come from.
- **Notifications:** the bell in the top bar, and real desktop and phone
  notifications. Every open tab updates live, without reloading.

### Running it

- **Settings → Domain & SSL:** your own domain, with a free certificate
  from Let's Encrypt (through Caddy, set up by the app itself).
- **Settings → Backup & Restore:**
  - backups of everything, and restoring
  - encrypted copies in Backblaze B2, made within 10 minutes of any
    change
  - old versions thinned out by themselves: every copy for 48 hours,
    then one a day for 30 days, then one a week for 3 months
- **Settings → Import from Freshdesk:** brings customers and tickets over
  from Freshdesk.
- **Maintenance:** every error the app runs into, and bugs staff report
  (profile menu → Report a bug), as incidents. Optionally, an AI
  investigates serious ones on GitHub and proposes a fix as a pull
  request for a person to approve (see below).

### Who can do what

| Role | Can |
|---|---|
| **Super Admin** | Everything, including backups, settings, AI & GitHub, and who is an Admin. There's only one. |
| **Admin** | Creates tickets, invites and removes agents and customers, manages teams, rules, automations, integrations, reports and Maintenance. |
| **Agent** | Works on tickets: replies, notes, status, and assigning tickets to themselves or anyone else. Uses the calendar and the knowledge base. |
| **Customer** | Signs in to the customer portal, and can only see their own tickets. |

The full list is on the Team page, and the same rules are checked on the
server (`server/src/permissions.js`), so nobody can get around them.

---

## 🛠️ Technology

- **Website:** React 19 + Vite + Tailwind CSS (`src/`)
- **Server:** Node.js 22 + Express (`server/`)
- **Database:** PostgreSQL, with Drizzle ORM. The migrations are in
  `server/drizzle` and run by themselves when the server starts.
- **Web server:** Caddy (https and certificates)
- **Backups:** Backblaze B2 (or any S3-compatible storage)
- **CI and AI investigations:** GitHub Actions

### Where things are

| Folder | What's in it |
|---|---|
| `src/` | The website: pages in `src/Components/Pages`, the customer portal in `src/Components/Portal` |
| `server/src/` | The server: one file per area (`tickets.js`, `email.js`, `whatsapp.js`, `phone.js`, `backup.js`, `incidents.js`...). Each file starts with what it does. |
| `server/src/db/` | The database: `schema.js` (every table), migrations, seed and test data |
| `server/drizzle/` | Database migrations, in order |
| `server/test/` | Automated tests (`cd server && npm test`) |
| `deploy/` | Installing, updating and running it on a server |
| `scripts/maintenance/` | The AI investigation, run by GitHub Actions |
| `.github/workflows/` | CI, and the AI investigation workflow |
| `docs/` | Guides: maintenance and AI, and disaster recovery |

---

## Working on it (your computer)

You need **Node.js 22** and **PostgreSQL**.

1. Make the database (once):

        sudo -u postgres psql -c "CREATE USER helpdesk WITH PASSWORD 'pick-a-password';"
        sudo -u postgres psql -c "CREATE DATABASE helpdesk_db OWNER helpdesk;"

2. Settings: copy `server/.env.example` to `server/.env`, and fill in
   `DATABASE_URL` (with that password) and the `SUPER_ADMIN_*` lines
   (your first account).

3. Install, set up the database, and start:

        npm install
        cd server && npm install
        npm run db:migrate && npm run db:seed
        npm run dev

   Then, in a second terminal, in the project folder:

        npm run dev

   Open the address Vite shows (usually http://localhost:5173). It
   passes `/api` requests on to the server on port 4000.

4. Something to look at (on a test database only, never the live one):

        cd server
        npm run db:seed-examples       # example customers, tickets, rules and answers
        npm run db:demo                # 100 test tickets
        npm run db:demo -- 10000       # 10,000 tickets and 2,000 customers
        npm run db:demo -- remove      # take the test tickets out again

### Before pushing a change

    npm run lint && npm run build && (cd server && npm test)

The same checks run on GitHub on every push (CI, `.github/workflows/ci.yml`),
together with the migrations and a real server start against a test
database.

---

## On a server

### Installing on a new server

On a fresh Ubuntu or Debian server, as your normal user (not root):

    git clone https://github.com/DarmaniBenjamin/helpdesk-platform.git
    cd helpdesk-platform
    sudo bash deploy/install.sh

It installs Node.js, PostgreSQL and Caddy, makes the database with its
own password, writes `server/.env`, builds the website, starts the app as
a service (it starts again after a reboot or a crash), and adds the
`update-uplink` command. It ends by printing a **setup link**. Open it
and:

1. Make your Super Admin (email and password), then sign in.
2. **Settings → Domain & SSL:** add your domain, and point its DNS at the
   server.
3. **Settings → Backup → Copies in the cloud:** connect Backblaze.
4. **Integrations:** connect email, WhatsApp, the phone system.

Once the repository is private, the server needs its own read-only
deploy key to download it: see `docs/disaster-recovery.md`, step 1.

### Updating

    update-uplink

It updates to the latest version on GitHub, safely (`deploy/update.sh`):

- **Checks first:**
  - one update at a time
  - no files changed by hand on the server
  - CI passed for that exact version
- **Database changes:** it makes and checks a database backup first, and
  asks before a migration that deletes data.
- **No downtime:** it builds the new website beside the live one.
- **After the restart:** it checks the app (health, database, website,
  API) for a minute.
- **If anything fails,** it rolls back to the previous version by
  itself.

`update-uplink --check` says what would happen without changing anything.
Every update is written to `~/.helpdesk-deploy/history.log`.

### If the server is lost

Everything comes back from the Backblaze copies, on a new server, in
about 20 minutes: `docs/disaster-recovery.md`. Keep the **backup
password** somewhere outside the helpdesk (a password manager): without
it, the copies can't be opened.

### Logs

    sudo systemctl status helpdesk
    sudo journalctl -u helpdesk -f

---

## Maintenance and AI investigations

**Maintenance** (in the sidebar, for Admins) records every error the app
runs into, and bugs staff report. Repeats of the same error are grouped
together, and secrets and personal details are removed before anything
is stored.

**AI investigations** are optional, and set up by the Super Admin in
**Maintenance → AI & GitHub**, without editing any files:

1. **Connect GitHub:** one click; GitHub makes a private app for the
   helpdesk with only the permissions it needs.
2. **Choose the AI:**
   - **Free:** GitHub Models
   - **Claude:** an API key
   - **ChatGPT:** an API key, or Continue with ChatGPT
   - **Gemini:** an API key

   Keys go straight to GitHub, encrypted.
3. **Choose when:** automatically within daily and monthly limits, or
   only when someone presses **Investigate with AI**.

The AI runs on GitHub's machines, never on the server. The code it
proposes is tested on a separate machine with no secrets, and comes as a
pull request.

- **Merging it on GitHub is the approval.**
- `update-uplink` puts it live.
- The incident follows along: *Detected → Investigating → Awaiting
  approval → Approved → Deployed → Verified*.
- Nothing is merged or deployed automatically.

Setup and details: `docs/maintenance.md`.

---

## Settings: where they live

Almost everything is set **in the app**, by the Super Admin or Admins.
It's saved in the database, so it comes back with a restore:

- mailboxes, WhatsApp, the phone system
- domains and Backblaze
- AI & GitHub
- rules, automations and SLAs

Secrets kept in the database (mailbox passwords, keys, tokens) are
encrypted with the server's key, `server/.secret-key`, which the
Backblaze copies include.

Only the basics are in `server/.env` (see `server/.env.example`):

- the database address
- the port
- the first Super Admin
- optionally, the site's domain

It's made by the install script and never uploaded to GitHub.

---

## Useful commands

| Command | Where | What it does |
|---|---|---|
| `update-uplink` | server | Update to the latest version, safely |
| `update-uplink --check` | server | Say what an update would do, change nothing |
| `sudo bash deploy/install.sh` | server | Install everything on a new server |
| `sudo systemctl restart helpdesk` | server | Restart the app |
| `npm run dev` | project folder and `server/` | Run it on your computer |
| `npm run lint && npm run build` | project folder | Check and build the website |
| `npm test` | `server/` | Run the automated tests |
| `npm run db:demo -- 10000` | `server/` | 10,000 test tickets (test database only) |
| `npm run db:demo -- remove` | `server/` | Remove the test tickets |
