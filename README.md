# Standalone Sanity App SDK app with a choice of sign-in, and an optional global API proxy

This template runs a [Sanity App SDK](https://www.sanity.io/docs/app-sdk) app on your own domain (for example Vercel) instead of inside the Sanity Dashboard. Users sign in with their own Sanity account, and the app reads and edits content in one Sanity project as that user.

It supports two ways to sign in. Pick one per deployment with `SANITY_APP_AUTH_MODE`:

- **`project`** (default): project-scoped Sanity login, the same login a self-hosted Sanity Studio uses. Browser only. No server code, no OAuth client.
- **`oauth`**: Sanity OAuth through a confidential client (authorization code flow with PKCE) in Vercel Functions. Tokens live in an encrypted httpOnly cookie. Needs an OAuth client for your organization. Ported from [demo-repositories/embedded-sdk](https://github.com/demo-repositories/embedded-sdk), a Next.js version of the same idea.

It also includes an optional Vercel Function that proxies the global Sanity API, so hooks such as `useProject`, `useProjects` and `useOrganizations` work from your domain. It works with either auth mode.

You do not have to use this repository. The [step-by-step guide](#build-it-yourself-step-by-step) below explains each change, so you can apply it to an existing App SDK app.

Tested with `@sanity/sdk` and `@sanity/sdk-react` 3.15.0, `@sanity/client` 8.15.1, `sanity` 6.23.0, `iron-session` 9.1, Node 22.12+ and Vercel. OAuth mode has not yet been tested end to end against a real OAuth client.

## Contents

- [What breaks by default on your own domain](#what-breaks-by-default-on-your-own-domain)
- [Choose an auth mode](#choose-an-auth-mode)
- [How sign-in works](#how-sign-in-works)
- [Quick start with this template](#quick-start-with-this-template)
- [Build it yourself, step by step](#build-it-yourself-step-by-step)
- [Optional: proxy for global API endpoints](#optional-proxy-for-global-api-endpoints)
- [Deploy to Vercel](#deploy-to-vercel)
- [Verify a deployment](#verify-a-deployment)
- [Limitations and security notes](#limitations-and-security-notes)
- [Files in this template](#files-in-this-template)

## What breaks by default on your own domain

The App SDK quickstart builds apps for the Sanity Dashboard. On `localhost` everything works, which hides the problems below. They show up only once the app is served from a real domain.

| Problem | Cause | Fix in this template |
|---|---|---|
| The app redirects to `sanity.io/welcome` after one second. | `SanityApp` redirects whenever the page is not on localhost and not inside the Dashboard. | Render `SDKProvider` instead of `SanityApp`. |
| Login never returns to your app. | The SDK's built-in login goes to `www.sanity.io/login`. That page only returns users to localhost and Sanity domains. | `project`: a project-scoped login screen, which returns to any origin in the project's CORS list. `oauth`: Sanity OAuth with redirect URIs registered on your own OAuth client, and the token passed to the SDK with `auth.token`. |
| After login: "Authentication Error". | The SDK exchanges the session and loads the current user (`users/me`) on the global host `api.sanity.io`, which sends no CORS headers for your domain. | Both modes give the SDK an `auth.clientFactory` that sends its auth requests to the project host. |
| A reload right after login fails with "The session ID is invalid or expired". | `project` only, SDK 3.13 and earlier. The login returns `#sid=` in the hash, and those versions do not remove a `sid` from the hash. | Fixed in `@sanity/sdk` 3.14.0. This template uses 3.15. |
| `useProject`, `useProjects`, `useOrganizations`, `useUsers` and similar hooks fail with CORS errors. | These hooks call `api.sanity.io`, which sends no CORS headers for your domain and rejects requests whose `Origin` it does not allow. | Optional same-origin proxy (Vercel Function) that forwards these calls without the `Origin` header. |

Document and query hooks use the project host (`<projectId>.api.sanity.io`), which honors the project's CORS origins. Once sign-in works, they work on your domain without a proxy. You need the proxy only if you use global-API hooks.

## Choose an auth mode

| | `project` (default) | `oauth` |
|---|---|---|
| Sign-in | Project-scoped Sanity login (Google, GitHub, email) | Sanity OAuth, organization picked on the Sanity sign-in page |
| Server code | None. Any static host works. | Vercel Functions in `api/auth/sanity/` |
| Setup | Project CORS origin | Project CORS origin, OAuth client, redirect URI, three secrets |
| Token in the browser | `localStorage` (`__sanity_auth_token`) | Access token in memory only. Refresh token and client secret stay on the server. |
| Token scope | One project host, but the global API accepts it for every organization the user belongs to | Requested for one organization (`resource` indicator). Not yet verified against a real client. |
| Local dev | `pnpm dev` (`sanity dev`, port 3333) | `pnpm dev:oauth` (`vercel dev`, port 3000) |

Set the mode at build time:

```bash
SANITY_APP_AUTH_MODE=oauth   # or project, or leave unset for project
```

The browser code reads it at build time (`sanity build` inlines `SANITY_APP_*`). The auth functions read it at runtime and answer 404 unless it is `oauth`, so on Vercel set it once in the project's environment variables for both.

Switching an existing deployment signs everyone out. Users sign in again with the new mode. OAuth mode removes a leftover `__sanity_auth_token` from `localStorage` on start.

To remove a mode you do not use:

- `project`: delete `src/auth/ProjectLogin.tsx` and `src/auth/ProjectAuthProvider.tsx`, and the `hasSessionOrCallback`, `fetchLoginProviders`, and `loginHref` functions. Keep `projectHostClientFactory`: OAuth mode uses it too.
- `oauth`: delete `api/auth/`, `api/_lib/` and `src/auth/OAuthAuthProvider.tsx`, and remove `iron-session` and `@types/node`.

Then simplify `src/App.tsx` and `src/auth/SignOutButton.tsx`.

## How sign-in works

### `project` mode

1. While there is no session, `ProjectAuthProvider` renders a login screen instead of `SDKProvider`. It lists the project's login providers from `<projectId>.api.sanity.io/auth/providers`.
2. Each provider link goes to `api.sanity.io/v1/auth/login/<provider>?origin=<this page>&projectId=<projectId>&withSid=true`. That endpoint only returns to origins in the project's CORS list.
3. The user comes back with `#sid=<session id>`. `SDKProvider` exchanges it for a token on the project host, stores the token in `localStorage`, and removes the `sid` from the URL.

### `oauth` mode

```mermaid
sequenceDiagram
    participant Browser
    participant Fn as api/auth/sanity/*
    participant Sanity as api.sanity.io
    participant Project as projectId.api.sanity.io

    Browser->>Fn: GET /api/auth/sanity/token
    Fn-->>Browser: 401, no session
    Browser->>Fn: GET /api/auth/sanity/login?returnTo=/
    Fn-->>Browser: Sealed state + PKCE verifier cookie, redirect to authorize URL
    Browser->>Sanity: Sign in, pick organization
    Sanity-->>Browser: Redirect to /api/auth/sanity/callback?code&state
    Browser->>Fn: GET /api/auth/sanity/callback
    Fn->>Sanity: Exchange code + verifier + client secret for tokens
    Fn->>Sanity: Check project belongs to org, read /users/me
    Fn-->>Browser: Encrypted session cookie, redirect to returnTo
    Browser->>Fn: GET /api/auth/sanity/token
    Fn-->>Browser: accessToken, refreshed server-side when near expiry
    Browser->>Project: SDK hooks and users/me with the token
```

## Quick start with this template

Requirements: Node 22.12 or later, pnpm, a Sanity project and its organization ID. For `oauth` mode also a Vercel account (for `vercel dev`) and permission to create an OAuth client in the organization.

1. Install dependencies.

   ```bash
   pnpm install
   ```

2. Create `.env` from the example and fill in the shared variables. It is gitignored.

   ```bash
   cp .env.example .env
   ```

   - `SANITY_APP_PROJECT_ID`, `SANITY_APP_DATASET`: your project (sanity.io/manage) and dataset.
   - `SANITY_APP_ORGANIZATION_ID`: the organization that owns the project. Find it in sanity.io/manage or with `pnpm exec sanity organizations list`.

3. Continue with the mode you picked.

### `project` mode

1. Allow the dev origin in your project's CORS settings, with credentials.

   ```bash
   pnpm exec sanity cors add http://localhost:3333 --credentials --project <projectId>
   ```

2. Start the dev server and open http://localhost:3333.

   ```bash
   pnpm dev
   ```

   You see a "Sign in" screen with your project's login providers. After signing in you see your name, a sign-out button, recent documents, and a "Global API hooks" panel. On localhost the proxy is off and the global hooks call `api.sanity.io` directly, because that host allows localhost.

### `oauth` mode

1. Create an OAuth client for your Sanity organization, and register this redirect URI on it:

   ```
   http://localhost:3000/api/auth/sanity/callback
   ```

   Note the client ID and the client secret. The secret is shown once. If you cannot create OAuth clients, ask your organization admin or Sanity support.

2. Fill in the OAuth variables in `.env`. Use `.env`, not `.env.local`: `vercel dev` loads only `.env` for the functions.

   - `SANITY_APP_AUTH_MODE=oauth`.
   - `SANITY_OAUTH_CLIENT_ID`, `SANITY_OAUTH_CLIENT_SECRET`: from step 1.
   - `SESSION_SECRET`: at least 32 random characters, for example `openssl rand -base64 48`.
   - The OAuth endpoint URLs and redirect URI defaults in `.env.example` are correct for local development.

3. Allow the dev origin in your project's CORS settings.

   ```bash
   pnpm exec sanity cors add http://localhost:3000 --project <projectId>
   ```

4. Start the dev server and open http://localhost:3000.

   ```bash
   pnpm dev:oauth
   ```

   `pnpm dev:oauth` runs `vercel dev`, which serves the functions in `api/` and runs `sanity dev` behind them (the `devCommand` in `vercel.json`). The first run asks you to log in to Vercel and link the directory to a Vercel project. Plain `pnpm dev` has no `/api` routes, so OAuth sign-in does not work there.

   You are redirected to sign in with Sanity, then see the same view as in `project` mode.

Deploy: see [Deploy to Vercel](#deploy-to-vercel).

## Build it yourself, step by step

These steps take an App SDK app from Dashboard-only to standalone on your own domain. File references point to this template, so you can copy the code. Steps 1 to 4 apply to both modes. Then follow 5P to 6P for `project` mode or 5O to 7O for `oauth` mode.

### 1. Start from an App SDK app

Use an existing app, or scaffold one:

```bash
npx sanity@latest init --template app-quickstart --typescript --package-manager pnpm
```

The quickstart writes `SanityApp` into `src/App.tsx` and an empty `projectId`/`dataset`. The steps below replace both.

Add `@sanity/client` as a direct dependency, at the version `@sanity/sdk` uses. For `oauth` mode also add `iron-session` for the session cookie, and `@types/node` for the server functions.

```bash
pnpm add @sanity/client
pnpm add iron-session && pnpm add -D @types/node   # oauth mode only
```

### 2. Configure the project, dataset and organization

`sanity build` and `sanity dev` replace `process.env.SANITY_APP_*` with literal values at build time. They read them from the shell and from `.env` files.

- Read them in one module. See `src/env.ts`. It declares `process` locally, so the browser code does not depend on `@types/node`.
- Everything `SANITY_APP_*` that the browser code references ends up in the bundle. Never put a token or secret there.
- `sanity dev` refuses to start without `app.organizationId` in `sanity.cli.ts` ("Apps require an organization ID"). See `sanity.cli.ts`. The OAuth functions also read `SANITY_APP_ORGANIZATION_ID` at runtime.

### 3. Render `SDKProvider` instead of `SanityApp`

`SanityApp` redirects to `sanity.io/welcome` on any origin that is not localhost and not inside the Dashboard. `SDKProvider` provides the same SDK context without that redirect.

`SDKProvider` is exported from `@sanity/sdk-react` but marked `@internal`. The SDK's Authentication Guide and its `apps/standalone-react` example use it for standalone apps. Pin your SDK version and re-test on upgrades.

### 4. Send the SDK's auth requests to the project host

In standalone mode the SDK runs its auth requests on the global host `api.sanity.io`: it exchanges the `sid` (`auth/fetch`), loads the current user (`users/me`), refreshes the token (`auth/refresh-token`) and logs out (`auth/logout`). That host sends no CORS headers for your domain, and a failed `users/me` puts the SDK in its "Authentication Error" state. The project host honors project CORS.

This applies in both modes. With `auth.token` set, the SDK skips its own login but still loads `users/me` in the browser.

The SDK creates those auth clients through `auth.clientFactory`, and only those. Point them at the project host. See `projectHostClientFactory` in `src/auth/projectAuth.ts`:

```ts
import {createClient, type ClientConfig} from '@sanity/client'

export function projectHostClientFactory(config: ClientConfig) {
  if (config.useProjectHostname === false && !config.projectId) {
    return createClient({...config, projectId, useProjectHostname: true})
  }
  return createClient(config)
}
```

### 5P. `project` mode: add a project-scoped login screen

While the user has no session, render your own login screen instead of `SDKProvider`. If `SDKProvider` mounts while logged out, it sends the user to `www.sanity.io/login`, which cannot return to your domain.

The login screen does what self-hosted Studio does. See `src/auth/projectAuth.ts`, `src/auth/ProjectLogin.tsx` and `src/auth/ProjectAuthProvider.tsx`.

1. Fetch the providers: `GET https://<projectId>.api.sanity.io/v2021-10-01/auth/providers`. The response has `providers: [{name, title, url}]`, for example Google, GitHub and email.
2. Link each provider to `<provider.url>?origin=<your page URL>&projectId=<projectId>&withSid=true`. That endpoint only accepts origins that are in your project's CORS list.
3. After sign-in, the user returns to `origin` with `#sid=<session id>`. The SDK picks it up, exchanges it for a token, stores the token in `localStorage` under `__sanity_auth_token`, and removes the `sid` from the URL. SDK 3.13 and earlier left `#sid` in the URL, so a reload failed with "The session ID is invalid or expired". Use 3.14.0 or later.

```tsx
const config = [{projectId, dataset, auth: {clientFactory: projectHostClientFactory}}]

if (!hasSessionOrCallback()) return <ProjectLogin />
return <SDKProvider config={config}>...</SDKProvider>
```

To sign out, `POST https://<projectId>.api.sanity.io/v2021-06-07/auth/logout` with the token, remove `__sanity_auth_token`, and reload. See `src/auth/SignOutButton.tsx`.

### 6P. `project` mode, optional: SAML SSO

If your organization uses SAML SSO (an Enterprise plan feature), add it as one more login option. SAML is not in the project's `auth/providers` list. A Studio adds it through `auth.providers` in its config, and this template does the same with three build-time variables:

```bash
SANITY_APP_SSO_LOGIN_URL=<project-specific SAML login URL>
SANITY_APP_SSO_TITLE=Acme SSO   # button text, default "SSO"
SANITY_APP_SSO_ONLY=true        # optional: hide Google, GitHub and email
```

1. Configure SAML SSO for the organization and enable it for the project. See [Set up single sign-on with SAML](https://www.sanity.io/docs/developer-guides/sso-saml).
2. Copy the project-specific login URL from sanity.io/manage → your organization → Settings → SAML SSO. It is an identifier, not a secret, so it can go in the bundle.
3. Set the variables and rebuild. `ProjectLogin` adds a "Continue with <title>" link. `loginHref()` replaces any `origin` already in the URL with the current page, and sets `projectId` and `withSid=true`, the same as for the other providers.
4. Keep the app's origin in the project's CORS list with credentials (step 8).

Things to know:

- A SAML login creates a separate Sanity account from the user's Google, GitHub or email login. Role mapping from identity provider groups applies at login.
- The SAML session TTL is set in the SAML configuration (12 hours by default, up to 1 week). Not tested here: what happens when the stored token expires while the app is open.
- Not tested end to end: the template's test organization has no SAML configuration. The login screen and the generated URLs were checked with a placeholder URL.
- `oauth` mode does not use these variables. Whether the OAuth authorize page offers SAML SSO is not known.

### 5O. `oauth` mode: create the OAuth client and register redirect URIs

Create an OAuth client in the organization that owns the project. Register one redirect URI per environment:

- `http://localhost:3000/api/auth/sanity/callback` for local development.
- `https://your-app.example.com/api/auth/sanity/callback` for production.

The redirect URI the app sends (`SANITY_OAUTH_REDIRECT_URI`) must match a registered URI exactly, including scheme, port and path.

### 6O. `oauth` mode: add the server functions

The OAuth code runs in Vercel Functions under `api/`. Shared modules live in `api/_lib/`. Vercel does not deploy files under a directory starting with `_` as functions. Nothing under `api/` is bundled into the browser.

- `api/_lib/env.ts` reads and validates the server-only variables at request time. A missing variable returns a 500 that names it. These variables must not use the `SANITY_APP_` prefix. Unless `SANITY_APP_AUTH_MODE=oauth`, every auth function returns 404.
- `api/_lib/session.ts` configures iron-session. The whole session (access token, refresh token, expiry and `sanityUserId`) is sealed into an httpOnly cookie, so you don't need a session store. `chunk: true` splits it across several cookies when it is larger than the browser's per-cookie limit.
- `api/_lib/oauth.ts` implements the protocol:
  - `beginOauth` creates a random `state` and PKCE verifier, seals both (plus `returnTo`) into a 10-minute cookie, and redirects to the authorize URL with the S256 challenge.
  - Every authorize and token request includes `resource=urn:io.sanity:organization:<orgId>`, which scopes the tokens to your organization.
  - `exchangeCode` and `refreshTokens` post form data with the client ID and secret to the token endpoint.
  - `safeReturnTo` only accepts same-origin paths, which blocks open redirects.
- `api/_lib/sanity-user.ts` runs two checks with the new token:
  - `assertProjectAccess` reads `/projects/<projectId>` and confirms that the project's `organizationId` matches. Users who belong to several organizations choose one on the Sanity login screen, and a token for the wrong one is rejected here.
  - `fetchSanityUserId` reads `/users/me` and returns `sanityUserId`.

The four functions under `api/auth/sanity/`:

- **`login`**: `GET /api/auth/sanity/login?returnTo=/some/path` calls `beginOauth`.
- **`callback`**: Sanity redirects here with `code` and `state`. The function unseals the transaction cookie and compares `state` in constant time, exchanges the code, runs both checks (revoking the new tokens if either fails), writes the session cookie and redirects to `returnTo`.
- **`token`**: the only way the browser gets an access token. It returns `{accessToken, expiresAt}` from the session, refreshing first if the token is inside the refresh window. If refresh fails with a 4xx (other than 408 or 429), the session is destroyed and it returns 401. A network error or 5xx returns 503 and keeps the session.
- **`logout`**: revokes the token, destroys the session, and redirects to login.

### 7O. `oauth` mode: start the SDK with the session's token

`src/auth/OAuthAuthProvider.tsx` connects the server-side session to the SDK:

- It fetches the first token from `/api/auth/sanity/token`. A 401 sends the user to `/api/auth/sanity/login?returnTo=<current path>`.
- It builds the `SDKProvider` config once, with `projectId`, `dataset` and `auth: {token, clientFactory: projectHostClientFactory}` (step 4). With a token set, the SDK skips its own login flow, so it never redirects to `www.sanity.io/login`.
- When `rotate` is on (the default), `TokenSync` re-fetches the token every 5 minutes, on window focus, and on a `sanity-token-refresh` event. It passes any new token to the existing SDK instance with `setAuthToken` (also `@internal`), so queries and listeners are not torn down.

```tsx
<OAuthAuthProvider>
  <YourApp />
</OAuthAuthProvider>
```

Sign out with a form that posts to the logout function:

```tsx
<form method="post" action="/api/auth/sanity/logout">
  <button type="submit">Sign out</button>
</form>
```

### 8. Add your origins to the project's CORS list

The SDK calls `<projectId>.api.sanity.io` straight from the browser, so add every origin the app is served from: local dev, the production domain, and any preview domains you want to test. In `project` mode, allow credentials: the project-scoped login rejects origins that are not listed.

```bash
pnpm exec sanity cors add https://your-app.example.com --credentials --project <projectId>
```

Or use sanity.io/manage → your project → API → CORS origins.

### 9. Build and deploy

`sanity build` writes a static single-page app to `dist/`. In `project` mode any static host works if it serves `dist/` and falls back to `index.html` for unknown paths. In `oauth` mode the auth functions need a host that runs them next to the static files, on the same origin. For Vercel, see [Deploy to Vercel](#deploy-to-vercel).

At this point sign-in, document reads and edits work on your domain. Add the proxy only if you need global-API hooks.

## Optional: proxy for global API endpoints

### When you need it

These SDK hooks call the global host `https://api.sanity.io` (SDK 3.15.0):

| Global request | Hooks |
|---|---|
| `/projects`, `/projects/:id` | `useProjects`, `useProject` |
| `/organizations`, `/organizations/:id` | `useOrganizations`, `useOrganization` |
| `/access/:type/:id/users`, `/access/:type/:id/users/:userId` | `useUsers`, `useUser` |
| `/access/:type/:id/user-permissions/me/check` | `useCheckPermissions` |
| `/applications`, `/applications/:id`, `/installations` | `useApplications`, `useApplication`, `useUpdateApplication`, `useDeleteApplication`, `useInstallation` |
| `/users/me/preferences`, `/organizations/:id/.../preferences` | `useUserPreference`, `useUserPreferenceList`, `useUpdateUserPreference`, `useUpdateUserPreferenceList`. Project preferences (`/projects/:id/...`) use the project host. Read from the code, not run. |

From your domain these fail in the browser. The user's token is valid for them, but `api.sanity.io` sends no CORS headers for your origin. It also rejects any request whose `Origin` header it does not allow, with 403 "CORS Origin not allowed".

The SDK's auth boundary also calls `GET /projects/:id` to check the organization. Without the proxy that call fails a few times and is ignored. The app keeps working.

### How it works

Three parts. Each is needed.

1. **A server-side proxy on your domain** (`api/sanity-proxy.ts`, a Vercel Function). It forwards the request to `https://api.sanity.io/<path>` with only `Authorization`, `Content-Type`, `Accept` and `Accept-Language`. It never forwards `Origin`, `Referer` or `Cookie`. It only proxies versioned paths (`v2025-02-19/...`), and the upstream host is fixed.
2. **A rewrite** (`vercel.json`): `/sanity-api/:__sanity_path*` → `/api/sanity-proxy?__sanity_path=:__sanity_path*`.
3. **A browser shim** (`src/globalApiProxy.ts`). It patches `fetch` and `XMLHttpRequest` and rewrites only `https://api.sanity.io/...` URLs to `/sanity-api/...` on your origin. Requests to `<projectId>.api.sanity.io` (data, listeners, mutations) are not touched. It is installed before `SDKProvider` mounts, only when `SANITY_APP_GLOBAL_API_PROXY=true`, and never on localhost.

### Enable it

1. Keep `api/sanity-proxy.ts`, the `/sanity-api` rewrite in `vercel.json`, and `src/globalApiProxy.ts`.
2. Build with `SANITY_APP_GLOBAL_API_PROXY=true`, for example in the Vercel project's environment variables.
3. Open the deployed app. The "Global API hooks" panel should say `proxy: on` and show your project name and counts.

### Why it is built this way

- **A function, not a plain rewrite.** Vercel external rewrites forward the browser's `Origin` header, and `api.sanity.io` rejects authenticated requests from unknown origins. The function drops `Origin`.
- **A fetch/XHR shim, not `auth.apiHost`.** The SDK uses one `apiHost` for every client. `@sanity/client` builds project URLs as `<projectId>.<apiHost host>`, so an `apiHost` with a path (`https://your-app.example.com/sanity-api`) would break every project-host request.
- **The parameter name `__sanity_path`.** Vercel appends a rewrite's named parameter to the destination query string. A parameter called `path` was forwarded to `api.sanity.io`, which rejected it with 400 "path is not allowed". The function removes `__sanity_path` before forwarding.
- **The proxy does not read the session.** The token the SDK holds passes through in the `Authorization` header. In OAuth mode the proxy never forwards the session cookie.

### Other hosts

The same design works on any host with server functions (Netlify Functions, Cloudflare Workers, your own server):

- Route a same-origin path to a function that calls `https://api.sanity.io/<path>`.
- Forward `Authorization` and the request body. Do not forward `Origin`.
- Point the browser shim at that path.

### Remove it

If you do not use global-API hooks:

1. Delete `api/sanity-proxy.ts` and `src/globalApiProxy.ts`.
2. Delete `src/GlobalApiCheck.tsx`, which exists only for diagnostics.
3. Remove the `/sanity-api` rewrite from `vercel.json`.
4. Remove the `installGlobalApiProxy` import and call from `src/App.tsx`.

## Deploy to Vercel

`vercel.json` sets `framework: null`, the install, build and dev commands, `outputDirectory: "dist"`, the proxy rewrite, and an SPA fallback to `index.html` that skips `/api/`. Files in `api/` deploy as functions, except `api/_lib/`.

1. Add the production origin to the project's CORS list (step 8).
2. In the Vercel project settings, under Environment Variables, set the shared variables:
   - `SANITY_APP_PROJECT_ID`, `SANITY_APP_DATASET`, `SANITY_APP_ORGANIZATION_ID`.
   - Optionally `SANITY_APP_GLOBAL_API_PROXY=true`.
   - `SANITY_APP_AUTH_MODE` (`project` or `oauth`). The build inlines these into the bundle, and the functions read them at runtime.
3. For `oauth` mode only:
   - Register the production redirect URI (`https://your-app.example.com/api/auth/sanity/callback`) on the OAuth client.
   - Set `SANITY_OAUTH_CLIENT_ID`, `SANITY_OAUTH_CLIENT_SECRET`, `SESSION_SECRET`, the three OAuth endpoint URLs, and `SANITY_OAUTH_REDIRECT_URI` set to the production callback. Mark the secrets as sensitive. Do not pass secrets with `--build-env`: they are only needed at runtime.
4. Deploy.

   ```bash
   npx vercel@latest deploy --prod
   ```

Notes:

- Use a current Vercel CLI (`npx vercel@latest`). Older global installs can fail on upload.
- Each Vercel preview deployment has its own origin. Sign-in works on a preview only if its origin is in the project's CORS list, and in `oauth` mode also if its callback URL is registered on the OAuth client and `SANITY_OAUTH_REDIRECT_URI` points at it. Previews also sit behind Vercel Authentication by default.
- `oauth` mode: serve over HTTPS. Cookies are marked `Secure` when `NODE_ENV=production`, so sign-in does not work over plain HTTP in production. Changing `SESSION_SECRET` signs everyone out.

## Verify a deployment

`project` mode:

1. Open the deployed URL in a private window. You see the "Sign in" screen with your project's login providers.
2. Sign in. You return to your domain, signed in, and the URL has no `sid`.
3. Reload. You stay signed in.
4. Recent documents load. In the network panel, data requests and `users/me` go to `<projectId>.api.sanity.io`.
5. Sign out. You see the "Sign in" screen again.

`oauth` mode:

1. Open the deployed URL in a private window. You should be redirected to the Sanity sign-in page.
2. Sign in and pick the organization that owns the project. You return to your domain, signed in.
3. Reload. You stay signed in. In the browser's storage panel, there is no token in `localStorage`. The `sanity_session` cookie is `HttpOnly`.
4. Recent documents load. In the network panel, data requests and `users/me` go to `<projectId>.api.sanity.io`.
5. Sign out. You are sent back through sign-in.

Both modes: if the proxy is enabled, the "Global API hooks" panel shows `proxy: on` and real values. Global requests appear as `/sanity-api/...` on your origin, and responses carry `x-sanity-global-proxy: 1`.

To check the functions without a browser:

```bash
curl -i "https://your-app.example.com/api/auth/sanity/token"        # oauth: 401 without a session. project: 404
curl -i "https://your-app.example.com/api/auth/sanity/login"        # oauth: 302 to the authorize URL. project: 404
curl -i "https://your-app.example.com/sanity-api/v2025-02-19/users/me"  # proxy: 200 and {} without a token
```

## Limitations and security notes

- **One project per app.** In `project` mode the token works on one project host only. In `oauth` mode the session and the organization check are for one project. Both are set by `SANITY_APP_PROJECT_ID`.
- **`project` mode keeps the token in `localStorage`.** The global API accepts it, so any script on the page can read it and list the user's organizations, projects and datasets across every organization they belong to. Keep third-party scripts to a minimum and use a strict Content Security Policy.
- **`oauth` mode keeps the access token in browser memory.** The refresh token and client secret never leave the server, and nothing is written to `localStorage`. The access token is requested for one organization (not yet verified), but can still list that organization's projects and datasets through `api.sanity.io` until it expires.
- **`oauth` mode: token refresh is server-side.** The token function refreshes when the access token is within `SANITY_TOKEN_REFRESH_WINDOW_SECONDS` of expiry, and `OAuthAuthProvider` picks the new token up within 5 minutes, on focus, or on the `sanity-token-refresh` event.
- **`oauth` mode: logout does not end the sanity.io login.** Revoking the token does not necessarily sign the user out of sanity.io, so the next sign-in may skip the login screen.
- **`oauth` mode: local dev needs `vercel dev`.** `sanity dev` alone cannot run the auth functions.
- **`oauth` mode: not yet tested end to end** against a real OAuth client, including whether an organization-scoped OAuth token is accepted by the project host's `users/me`.
- **SAML SSO (`project` mode) not tested end to end.** Only the login screen and its URLs were checked, with a placeholder login URL. See step 6P.
- **Dashboard-only features do not work standalone.** Favorites, document history and `useFrameConnection` need the Dashboard frame. This is unrelated to hosting.
- **Not verified through the proxy.** PATCH and PUT, `useUsers`/`useUser`, `useDeleteApplication`, comments, agent actions, and cold-start latency. GET, POST and DELETE were tested through the same proxy design.
- **Both auth modes and the proxy shim are always in the bundle.** `SANITY_APP_AUTH_MODE` and `SANITY_APP_GLOBAL_API_PROXY` control which code runs, not what is bundled. No secrets are in the browser code.
- **Depends on SDK internals.** `SDKProvider` and `setAuthToken` are `@internal` in SDK 3.15.0. Re-test after SDK upgrades.

## Files in this template

| File | Purpose |
|---|---|
| `src/App.tsx` | Entry. Picks the auth provider for `SANITY_APP_AUTH_MODE`, optionally installs the proxy shim, renders the example view with a sign-out button. |
| `src/env.ts` | Reads the `SANITY_APP_*` build-time variables, including `authMode`. |
| `src/auth/projectAuth.ts` | `projectHostClientFactory` (both modes), plus the `project` mode login helpers. |
| `src/auth/ProjectAuthProvider.tsx` | `project` mode: login screen while logged out, otherwise `SDKProvider` with the client factory. |
| `src/auth/ProjectLogin.tsx` | `project` mode: lists the project's login providers, plus the optional SAML SSO link. |
| `src/auth/OAuthAuthProvider.tsx` | `oauth` mode: fetches the access token, starts `SDKProvider` with it, rotates it, redirects to sign-in on 401. |
| `src/auth/SignOutButton.tsx` | Sign-out for the current mode. |
| `src/RecentDocuments.tsx` | Example data view. Lists documents and edits each `title` with `useEditDocument`. Replace with your app. |
| `src/GlobalApiCheck.tsx` | Diagnostic panel for global-API hooks. Optional. |
| `src/globalApiProxy.ts` | Optional browser shim: `api.sanity.io` → `/sanity-api`. |
| `api/auth/sanity/login.ts` | `oauth` mode: starts OAuth with a sealed state and PKCE cookie, redirect to the authorize URL. |
| `api/auth/sanity/callback.ts` | `oauth` mode: verifies state, exchanges the code, checks the organization, writes the session. |
| `api/auth/sanity/token.ts` | `oauth` mode: returns the access token, refreshing it near expiry. |
| `api/auth/sanity/logout.ts` | `oauth` mode: revokes the token, clears the session. |
| `api/_lib/*` | `oauth` mode shared server code: env and mode check, cookies, session, OAuth protocol, Sanity user checks. |
| `api/sanity-proxy.ts` | Optional Vercel Function: `/sanity-api` → `api.sanity.io`, without `Origin`. |
| `vercel.json` | Build and dev settings, proxy rewrite, SPA fallback. |
| `sanity.cli.ts` | App entry and `organizationId` for `sanity dev`. |
| `.env.example` | All variables, with notes. |
