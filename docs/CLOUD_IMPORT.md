# Adding books from Google Drive, Box, or a link

**Add a book** (the More menu, ⋯) offers:

- **From this device.** On a phone this already reaches Google Drive, Box and iCloud: Android's file chooser and
  iPhone's Files app list them when their apps are installed. On a Mac, Google Drive for desktop shows Drive as a
  folder.
- **From a link.** Paste a Google Drive, Dropbox or Box share link, or any direct link to a PDF. No setup. The file
  must be shared as "Anyone with the link" (Box allows direct downloads only on some plans; use From Box instead).
- **From Google Drive** and **From Box.** These open your account's own file list. Each needs a free, one-time setup
  below; until then the option is simply not shown.

All of it is free. Nothing here costs money on any of the three services.

## Google Drive (about 10 minutes, once)

Everything happens at <https://console.cloud.google.com>, signed in with the Google account whose Drive holds your
books. Google moves its menus around now and then; the names below are what to look for.

1. **Create a project.** Project picker at the top → **New project** → name it `Scriptorium` → **Create**, then make
   sure it is selected. On the project's **Dashboard**, note the **Project number** (digits): that is
   `SCRIPTORIUM_GOOGLE_APP_ID`.
2. **Turn on two APIs.** Menu → **APIs & Services** → **Library**. Search **Google Drive API** → **Enable**. Back to the
   library, search **Google Picker API** → **Enable**.
3. **Consent screen.** **APIs & Services** → **OAuth consent screen** (may be called **Google Auth Platform**) →
   **Get started**. App name `Scriptorium`, your email for support and contact, audience **External** → create.
   Under **Data access** (or **Scopes**) add `.../auth/drive.file` ("See, edit, create, and delete only the specific
   Google Drive files you use with this app"). Under **Audience**, click **Publish app** so it stays signed in beyond
   7 days (drive.file needs no Google review).
4. **The sign-in client.** **APIs & Services** → **Credentials** → **Create credentials** → **OAuth client ID** →
   type **Web application**, name `Scriptorium`. Under **Authorized JavaScript origins** add
   `https://scriptorium.jwjeffery.org` (your exact address, no slash at the end). Leave redirect URIs empty →
   **Create**. Copy the **Client ID** (ends in `.apps.googleusercontent.com`): that is `SCRIPTORIUM_GOOGLE_CLIENT_ID`.
5. **The API key.** **Credentials** → **Create credentials** → **API key**. Then **Edit API key**: under **Application
   restrictions** choose **Websites** and add `https://scriptorium.jwjeffery.org/*`; under **API restrictions** choose
   **Restrict key** and tick **Google Picker API** → **Save**. Copy the key: that is `SCRIPTORIUM_GOOGLE_API_KEY`.
   (The key and client ID are public by design; the restrictions are what keep them yours.)

## Box (about 5 minutes, once)

At <https://app.box.com/developers/console> (sign in with your Box account; developer access is free):

1. **Create Platform App** (or **Create New App**) → **Custom App** → authentication **User Authentication (OAuth 2.0)**,
   name `Scriptorium` → create.
2. On the app's **Configuration** tab:
   - **OAuth 2.0 Redirect URI**: `https://scriptorium.jwjeffery.org/api/import/box/callback`
   - **Application Scopes**: tick **Read all files and folders stored in Box** (nothing else is needed)
   - **Save Changes**
3. Copy **Client ID** → `SCRIPTORIUM_BOX_CLIENT_ID` and **Client Secret** → `SCRIPTORIUM_BOX_CLIENT_SECRET`.
   (The secret stays on the server; keep it out of chats and screenshots.)

## Put the values on the server

```
cd /opt/scriptorium && nano .env.production
```

Add (or fill in) these lines with your values; leave a pair out to keep that option hidden:

```
SCRIPTORIUM_GOOGLE_CLIENT_ID=1234567890-abc.apps.googleusercontent.com
SCRIPTORIUM_GOOGLE_API_KEY=AIza...
SCRIPTORIUM_GOOGLE_APP_ID=1234567890
SCRIPTORIUM_BOX_CLIENT_ID=...
SCRIPTORIUM_BOX_CLIENT_SECRET=...
```

Save (Ctrl+O, Enter, Ctrl+X), then apply:

```
docker compose -f docker-compose.prod.yml --env-file .env.production up -d
```

Reload Scriptorium: **Add a book** now lists **From Google Drive** / **From Box**. The first time, Google asks you to
allow access (it asks only for the files you pick); Box asks you to sign in and grant access, then lists your
folders. **Disconnect Box** (inside From Box) deletes the Box sign-in from the server.

## How it works (for maintainers)

- Every source ends in `registerFile(file)`, the same path as a file chosen from the device.
- Link: `POST /api/import/link` → `lib/remote-fetch.ts` (public addresses only, re-checked on every redirect; 75 MB;
  must be a PDF; share links converted to download links).
- Google: `lib/google-drive-picker.ts`, entirely in the browser (Google Identity Services token with `drive.file`,
  Google Picker, download from the Drive API). The server only hands out the public client id / API key
  (`/api/import/config`). CSP allows exactly accounts.google.com, apis.google.com, the Picker frames and googleapis.
- Box: `lib/box.ts` + `/api/import/box/*`: OAuth with a state cookie, tokens in `ImportConnection` (server only;
  Box's rotating refresh token is saved on every refresh), folder listing (folders and PDFs only), download.
- Test: `scripts/e2e-add-book.mjs` drives all three in a browser against stand-ins for Box and Google's scripts;
  `scripts/verify-remote-fetch.mjs` checks the link rules and the private-address refusal.
