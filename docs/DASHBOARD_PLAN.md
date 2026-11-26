# Dashboard plan (apps/dashboard)

A personal dashboard for jwjeffery.org: one page for the demands of life and work.
It is a separate app in this repository. Scriptorium is one link on it. It shares no
database or login with Scriptorium.

## Status

Live at https://dashboard.jwjeffery.org: sign-in gate, Today page, cards for Calendar, Email, Daily Office,
To-do and Scriptorium. Scriptorium's link is live. The Calendar card is built (read-only Google sign-in,
events grouped by day in DASHBOARD_TIMEZONE, a 24-hour heads-up) and needs the Google setup below.

Run locally (from the repo root):

    DASHBOARD_AUTH_USER=me DASHBOARD_AUTH_PASSWORD=pick-one pnpm --filter @scriptorium/dashboard dev

then open http://localhost:3001.

Settings (environment variables): DASHBOARD_AUTH_USER, DASHBOARD_AUTH_PASSWORD,
DASHBOARD_SESSION_SECRET (optional), DASHBOARD_SCRIPTORIUM_URL, DASHBOARD_TIMEZONE.
In production the app refuses to serve anything if the user and password are unset.

## How it is built

Each card is a widget (`lib/widgets/`) that reports one source as ready,
not-connected (with the missing setup step) or error. Widgets load independently,
so one failing source never breaks the page.

## Decisions so far

- To-dos live in AI-assistant threads (Claude Project "PA", ChatGPT), which cannot be
  read from outside. So the dashboard will own a small task store and expose it as an
  MCP server that both Claude and ChatGPT connect to. Claude custom connectors need an
  HTTPS URL on the standard port plus OAuth or a bearer token. ChatGPT needs Developer
  mode; whether Plus/Pro get write access must be checked against OpenAI's current plan page.
- Daily Office readings come from the 1979 Book of Common Prayer only. The Orthocal
  data (Eastern Orthodox) is not used for readings.
- Gmail, Google Calendar and Spacemail connectors available in Claude sessions do not
  travel with the deployed app. The dashboard needs its own credentials: a Google Cloud
  OAuth client (read-only Gmail and Calendar scopes) and an IMAP login for Spacemail.

## Next slices

1. (built, needs the Google setup below) Google Calendar widget and heads-up. Refinement to come: what counts as "important" (colour, keyword).
2. Gmail + Spacemail "important email" widget.
3. Task store + MCP server (Claude and ChatGPT).
4. Daily Office from the 1979 BCP.
5. Universal Office stats and the Anglican Synaxarium workflow.
6. Social media messages (most platforms have no usable personal-message API; research first).

## Deployment (dashboard.jwjeffery.org)

Added: `Dockerfile.dashboard`, a `dashboard` service in `docker-compose.prod.yml`, a Caddy block in
`deploy/Caddyfile`, and DASHBOARD_* lines in `.env.production.example`. The DNS record
(`dashboard` A 104.207.80.207) is already in place.

On the server, BEFORE running the update, add these lines to `/opt/scriptorium/.env.production`
(pick your own user name and a long password):

    DASHBOARD_DOMAIN=dashboard.jwjeffery.org
    DASHBOARD_AUTH_USER=...
    DASHBOARD_AUTH_PASSWORD=...

Then update the usual way (`./deploy/update.sh`, which only runs from `main`, so this branch must be
merged first). Docker then builds the dashboard, Caddy fetches its HTTPS certificate on its own,
and Scriptorium keeps running throughout. Caddy does not wait for the dashboard, so a dashboard
fault cannot take Scriptorium offline.

Tested without Docker (none in the cloud session): the compose file validates, a missing setting
stops with a clear message, and the image's exact install/build/start steps work in a clean folder,
including the health check. The Caddy block and the real image build have not been run.

## Google setup for the Calendar card (one time, free)

The dashboard asks Google for READ-ONLY access and stores only the long-lived sign-in, encrypted, in a
Docker volume (`dashboard-data`). Gmail will reuse the same sign-in later.

1. console.cloud.google.com: create a project (any name, e.g. "Dashboard").
2. APIs & Services > Library: enable **Google Calendar API**.
3. Google Auth Platform (OAuth consent screen): User type **External**; app name "Dashboard"; your email as
   support and developer contact. Add the scope `.../auth/calendar.readonly`.
4. **Publish the app ("In production").** Left in "Testing", Google cancels the sign-in every 7 days. For an
   app only you use, "In production" just shows an "unverified app" warning once; choose Advanced > continue.
5. Clients > Create client > **Web application**. Authorized redirect URI, exactly:
   `https://dashboard.jwjeffery.org/api/google/callback`
6. Copy the Client ID and Client secret into `/opt/scriptorium/.env.production` as
   `DASHBOARD_GOOGLE_CLIENT_ID` and `DASHBOARD_GOOGLE_CLIENT_SECRET`, then run `./deploy/update.sh`.
7. Open the dashboard and press **Connect Google Calendar**.

Notes: if the dashboard password changes and `DASHBOARD_ENCRYPTION_KEY` is not set, reconnect Google once.
Unverified: whether Google keeps the refresh token permanent for an unverified app in production; if the card
ever says "Connect again", that is the cause to look at first.
