# Hosting on SiteGround (Node.js Projects)

SiteGround runs Uplink as one **Node.js Project**: it takes the code from
GitHub, builds it, and runs `npm start`. The server then updates the
database by itself and serves both the website and the API on the port
SiteGround gives it. SiteGround looks after the domain and the SSL
certificate, so `deploy/install.sh`, `update-uplink` and Caddy aren't used.

You need a plan with Node.js Projects (**GrowBig**, **GoGeek** or **Cloud**;
StartUp doesn't have them).

## 1. The database (PostgreSQL, not MySQL)

Uplink only works with **PostgreSQL**. In Site Tools → **Site →
PostgreSQL**:

1. Create a database.
2. Create a user with a password, and add it to the database with **all
   privileges**.
3. Keep the database name, user name and password (the full names, as
   SiteGround shows them, often with a prefix).

That's all. If SiteGround doesn't let the user make tables in the
database's usual area ("public"), the server notices and puts them in an
area of their own called `uplink` instead, by itself.

## 2. The project

Client Area → **Websites → Node.js Projects → New Project → Import Git
repository** → this repository and the `live` branch (step 5 says why).

In the project's Site Tools → **Node.js → Deployment Options**:

| Setting | Value |
|---|---|
| Framework preset | **Express** (or "Node.js" / "Other", anything that runs a server; **not** Vite, which only publishes the website and never starts the server) |
| Node version | **22** or newer |
| Package manager | **npm** |
| Build command | `npm run sgbuild` |
| Output directory | leave empty (if it must be filled in: `dist`) |
| Start command (if it asks) | `npm start` |

## 3. Environment variables

Same page, **Environment variables**:

| Name | Value |
|---|---|
| `HOSTING` | `siteground` |
| `DB_NAME` | the database name from step 1 |
| `DB_USER` | the user name from step 1 |
| `DB_PASSWORD` | its password (any symbols are fine) |
| `DB_HOST` | only if SiteGround shows something other than `localhost` |
| `DB_PORT` | only if it isn't `5432` |
| `SETUP_CODE` | a long random code you make up (30+ letters and numbers): the key to making the first Super Admin |

Don't set `PORT` (SiteGround gives it).

`HOSTING=siteground` also sets, by itself: production mode, Settings →
Domain & SSL saying SiteGround manages the domain, and a folder for
attached files, backups and the secret key in your account's home folder
(`~/uplink-data`), so new deployments don't remove them. To put it
somewhere else, set `DATA_DIR` to that folder.

(The same settings can go in a `.env` file in the `server` folder instead,
see `server/.env.example`, but a new deployment can replace the app's
folder, so the panel is the safer place.)

## 4. Deploy and check

Deploy. In Site Tools → **Node.js → Logs**, the newest log should end with:

~~~
✓ Database is up to date
...
Server running on 0.0.0.0:<port>
~~~

Then open `https://<the project's address>/api/health`:

- `{"server":"ok","database":"connected"}`: all good.
- `"database":"not connected"`: the reason is in Site Tools → Statistics →
  Error Log (wrong password, no database with that name, not
  PostgreSQL...). To see it on the page instead while you set things up,
  add `SHOW_ERRORS=on`, and remove it once it works. Fix the variable and
  restart/redeploy; it also tries again by itself every 30 seconds.
- Nothing answers at all: the server isn't being started. Check the
  framework preset isn't Vite, and the build log for errors.

## 5. The first Super Admin, domain and SSL

1. Open `https://<the project's address>/setup/<your SETUP_CODE>` and make
   the Super Admin. Then remove the `SETUP_CODE` variable.
2. Domain: Client Area → Node.js Projects → your project → change the
   domain from the temporary one to yours.
3. SSL: Site Tools → **Security → SSL Manager**, then **HTTPS Enforce** on.

Webhooks from other services (WhatsApp, the phone system, the backup
gateway, GitHub) need the real domain, not the temporary one.

## Updating

SiteGround redeploys on **every push** to the branch it's linked to, so it's
linked to `live`, and only tested code goes there:

~~~bash
git push origin main        # wait for the checks to be green (GitHub → Actions)
git push origin main:live   # SiteGround builds and restarts with it
~~~

The server applies database changes as it starts. Before an update with
database changes, make a backup first: Settings → Backups in the helpdesk,
or Site Tools → Security → Backups.
