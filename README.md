# Uplink — Helpdesk Platform

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
  tickets carry on after the last one (#8123 → #8124). Deleting the newest
  ticket frees its number again.
- **SLAs:** each priority has first-reply and resolve targets, which set
  the due times on every ticket. Due-soon and overdue tickets are flagged.
- **Ticket Review:** where Admins check finished tickets and mark them
  reviewed.
- **Ratings:** customers rate finished tickets from a "how did we do?"
  link. The person who has the ticket is told about each rating (and the
  Admins too, for 2 stars or less).
- **Closing a ticket:** the customer gets an email with the ticket number
  and title a minute later (on/off in Integrations → Email), and a
  "Tell them on WhatsApp" button opens WhatsApp with the message ready.

### Where tickets come from (Integrations)

- **Website form:** a public request form, which can also be embedded on
  your company website.
- **Email:** connect mailboxes with Sign in with Microsoft, or Sign in
  with email (any IMAP/SMTP mailbox). Emails become tickets, and replies
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
- **Backup alerts:** alerts from the backup gateway go to the **Alerts**
  page (critical ones also make a ticket).

### Customers

- **Customers:** people and businesses, with their emails, phone numbers
  and ticket history.
- **Customer portal:** customers can sign in to see their tickets, reply,
  and send new requests.
- **Billing in QuickBooks Online:** tick **Bill in QuickBooks** when adding
  a ticket (or later, on the ticket; Admins only). When the ticket is
  closed, a **draft** invoice is made in QuickBooks for that customer
  (matched by email or name, or added), with the ticket number, title and
  the fix from the notes, on one $0.00 line. Nothing is sent to the
  customer: open it in QuickBooks (the ticket links to it), add the hours,
  parts and prices, and send it from there. Set up in
  **Integrations → QuickBooks Online**.

### Alerts

- **Alerts page:** problems other systems report (today the backup gateway:
  malware, computers that stop checking in, failing off-site copies, a disk
  filling up), instead of tickets in the Inbox. So they don't take ticket
  numbers or count in the reports. Everyone on staff sees it, with a count
  of open alerts in the sidebar.
- **One alert per problem, per device:** repeats are counted on it, and it
  resolves itself when the system says it's back to normal.
- **Open → someone's on it → resolved,** with the full history of each.
- **Critical alerts also make a ticket by themselves;** others with
  **Make a ticket**. High and critical alerts notify the backup alerts'
  team (Integrations → Backup alerts), or everyone on staff.
- **A customer's latest alerts** show on their page.

### The team

- **Team:** invite staff and set their roles and teams (departments).
- **Ticket Assignment:** rules that assign new tickets to the right person
  or team.
- **Automation:** automations that act on tickets by themselves (for
  example "no reply for 24 hours").
- **Calendar:** jobs booked for a time (a site visit, a remote session, a
  call), done by one or more agents, usually for a ticket.
- **Knowledge Base:** saved answers (a problem and how it was fixed),
  written by hand or saved from any note or reply. When a ticket is
  resolved or closed, a box asks to save the fix (filled in from the
  ticket's notes), so it isn't forgotten; the notes stay on the ticket.
- **Reminders:** everyone on the team sees them; Admins make them, with
  or without a time, once or repeating, for everyone or chosen people,
  who get a notification when one is due.
- **Performance & Feedback**, and **Report and Statistics:** response
  times, SLA results, ratings, and where tickets come from.
- **Notifications:** the bell in the top bar, and real desktop and phone
  notifications. Every open tab updates live, without reloading.

### Running it

- **Settings → Domain & SSL:** your own domain, with a free certificate
  from Let's Encrypt (through Caddy, set up by the app itself).
- **Settings → Backup & Restore:**
  - backups of everything, and restoring
  - encrypted copies in Backblaze B2, made by themselves about half a
    minute after any change (at most one every 2 minutes)
  - old versions thinned out by themselves: every copy for 6 hours, then
    one an hour for 48 hours, one a day for 30 days, one a week for 3
    months
- **Settings → Import from Freshdesk:** brings customers and tickets over
  from Freshdesk.
- **Maintenance:** every error the app runs into, and bugs staff report
  (profile menu → Report a bug), as incidents. Optionally, an AI
  investigates serious ones on GitHub and proposes a fix as a pull
  request for a person to approve (see below).

### Safety

- **Important actions need a 6-digit code** emailed to the person doing
  them (or their password while no company mailbox is connected):
  removing someone, changing access, deleting a customer, restoring a
  backup, and changing integrations, domains or AI & GitHub. After one
  code, others in the next 10 minutes don't ask again.
- Sign-in is slowed after wrong passwords, changes can only come from the
  site's own pages, and every database query uses parameters (no SQL
  injection).

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

There are two ways to host it: **SiteGround** (what's used now, see
[Setting it up on SiteGround](#setting-it-up-on-siteground)), or your own
Ubuntu/Debian server (below).

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

## Setting it up on SiteGround

SiteGround's **Node.js Projects** run the whole of Uplink in one place: the
website, the server and the database. SiteGround takes the code from
GitHub, builds it, and starts it. The server then makes and updates the
database tables by itself. SiteGround looks after the domain and the SSL
certificate, so `deploy/install.sh`, `update-uplink` and Caddy aren't used
there.

It takes about 30 minutes the first time. Do the steps in order.

### What you need

- A SiteGround plan with Node.js Projects: **GrowBig** (up to 5
  projects), **GoGeek** (up to 10) or **Cloud**. StartUp doesn't have
  them.
- Access to this repository on GitHub (it's private).
- A **`live` branch** in the repository. SiteGround is linked to it, and
  rebuilds the site on every push to it, so only tested code goes there.
  Make it once, from your computer:

      git checkout main
      git pull origin main
      git push origin main:live

- Somewhere safe to write down passwords (a password manager).
- If you're moving an existing helpdesk: your Backblaze details and the
  **backup password** (step 9).

### Step 1. Make the Node.js project

1. SiteGround **Client Area → Websites → Node.js Projects → New
   Project** (top right).
2. Choose **Import Git repository → Continue**.
3. The first time, GitHub asks you to authorize the **SiteGround** app.
   Choose **Only select repositories → helpdesk-platform**, so SiteGround
   can't see your other repositories. Each GitHub account can have this
   app linked to one SiteGround Client Area only.
4. Pick **helpdesk-platform** from the list (not there? use **Missing a
   repository? → Click here**), then **Continue**.
5. The first build may fail or show "The helpdesk is starting": that's
   expected, because there's no database yet. Click **Go to Site Tools**.

Keep the project's **temporary address** SiteGround shows (something like
`https://abcd1.sg-host.com`). It's used until your own domain is connected
in step 7.

### Step 2. Make the PostgreSQL database

Uplink needs **PostgreSQL**, not MySQL. In the project's **Site Tools →
Site → PostgreSQL**:

1. **Databases** tab → **Create Database**. Write down its full name
   exactly as shown (SiteGround often adds a prefix, e.g. `db7xk2q1`).
2. **Users** tab → **Create User**. Let it generate a long password, or
   type one, and write down the user name and password.
3. Still on **Users**: click **Add New Database** next to the user,
   choose the database, **Confirm**.
4. Click the database icon next to the user → **Manage Access** → give it
   **all privileges** → save.

You don't need **Remote** access: the app connects from the same server.
If SiteGround doesn't let the user make tables in the database's usual
area (`public`), the server notices and uses an area of its own called
`uplink` instead.

### Step 3. Deployment settings

**Site Tools → Node.js → Deployment Options → Settings**:

| Setting | Value |
|---|---|
| Framework preset | **Express** (or "Node.js" / "Other"). **Not Vite:** Vite only publishes the website and never starts the server, so nothing would work. |
| Branch | **live** |
| Node version | **22** or newer |
| Package manager | **npm** |
| Build command | `npm run sgbuild` |
| Output directory | leave empty (if it must be filled in: `dist`) |
| Start command (if asked) | `npm start` |

### Step 4. Environment variables

Same page, **Environment variables**. Add each one (name on the left,
value on the right):

| Name | Value | Needed? |
|---|---|---|
| `HOSTING` | `siteground` | Yes |
| `DB_NAME` | the database's full name from step 2 | Yes |
| `DB_USER` | the user's full name from step 2 | Yes |
| `DB_PASSWORD` | that user's password (any symbols are fine) | Yes |
| `DB_HOST` | only if SiteGround shows something other than `localhost` | Usually no |
| `DB_PORT` | only if it isn't `5432` | Usually no |
| `SUPER_ADMIN_NAME` | your full name | For step 6, option A |
| `SUPER_ADMIN_EMAIL` | the email you'll sign in with | For step 6, option A |
| `SUPER_ADMIN_PASSWORD` | a strong password, at least 8 characters | For step 6, option A |
| `TIMEZONE` | `America/Grenada` (the default; change it if you move) | No |
| `SHOW_ERRORS` | `on`, only while setting up (step 5), then remove | No |

Don't add `PORT`: SiteGround gives it.

What `HOSTING=siteground` does by itself:

- turns on production mode (secure cookies, no error details shown)
- shows "SiteGround manages the domain and SSL" in Settings → Domain & SSL
- keeps attached files, saved backups and the secret key in your
  account's home folder, **`~/uplink-data`**, outside the app's code, so a
  new deployment never removes them. To use another folder, set
  `DATA_DIR`.

### Step 5. Deploy and check it's running

1. Deploy again: push to `live` from your computer (or use the project's
   deploy/redeploy option).

       git push origin main:live

2. **Site Tools → Node.js → Logs** → the newest entry → **View build
   log**. A good start ends with:

       ✓ Database is up to date
       ✓ Departments: 4
       ✓ Super Admin created: you@example.com
       Server running on 0.0.0.0:<port>

3. Open `https://<the project's address>/api/health`:

| What it shows | What it means | What to do |
|---|---|---|
| `{"server":"ok","database":"connected"}` | All good | Go to step 6 |
| `"database":"not connected"` | The server runs but can't reach the database | Add `SHOW_ERRORS=on` and reload: it says why in plain words (wrong password, no database with that name, it's MySQL...). Fix the variable and redeploy. It also tries again by itself every 30 seconds. Remove `SHOW_ERRORS` when it works. |
| Nothing answers / an error page | The server isn't being started | Check the framework preset isn't Vite, the build command is `npm run sgbuild`, and the build log for red errors |

### Step 6. The first Super Admin

Pick one of these:

- **Option A (easiest): with the variables from step 4.** The account
  was made when the server started ("Super Admin created" in the log).
  Open the site and sign in with `SUPER_ADMIN_EMAIL` and
  `SUPER_ADMIN_PASSWORD`. Then **delete the `SUPER_ADMIN_PASSWORD`
  variable**: it's only used to make the account once, and you change
  your password in the app (My profile) from now on.
- **Option B: a one-time setup link.** Instead of the `SUPER_ADMIN_*`
  variables, add `SETUP_CODE` with a long random code you make up (30+
  letters and numbers), redeploy, and open
  `https://<the project's address>/setup/<that code>`. Make your account
  there, then delete the `SETUP_CODE` variable. The link only works
  while there's no Super Admin.

### Step 7. Your own domain and SSL

1. **Client Area → Websites → Node.js Projects →** your project's menu →
   change its domain from the temporary one to yours (e.g.
   `help.protonicsolutions.com`).
2. DNS:
   - **Domain on SiteGround's nameservers:** SiteGround points it, and
     installs the SSL certificate by itself.
   - **Domain elsewhere (e.g. only an A record):** point the record at
     the IP SiteGround shows. The certificate may not be installed by
     itself then: in **Site Tools → Security → SSL Manager**, install a
     free Let's Encrypt certificate for the domain (or ask SiteGround
     support).
3. **Site Tools → Security → HTTPS Enforce** → on.
4. Open `https://<your domain>/api/health` again to check.

Webhooks from other services (WhatsApp, the phone system, the backup
gateway, GitHub) need your real domain, not the temporary one. Email from
SiteGround doesn't work on the temporary domain either.

### Step 8. Set it up in the app

Signed in as the Super Admin:

1. **Integrations → Email:** connect the **company mailbox** (Sign in with
   Microsoft, or Sign in with email) and make it the company mailbox.
   Invites, password resets, ticket emails, and the 6-digit codes for
   important actions are sent from it. Until it's connected, important
   actions ask for your password instead of a code.
2. **Settings → Backup & Restore → Copies in the cloud:** connect
   Backblaze and choose a **backup password**. Keep the password in your
   password manager, outside the helpdesk: without it the copies can't be
   opened.
3. **Team:** add your departments, then invite your Admins and agents.
4. Optional: **Integrations → WhatsApp / Phone**, and **Settings → Import
   from Freshdesk**.
   For **Integrations → QuickBooks Online**: make a free app at
   developer.intuit.com (QuickBooks Online and Payments, Accounting
   scope), add the Redirect URI the card shows
   (`https://your-domain/api/quickbooks/callback`), and paste its Client ID
   and Client Secret into the card. Development keys connect a test
   (sandbox) company; the Production keys, for your real company, come
   after Intuit approves the app (their questionnaire, usually 1–3
   weeks).
5. Allow notifications when the browser asks, on each computer and phone.

### Step 9. Moving an existing helpdesk (restoring from Backblaze)

Do steps 1 to 7 on the new SiteGround project (make a temporary Super
Admin in step 6), then:

1. **Settings → Backup & Restore → Copies in the cloud:** enter the same
   Backblaze details and the **backup password** you used before.
2. Press **Restore** on the newest copy. Type the code emailed to you (or
   your password) when asked.
3. Everything comes back: tickets, customers, the team, settings,
   attachments, and the secret key that unlocks mailbox passwords. The
   temporary Super Admin is replaced by the real one from the backup;
   everyone signs in again.

### Updating it later

Work on `main`, then send it live. SiteGround rebuilds by itself on every
push to `live`:

    git push origin main
    git checkout live
    git merge main
    git push origin live
    git checkout main

- The server applies any database changes as it starts.
- Before an update that changes the database, make a backup first
  (**Settings → Backup & Restore → Back up now**, or **Site Tools →
  Security → Backups**).
- To stop SiteGround deploying for a while: **Site Tools → Node.js →
  Deployment Options →** menu **→ Pause**.

### Where things are kept on SiteGround

| What | Where |
|---|---|
| The code | SiteGround's copy of the `live` branch (replaced on every deployment) |
| The database | Site Tools → Site → PostgreSQL |
| Attached files, saved backups, the secret key | `~/uplink-data` in your SiteGround account (kept between deployments) |
| Settings, mailboxes, integrations | In the database (they come back with a restore) |
| Off-site copies | Backblaze, locked with your backup password |

### If something goes wrong

| Problem | Fix |
|---|---|
| `/api/health` says the database isn't connected | Step 5: add `SHOW_ERRORS=on` to see why, fix the `DB_*` variables, redeploy |
| "Couldn't reach the database" | `DB_HOST` and `DB_PORT` (usually `localhost` and `5432`, so leave them out) |
| "The database user isn't allowed to make tables" | Step 2.4: give the user all privileges |
| The site loads but every page is blank or "Not found" | The framework preset is Vite: change it to Express and redeploy |
| Can't sign in: "Too many wrong passwords" | Wait 15 minutes (it's protection against guessing) |
| No emails go out (invites, codes, resets) | Connect the company mailbox (step 8.1), and use your real domain, not the temporary one |
| The 6-digit code doesn't arrive | Check spam, then press **Send a new code**. If there's no company mailbox yet, it asks for your password instead |
| A deployment broke something | Push the previous good version to `live` again (`git push origin <old commit>:live --force`) or restore a backup |
| The server lost the secret key (mailboxes say "Sign in again") | Restore from a Backblaze copy (it includes the key), or reconnect each mailbox |

### Checklist

- [ ] `live` branch made and pushed
- [ ] Node.js project made from the GitHub repository
- [ ] PostgreSQL database and user made, with all privileges
- [ ] Deployment settings: Express, branch `live`, Node 22, `npm run sgbuild`
- [ ] Environment variables: `HOSTING`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`, and the Super Admin ones
- [ ] `/api/health` says `connected`
- [ ] Signed in as the Super Admin, and `SUPER_ADMIN_PASSWORD` (or `SETUP_CODE`) deleted
- [ ] Own domain connected, SSL on, HTTPS Enforce on
- [ ] Company mailbox connected
- [ ] Backblaze copies on, backup password saved in a password manager
- [ ] Team invited

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
