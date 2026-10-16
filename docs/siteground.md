# Hosting on SiteGround (Node.js Projects)

SiteGround runs Node.js apps as **Node.js Projects**: it takes the code from
GitHub (or a ZIP), builds it, and runs it, with a PostgreSQL database from
Site Tools. Uplink runs there as one Node.js app: the server starts, applies
any database updates, and serves both the website and the API.

This is instead of your own server (`deploy/install.sh` and `update-uplink`).
Those don't run on SiteGround, and neither does Caddy: SiteGround looks after
the domain and the SSL certificate itself.

## What you need

- A SiteGround plan with Node.js Projects: **GrowBig** (up to 5), **GoGeek**
  (up to 10) or **Cloud** (unlimited). **StartUp doesn't include them.**
- This repository on GitHub, and access to the SiteGround Client Area.

## 1. A branch that only gets tested code

SiteGround redeploys on **every push** to the branch it's linked to, without
waiting for the checks (CI). So link it to a separate branch, `live`, and only
move tested code there:

~~~bash
git push origin main:live
~~~

Run that once now, and again each time you want to update the live site,
after CI on `main` is green (GitHub → Actions).

## 2. The database

In SiteGround: Site Tools of any site on the account (or of the project, once
it exists) → **Site → PostgreSQL**:

1. Create a database, and a user with a strong password.
2. Give the user **all privileges** on the database.
3. Note the database name, the user, the password, and the host and port
   SiteGround shows (often `localhost` and `5432`).

Together they make the `DATABASE_URL` below:
`postgres://USER:PASSWORD@HOST:PORT/DATABASE`. If the password has symbols
like `@`, `:` or `/`, use a different password, or write those characters
encoded (`@` as `%40`).

## 3. The project

Client Area → **Websites → Node.js Projects → New Project → Import Git
repository**. Choose this repository and the `live` branch.

Then, in the project's **Site Tools → Node.js → Deployment Options**, set:

| Setting | Value |
|---|---|
| Framework preset | **Express** (or "Node.js" / "Other": anything that runs a server, **not Vite**: Vite makes it a plain website, and the server never starts) |
| Node version | **22** or newer |
| Package manager | **npm** |
| Build command | `npm run sgbuild` (builds the website and installs the server's packages) |
| Output directory | leave empty; if it must be filled in, `dist` |
| Start command (if it asks) | `npm start` |

## 4. Environment variables

In the same Deployment Options page, add:

| Name | Value |
|---|---|
| `NODE_ENV` | `production` |
| `DATABASE_URL` | from step 2 |
| `SSL_MODE` | `host` (SiteGround manages the domain and SSL) |
| `HOSTING_COMPANY` | `SiteGround` (shown on Settings → Domain & SSL) |
| `SETUP_CODE` | a long random code you make up, e.g. 30 letters and numbers: it's the key to making the first Super Admin (step 6) |
| `UPLOAD_DIR` | a folder that's **kept between deployments** (see below) + `/uploads` |
| `SECRET_KEY_FILE` | the same kept folder + `/.secret-key` |

Don't set `PORT`: SiteGround gives the app its port, and the server listens on
it by itself.

**The kept folder.** Each deployment can be a fresh copy of the code. Files
inside it, like uploaded attachments and the encryption key that locks saved
mailbox passwords and tokens, would then be lost on the next deployment.
`UPLOAD_DIR` and `SECRET_KEY_FILE` move them out of it. Ask SiteGround support
*"for a Node.js project, which folder keeps its files between deployments?"*,
or look in Site Tools → Site → File Manager for a folder outside the app's
code. If they're still inside the app's folder, the app writes a warning to
the log when it starts.

## 5. Deploy

Deploy (or push to `live` again). In Site Tools → **Node.js → Logs**, open the
newest build log. It should end with the app starting:

~~~
Server running on 0.0.0.0:<port>
~~~

If the log shows the site was built but nothing was started, the framework
preset is still a website one (like Vite): change it to Express and deploy
again.

## 6. The first Super Admin

Open `https://<the project's address>/setup/<your SETUP_CODE>` and fill it in.
That link only works while there's no Super Admin yet. Afterwards, remove the
`SETUP_CODE` variable.

## 7. Your domain and SSL

- **Domain**: Client Area → Node.js Projects → your project → change the
  domain from the temporary one to yours.
- **SSL**: the project's Site Tools → **Security → SSL Manager**, then
  **HTTPS Enforce** on.

Settings → Domain & SSL in the helpdesk just says SiteGround manages these.

## Updating

1. Push to `main` and wait for CI to be green.
2. `git push origin main:live`.

SiteGround builds and restarts the app, and the app applies any database
updates as it starts. There's no automatic backup before those (as
`update-uplink` makes), so before an update with database changes:
**Site Tools → Security → Backups → create a backup**, or run a backup from
Settings → Backups in the helpdesk.

## What works the same, and what doesn't

- Everything in the helpdesk works the same, including email, WhatsApp, the
  phone system's webhooks, live updates, backups to Backblaze/R2/S3 and AI
  investigations (those run on GitHub).
- Webhooks from other services (WhatsApp, the phone system, the backup
  gateway, GitHub) need the real domain, not the temporary one.
- Not used on SiteGround: `deploy/install.sh`, `update-uplink`
  (`deploy/update.sh`), Caddy, and the systemd service.
