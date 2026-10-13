# Maintenance: errors, AI investigations and fixes

The helpdesk records what goes wrong (**Maintenance** in the sidebar, for
Admins). If you set it up, it can also send serious errors for an **AI
investigation** on GitHub. The AI looks for the cause and, when it's
confident, proposes a fix as a **pull request** that a person reviews.
Nothing is merged or deployed automatically.

## How it works

1. **Recording** (always on): `server/src/incidents.js`, `src/errorReporter.js`.
   - Server errors, crashes, background job errors, database and health
     check failures, browser errors, and bugs staff report (profile menu →
     Report a bug).
   - Repeats are grouped, secrets and personal details are removed
     (`incidentRules.js`), and an error loop is capped.
2. **Sending for investigation** (optional): `server/src/investigations.js`.
   - Every 5 minutes, the most serious incident worth investigating becomes
     a GitHub issue labelled `ai-investigate`, within your daily and monthly
     limits. Admins can also press **Investigate with AI**.
   - The helpdesk's GitHub token can only read and write issues.
3. **The investigation**: `.github/workflows/ai-investigate.yml`, on
   GitHub's machines, never your server. It has five jobs, each on its own
   fresh machine:
   - **plan**: the AI reads the incident and the code, and proposes a fix
     as data. It has the AI key but runs no AI code.
   - **check**: applies the fix and runs lint, the build, the tests, the
     migrations, and a real server start against a throwaway Postgres. It
     has **no secrets and no write access**.
   - **revise** (if a check failed): the AI sees what failed and tries once
     more. A second **check** follows.
   - **propose**: reports on the issue. If every required check passed, it
     rebuilds the fix from the plan, checks it against the rules again,
     pushes it to an `ai-fix/...` branch and opens a pull request. It's the
     only job that can write, and it never pushes to `main`.
4. **Back in the helpdesk**: the incident shows the findings (confirmed
   vs. not proven, confidence), the checks, and links to the issue, the
   run and the pull request. Its status becomes *Awaiting approval* (a
   fix is ready) or *Fix failed* (no fix, or it failed its checks).
5. **Approval** (stage 4): a person reviews the pull request on GitHub.
   - **Merging it is the approval.** The incident becomes *Approved*,
     with who merged it and the commit, ready for the next deploy.
   - **Closing it without merging** makes it *Fix rejected*.
   - The helpdesk hears about it at once through a signed webhook, or
     within 5 minutes without one.
   - A merge by an automated account, or by someone not on
     `MAINT_APPROVERS`, is flagged on the incident.
6. **CI** (`.github/workflows/ci.yml`): the same checks run on every push
   to `main` and every pull request from a person.

### What the AI can never do

These rules are in `scripts/maintenance/policy.mjs` and tested in
`server/test/maintenancePolicy.test.js`. Nothing in an error message,
bug report or file can change them:

- **Change:** GitHub workflows, deploy scripts, packages and dependencies,
  database migrations, secrets, `.env` files, or the maintenance system
  itself. Such edits are refused.
- **Run commands or see secrets:** it only answers with data.
- **Push to `main`, merge, or deploy.**
- **Changes to sign-in, permissions, roles, sessions, backups or deleting
  data** are allowed, but labelled `sensitive-change` and must be reviewed
  line by line. They can never be approved automatically.

## Setting it up (Maintenance → AI & GitHub)

Everything is set from the helpdesk, as the Super Admin. Nothing goes in
`server/.env`, and the settings are saved in the database, so they come
back with a restore too.

### 1. Connect GitHub

Open **Maintenance → AI & GitHub**, type the repository
(`DarmaniBenjamin/helpdesk-platform`) and press **Connect GitHub**:

1. GitHub asks to create an app for this helpdesk: press **Create GitHub
   App**.
2. It asks where to install it: choose **Only select repositories**, pick
   the repository, and press **Install**.
3. You come back to the helpdesk, connected. Press **Test connection**:
   each line shows ✓, or what's missing in plain words.

The app has only what it needs, on that one repository:

- **Issues:** read and write (the investigation runs on an issue)
- **Pull requests:** read (notice when a fix is merged)
- **Checks:** read (`update-uplink` checks that CI passed)
- **Secrets:** write (store the AI's key, encrypted)

Its webhook is set up by itself, so approvals show up at once. To
disconnect, press Disconnect, then delete the app on GitHub (Settings →
Developer settings → GitHub Apps).

Under **Advanced** you can paste a fine-grained token instead, with the
same four permissions. It works the same, but without the webhook.

### 2. Let GitHub Actions open pull requests (once, on GitHub)

The one thing that has to be done on GitHub itself. Repository →
**Settings → Actions → General → Workflow permissions**:

- choose **Read and write permissions**
- tick **Allow GitHub Actions to create and approve pull requests**

### 3. Choose the AI

In **The AI**, pick one:

| AI | What to do |
|---|---|
| **Free (GitHub Models)** | Nothing. Rate-limited, and it reads less code at a time: good for small fixes. |
| **Claude** | Paste an API key from console.anthropic.com (Settings → API keys). Claude **Max** and **Team** plans include monthly API credits (Claude → Settings → Billing). **Pro** doesn't: you'd pay as you go. Anthropic doesn't allow signing in to other apps with a Claude account, so it's a key. |
| **ChatGPT** | Paste an API key from platform.openai.com, or use **Continue with ChatGPT** to run on a Plus or Pro plan. For that, OpenAI has to give this helpdesk a client first: request one for "Sign in with ChatGPT" with plan usage, and give them the callback address shown on the page. Then paste the client ID, save, and press Continue with ChatGPT. |
| **Gemini** | Paste an API key from aistudio.google.com (it has a free tier). |

The key goes **straight to GitHub as an encrypted secret**. The helpdesk
doesn't keep it, and nobody can read it back: the page only shows
whether one is saved. The **Model** box is optional; empty means the
default shown.

To cap spending, also set a monthly limit in the AI company's own
console.

### 4. When to investigate

- **Investigate serious errors by themselves:** off means only when
  someone presses Investigate with AI.
- **Limits:** a daily limit for automatic investigations, and a monthly
  limit that counts the button too.
- **Allow a public repository (testing only):** issues on a public
  repository can be read by anyone. Only use it for test bugs, and turn
  it off once the repository is private.
- **Approvers:** GitHub usernames whose merge counts as approval. A merge
  by anyone else is still recorded, but flagged.

Press **Save**.

### 5. Try it

Report a test bug (profile menu → Report a bug), open it on the
Maintenance page and press **Investigate with AI**. Watch the run in the
repository's **Actions** tab. Within a few minutes of it finishing, the
findings appear on the incident.

### Older setups

The `MAINT_*` lines in `server/.env` from earlier versions still work
until GitHub is connected on the page. After that they're not needed.

### Protect main (recommended)

On a paid GitHub plan (GitHub Pro, about $4 a month, is enough for a
personal account), add a rule on **Settings → Branches** for `main`:

- require a pull request
- require the **CI** check to pass

Then nobody, the AI included, can change `main` without a reviewed pull
request. On the free plan GitHub can't enforce this on private
repositories. The AI still never pushes to `main`, and its token can't
merge anything.

## Low-risk fixes and automatic approval (off)

A fix is labelled `low-risk` only if all of these hold:

- it's the first attempt
- the AI is highly confident
- every check passed
- it isn't a sensitive change
- it touches at most 3 files, and 60 changed lines
- it only touches the app's own source and tests

The rule is in `policy.mjs` (`lowRisk`), and tested.

**Today it's only a label: every fix still needs a person to merge it.**
Allowing low-risk fixes to merge by themselves would also need:

- branch protection with required checks (a paid GitHub plan)
- a GitHub App, so that CI runs on the AI's pull requests (GitHub doesn't
  let one workflow start another)

Sensitive changes can never be approved automatically, whatever is set
up.

## Deploying: update-uplink (stage 5)

On the server, `update-uplink` runs `deploy/update.sh`. It goes ahead
only if it's safe, and puts the old version back if the new one doesn't
work:

1. **One update at a time** (a lock).
2. **Checks first:**
   - no files changed by hand on the server
   - GitHub's `main` follows on from the running version
   - **CI passed** for that exact commit, using the GitHub connection
     from Maintenance → AI & GitHub. Without one, you're asked whether to
     go on.
3. **With a database migration in the update:**
   - one that edits an old migration is refused
   - one that deletes or reshapes data needs you to type yes
   - it makes a **database backup** first, and checks it can be read back
     (in `~/.helpdesk-deploy/backups`, the last 5 kept; the Backblaze
     copies aren't touched)
4. **Builds the new website beside the live one,** so the site keeps
   working until the switch.
5. **Restarts, and checks for a minute:**
   - the health check, with the database connected
   - the website and the API answer
   - no crashes
   - fewer than 10 errors
6. **If anything fails,** it rolls back: the previous code and website,
   restarted and checked.
   - It never undoes database changes by itself, since restoring would
     delete what was written since.
   - If a migration ran, it prints the exact commands to restore the
     backup it made, if the previous version doesn't work with it.
     Migrations only add things, so usually it does.
7. **On the Maintenance page:**
   - approved fixes in the update become *Deployed*
   - after 7 days without their error (`MAINT_VERIFY_DAYS`), *Verified*
   - if the update was rolled back, *Rolled back*

Options:

- `--check`: say what would happen, change nothing
- `--backup`: back up even without a migration
- `--yes`: don't ask when CI can't be checked (a failed CI still stops it)
- `--skip-ci`: deploy although CI failed, after typing yes

Every update and rollback is written to `~/.helpdesk-deploy/history.log`.

## Costs and limits

- **Investigations:** at most `MAINT_MAX_PER_DAY` automatic ones a day,
  and `MAINT_MAX_PER_MONTH` in total (the button included).
- **Per investigation:** at most 4 AI requests per job, and 2 attempts at
  a fix.
- **GitHub Actions:** an investigation uses roughly 10–20 minutes. Private
  repositories on the free plan get 2,000 minutes a month.
- **If the AI or GitHub is down:** the helpdesk keeps working. The
  incident is marked *Fix failed* after 2 hours, and can be sent again.

## Turning it off

Maintenance → AI & GitHub → **Disconnect** (and delete the app on
GitHub if you're done with it). Errors are still recorded; nothing is
sent anywhere.
