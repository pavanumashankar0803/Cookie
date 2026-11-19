# Cookie Testing Playground

This is a small website with realistic **fake** cookies for testing an external Cookie Management Platform (CMP).

## How it works with scanners

A cookie scanner visits the site with its own, fresh browser, so it never sees *your* browser's cookies.
To make scans match what you do in the UI, the server keeps a **site cookie profile**: the list of cookies the website sets for every visitor.

| You do this in the UI | Your browser | Next scan |
|---|---|---|
| Add / generate a cookie | cookie created | sees the cookie |
| Edit name / value / attributes | cookie updated | sees the new version |
| Delete a cookie | cookie removed | cookie no longer set |
| Delete All | all removed | site sets no cookies |
| Reset to defaults | defaults restored | sees the defaults again |

Each cookie in the profile is set in one of two ways:
- **server**: a `Set-Cookie` header on every page load. This is required for HttpOnly cookies. A scanner sees these even without running JavaScript.
- **script**: page JavaScript (`document.cookie`) on every page load. This is how analytics and advertising tags work, and it's what a CMP can block before consent. If something blocks it, the table shows *not in browser*.

By default, Necessary and HttpOnly cookies are server-set, and Analytics, Advertisement, Functional and most Uncategorized cookies are script-set.

## Run locally
```bash
node server.js          # Node 18+, no npm install. Open http://localhost:3000
```

## Hosting (HTTPS) — recommended: GitHub + Render
GitHub Pages **can't** run this app properly. It only serves static files, so there would be no HttpOnly or server-set cookies, and your edits couldn't reach scanners.
Host the Node server instead. GitHub stays your code repository, and GitHub Actions checks every push.

1. Push this folder to a GitHub repository.
2. Go to [render.com](https://render.com), choose **New → Blueprint** and pick the repo. `render.yaml` configures everything.
3. You get `https://cookie-testing-playground.onrender.com`, or a similar address, with HTTPS.
4. In Render, open the service, go to **Environment** and copy the generated `ADMIN_TOKEN`. The page asks for it the first time you change a cookie, so strangers can't change your test site.
5. Point your Cookie Manager's scanner at that URL.

### Know the free-plan limits
- **It sleeps after 15 minutes idle.** The first request then takes about a minute. Open the site yourself before you start a scan, or use a paid instance.
- **Your UI edits are lost when the server restarts.** On restart it goes back to `site-cookies.json`. To keep a set of cookies permanently, either:
  - click **Export**, replace `site-cookies.json` in the repo with the downloaded file, and push. It becomes the new default, and the next deploy uses it.
  - or use a paid instance with a disk, and set `PROFILE_FILE=/var/data/profile.json` (see the comments in `render.yaml`).

Other hosts work the same way: Railway, Fly.io, a VPS with Docker (`docker run -p 3000:3000 -v cookie-data:/data …`), Azure App Service, and so on.
Set `TRUST_PROXY=1` when HTTPS is handled by a proxy in front of the app.

### GitHub Actions
`.github/workflows/deploy.yml` runs on every push to `main`. It checks the syntax, starts the server and confirms it sets cookies.
If your host doesn't deploy automatically on push, add the host's deploy-hook URL as a repository secret named `DEPLOY_HOOK_URL`.

## Environment variables
| Variable | Purpose |
|---|---|
| `PORT` | Port to listen on. The default is 3000. |
| `TRUST_PROXY=1` | Trust `X-Forwarded-Proto` from an HTTPS proxy. It's set automatically on Render. |
| `ADMIN_TOKEN` | If set, changing the profile needs this token. Reading and scanning are always open. |
| `PROFILE_FILE` | Where UI changes are saved. Put it on a persistent disk to keep edits across restarts. |

## Integrating the Cookie Manager SDK
- **Script:** paste the SDK `<script>` in `public/index.html` at the `COOKIE MANAGER SDK — INSERT HERE` comment.
- **Banner:** put the banner element in `<div id="cookie-banner-root">`.
- **Preferences link:** the footer has an optional `#cookie-preferences-link` with a `data-cookie-preferences` attribute.
- **Not included:** there's no tenant ID, site ID, API URL or SDK code in the project.
- **Live updates:** the table re-reads the browser every 5 seconds, on tab focus, and on `cookieStore` change events.
- **Tags in the table:** cookies the CMP sets show as **external**. Cookies it blocks show as **not in browser**.

Server-set cookies can't be blocked by a client-side CMP. That's how real websites behave too, and it's useful for checking how your scanner classifies them.

## API
- `GET /api/state` returns `{ profile, cookies }`. `cookies` is what this browser sent, including HttpOnly cookies.
- `POST /api/profile` takes `{ upsert: [entry], remove: [{ name, path, domain, fromProfile }] }`.
- `POST /api/profile/reset` restores the defaults from `site-cookies.json`. It also accepts `{ entries: [...] }` to load a specific set.
- `GET /api/profile/export` downloads the current profile.

## Browser limitations
- Browsers only expose a cookie's name and value. Attributes come from the profile, or are tagged *live* when the Cookie Store API (Chromium) reports them.
- HttpOnly cookies are invisible to JavaScript, so the server sets and deletes them.
- Secure needs HTTPS, or localhost. SameSite=None needs Secure.
- Domain must be the current host or a parent domain. A non-root Path cookie is only sent on that path.
- Cookie lifetime is capped at 400 days. The profile is capped at 150 cookies, because browsers allow about 180 per site.
