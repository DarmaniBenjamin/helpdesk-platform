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

## Setting it up

### 1. Make the repository private (required)

Incidents are never sent to a public repository. Before you switch it
to private, give the server its own read-only **deploy key**, or
`update-uplink` stops working (see the steps in the chat, or Stage 5's
install script).

### 2. Let GitHub Actions open pull requests

Repository → **Settings → Actions → General → Workflow permissions**:

- choose **Read and write permissions**
- tick **Allow GitHub Actions to create and approve pull requests**

The workflow itself limits each job to what it needs. Only the last job
can write.

### 3. Choose the AI

Repository → **Settings → Secrets and variables → Actions**:

| What you want | Set |
|---|---|
| **Free**: GitHub Models | Nothing. It's the default when there's no Anthropic key. Rate-limited, and it takes less code per request, so it suits small fixes. |
| **Claude** (better for real fixes) | Secret `ANTHROPIC_API_KEY`, from console.anthropic.com. Claude **Max** and **Team** plans include monthly API credits: claim them in Claude → Settings → Billing → API credits, linked to the same Console organization. **Pro** doesn't include API credits: you'd pay as you go. |

Optional **variables**:

- `MAINT_AI_PROVIDER`: `auto` (default), `anthropic` or `github`
- `MAINT_AI_MODEL`: e.g. `claude-sonnet-5-5`, or `openai/gpt-4.1` on GitHub Models
- `MAINT_MAX_ATTEMPTS`: `2` (default) or `1`

To cap spending, set a monthly **spend limit** in the Claude Console too.

### 4. Give the helpdesk an issues-only token

GitHub → your picture → **Settings → Developer settings → Fine-grained
tokens → Generate new token**:

- **Repository access:** only this repository
- **Permissions → Repository → Issues:** Read and write (Metadata: Read
  is added by itself). Nothing else.
- **Expiration:** up to a year. Set a reminder to renew it.

Then, in `server/.env` on the server:

    MAINT_GITHUB_REPO=DarmaniBenjamin/helpdesk-platform
    MAINT_GITHUB_TOKEN=github_pat_...
    MAINT_AUTO_INVESTIGATE=on
    MAINT_MAX_PER_DAY=3
    MAINT_MAX_PER_MONTH=20

and restart: `sudo systemctl restart helpdesk`. The Maintenance page
then says "AI investigations are on".

### 5. Try it

Open an incident on the Maintenance page and press **Investigate with
AI**. Watch the run in the repository's **Actions** tab. Within a few
minutes of it finishing, the findings appear on the incident.

### 6. Approvals: the webhook (recommended)

So the helpdesk hears at once when a fix is merged or closed:

1. Make a secret: run `openssl rand -hex 32` and copy the result.
2. In `server/.env`, add `MAINT_GITHUB_WEBHOOK_SECRET=` followed by that
   secret, then restart.
3. Repository → **Settings → Webhooks → Add webhook**:
   - **Payload URL:** `https://YOUR-HELPDESK-DOMAIN/api/maintenance/github-webhook`
   - **Content type:** `application/json`
   - **Secret:** the same secret
   - **Which events:** *Let me select individual events*, then tick
     **Pull requests**, **Pull request reviews** and **Issue comments**
     (untick Pushes).

GitHub sends a test "ping" straight away. A green tick next to the
webhook means the helpdesk got it.

Without the webhook, the helpdesk checks GitHub every 5 minutes. For
that, the helpdesk's token needs **Pull requests: Read-only** as well
as Issues.

Optional: `MAINT_APPROVERS=yourlogin,colleaguelogin` in `server/.env`.
A merge by anyone else is still recorded, but flagged on the incident.

### 7. Protect main (recommended)

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

Empty `MAINT_GITHUB_TOKEN` in `server/.env` and restart. Errors are still
recorded; nothing is sent anywhere.
