# Standalone Sanity App SDK app, with an optional global API proxy

This template runs a [Sanity App SDK](https://www.sanity.io/docs/app-sdk) app on your own domain (for example Vercel) instead of inside the Sanity Dashboard. Users sign in with their Sanity account, and the app reads and edits content in one Sanity project.

It also includes an optional Vercel Function that proxies the global Sanity API, so hooks such as `useProject`, `useProjects` and `useOrganizations` work from your domain.

You do not have to use this repository. The [step-by-step guide](#build-it-yourself-step-by-step) below explains each change, so you can apply it to an existing App SDK app.

Tested with `@sanity/sdk` and `@sanity/sdk-react` 3.12.0, `@sanity/client` 8.15.1, `sanity` 6.23.0, Node 22.12+ and Vercel.

## Contents

- [What breaks by default on your own domain](#what-breaks-by-default-on-your-own-domain)
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
| Login never returns to your app. | The SDK's built-in login goes to `www.sanity.io/login`. That page only returns users to localhost and Sanity domains, and replaces any other return address with `sanity.io/welcome`. Project CORS settings do not change this. | Send users to the project-scoped login that self-hosted Sanity Studio uses. It accepts any origin in your project's CORS list. |
| After login: "Authentication Error". | The SDK exchanges the login session and loads the current user on the global host `api.sanity.io`, which sends no CORS headers for your domain. | Pass `auth.clientFactory` so the SDK's auth requests go to `<projectId>.api.sanity.io`, which honors project CORS. |
| Reloading after login: "The session ID is invalid or expired". | The project-scoped login returns `#sid=...` in the URL hash. The SDK reads it but only removes `sid` from the query string, so a reload tries the used session ID again. | Move `#sid` to `?sid` before the SDK starts. |
| `useProject`, `useProjects`, `useOrganizations`, `useUsers` and similar hooks fail with CORS errors. | These hooks call `api.sanity.io`, which sends no CORS headers for your domain and rejects requests whose `Origin` it does not allow. | Optional same-origin proxy (Vercel Function) that forwards these calls without the `Origin` header. |

Document and query hooks use the project host (`<projectId>.api.sanity.io`). Once login works, they work on your domain without a proxy. `useDocuments`, `useDocumentProjection`, `useDocument` and `useEditDocument` were tested on a Vercel domain. `useQuery`, `usePaginatedDocuments`, `useDocumentPermissions`, `useDatasets` and the presence hooks use the same host but were not tested. You need the proxy only if you use global-API hooks.

## Quick start with this template

Requirements: Node 22.12 or later, pnpm, a Sanity project, and your Sanity organization ID.

1. Install dependencies.

   ```bash
   pnpm install
   ```

2. Create `.env.local` from the example and fill it in.

   ```bash
   cp .env.example .env.local
   ```

   - `SANITY_APP_PROJECT_ID`: your project ID (sanity.io/manage).
   - `SANITY_APP_DATASET`: usually `production`.
   - `SANITY_APP_ORGANIZATION_ID`: required by `sanity dev`. Find it in sanity.io/manage or with `pnpm exec sanity organizations list`.

3. Allow the dev origin in your project's CORS settings, with credentials.

   ```bash
   pnpm exec sanity cors add http://localhost:3333 --credentials --project <projectId>
   ```

4. Start the dev server and open http://localhost:3333.

   ```bash
   pnpm dev
   ```

   You see a sign-in page with your project's login providers. After signing in you see your name, recent documents, and a "Global API hooks" panel. On localhost the proxy is off and the global hooks call `api.sanity.io` directly, because that host allows localhost.

5. Deploy: see [Deploy to Vercel](#deploy-to-vercel).

## Build it yourself, step by step

These steps take an App SDK app from Dashboard-only to standalone on your own domain. File references point to this template, so you can copy the code.

### 1. Start from an App SDK app

Use an existing app, or scaffold one:

```bash
npx sanity@latest init --template app-quickstart --typescript --package-manager pnpm
```

The quickstart writes `SanityApp` into `src/App.tsx` and an empty `projectId`/`dataset`. The steps below replace both.

Add `@sanity/client` as a direct dependency, at the version `@sanity/sdk` uses. The login code below creates clients with it.

```bash
pnpm add @sanity/client
```

### 2. Configure the project, dataset and organization

`sanity build` and `sanity dev` replace `process.env.SANITY_APP_*` with literal values at build time. They read them from the shell and from `.env.local`.

- Read them in one module. See `src/env.ts`. Without `@types/node`, add `declare const process: {env: Record<string, string | undefined>}`.
- Everything `SANITY_APP_*` ends up in the browser bundle. Never put a token there.
- `sanity dev` refuses to start without `app.organizationId` in `sanity.cli.ts` ("Apps require an organization ID"). `sanity build` does not need it. See `sanity.cli.ts`.

### 3. Render `SDKProvider` instead of `SanityApp`

`SanityApp` redirects to `sanity.io/welcome` on any origin that is not localhost and not inside the Dashboard. `SDKProvider` provides the same SDK context without that redirect.

```tsx
import {SDKProvider} from '@sanity/sdk-react'

<SDKProvider config={[{projectId, dataset}]} fallback={<p>Loading…</p>}>
  <YourApp />
</SDKProvider>
```

`SDKProvider` is exported from `@sanity/sdk-react` but marked `@internal`. The SDK's Authentication Guide and its `apps/standalone-react` example use it for standalone apps. Pin your SDK version and re-test on upgrades.

### 4. Add a project-scoped login screen

While the user has no session, render your own login screen instead of `SDKProvider`. If `SDKProvider` mounts while logged out, it sends the user to `www.sanity.io/login`, which cannot return to your domain.

The login screen does what self-hosted Studio does. See `src/auth/projectAuth.ts` and `src/auth/ProjectLogin.tsx`.

1. Fetch the providers: `GET https://<projectId>.api.sanity.io/v2021-10-01/auth/providers`. The response has `providers: [{name, title, url}]`, for example Google, GitHub and email.
2. Link each provider to `<provider.url>?origin=<your page URL>&projectId=<projectId>&withSid=true`. That endpoint only accepts origins that are in your project's CORS list.
3. After sign-in, the user returns to `origin` with `#sid=<session id>`. The SDK picks it up, exchanges it for a token, and stores the token in `localStorage` under `__sanity_auth_token`.

Gate on "is there a session or a `sid`":

```ts
export function hasSessionOrCallback(): boolean {
  const hash = new URLSearchParams(window.location.hash.slice(1))
  const search = new URLSearchParams(window.location.search)
  if (hash.get('sid') || search.get('sid')) return true
  return Boolean(window.localStorage.getItem('__sanity_auth_token'))
}
```

```tsx
if (!hasSessionOrCallback()) return <ProjectLogin />
return <SDKProvider config={config}>...</SDKProvider>
```

### 5. Send the SDK's auth requests to the project host

In standalone mode the SDK exchanges the `sid` (`auth/fetch`), loads the current user (`users/me`), refreshes the token (`auth/refresh-token`) and logs out (`auth/logout`) on the global host `api.sanity.io`. That host sends no CORS headers for your domain. The project host does.

The SDK creates those auth clients through `auth.clientFactory`, and only those. Point them at the project host:

```ts
import {createClient, type ClientConfig} from '@sanity/client'

export function projectHostClientFactory(config: ClientConfig) {
  if (config.useProjectHostname === false && !config.projectId) {
    return createClient({...config, projectId, useProjectHostname: true})
  }
  return createClient(config)
}

const config = [{projectId, dataset, auth: {clientFactory: projectHostClientFactory}}]
```

### 6. Move `#sid` to the query before the SDK starts

The provider login returns `#sid=...` in the hash. The SDK reads `sid` from the hash or the query, but after the exchange it only removes it from the query. With `#sid` left in the URL, a reload retries a used session ID and fails. Move it to the query at module load, before `SDKProvider` renders. See `moveHashSidToQuery()` in `src/auth/projectAuth.ts`.

```ts
moveHashSidToQuery() // top level of App.tsx
```

### 7. Add your origins to the project's CORS list, with credentials

Add every origin the app is served from: local dev, the production domain, and any preview domains you want to test. The project-scoped login rejects origins that are not listed, and the project host uses the same list for CORS.

```bash
pnpm exec sanity cors add https://your-app.example.com --credentials --project <projectId>
```

Or use sanity.io/manage → your project → API → CORS origins, with "Allow credentials" checked.

### 8. Build and deploy

`sanity build` writes a static single-page app to `dist/`. Any static host works if it serves `dist/` and falls back to `index.html` for unknown paths. For Vercel, see [Deploy to Vercel](#deploy-to-vercel).

At this point login, document reads and edits work on your domain. Add the proxy only if you need global-API hooks.

## Optional: proxy for global API endpoints

### When you need it

These SDK hooks call the global host `https://api.sanity.io` (SDK 3.12.0):

| Global request | Hooks |
|---|---|
| `/projects`, `/projects/:id` | `useProjects`, `useProject` |
| `/organizations`, `/organizations/:id` | `useOrganizations`, `useOrganization` |
| `/access/:type/:id/users`, `/access/:type/:id/users/:userId` | `useUsers`, `useUser` |
| `/access/:type/:id/user-permissions/me/check` | `useCheckPermissions` |
| `/applications`, `/installations` | `useApplication`, `useDeleteApplication`, `useInstallation` |

From your domain these fail in the browser. The user's token is valid for them, but `api.sanity.io` sends no CORS headers for your origin. It also rejects any request whose `Origin` header it does not allow, with 403 "CORS Origin not allowed".

The SDK's auth boundary also calls `GET /projects/:id` to check the organization. Without the proxy that call fails a few times and is ignored. The app keeps working.

### How it works

Three parts. Each is needed.

1. **A server-side proxy on your domain** (`api/sanity-proxy.ts`, a Vercel Function). It forwards the request to `https://api.sanity.io/<path>` with only `Authorization`, `Content-Type`, `Accept` and `Accept-Language`. It never forwards `Origin`, `Referer` or `Cookie`. It only proxies versioned paths (`v2025-02-19/...`), and the upstream host is fixed.
2. **A rewrite** (`vercel.json`): `/sanity-api/:__sanity_path*` → `/api/sanity-proxy?__sanity_path=:__sanity_path*`.
3. **A browser shim** (`src/globalApiProxy.ts`). It patches `fetch` and `XMLHttpRequest` and rewrites only `https://api.sanity.io/...` URLs to `/sanity-api/...` on your origin. Requests to `<projectId>.api.sanity.io` (data, listeners, mutations) are not touched. It is installed before `SDKProvider` mounts, only when `SANITY_APP_GLOBAL_API_PROXY=true`, and never on localhost.

### Enable it

1. Keep `api/sanity-proxy.ts`, the `/sanity-api` rewrite in `vercel.json`, and `src/globalApiProxy.ts`.
2. Build with `SANITY_APP_GLOBAL_API_PROXY=true`, for example `--build-env SANITY_APP_GLOBAL_API_PROXY=true` on `vercel deploy`.
3. Open the deployed app. The "Global API hooks" panel should say `proxy: on` and show your project name and counts.

### Why it is built this way

- **A function, not a plain rewrite.** Vercel external rewrites forward the browser's `Origin` header, and `api.sanity.io` rejects authenticated requests from unknown origins. The function drops `Origin`.
- **A fetch/XHR shim, not `auth.apiHost`.** The SDK uses one `apiHost` for every client. `@sanity/client` builds project URLs as `<projectId>.<apiHost host>`, so an `apiHost` with a path (`https://your-app.example.com/sanity-api`) would break every project-host request.
- **The parameter name `__sanity_path`.** Vercel appends a rewrite's named parameter to the destination query string. A parameter called `path` was forwarded to `api.sanity.io`, which rejected it with 400 "path is not allowed". The function removes `__sanity_path` before forwarding.
- **No token handling on the server.** The user's token stays in the browser and passes through in the `Authorization` header. The proxy needs no secrets.

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

`vercel.json` sets `framework: null`, the install and build commands, `outputDirectory: "dist"`, the proxy rewrite, and an SPA fallback to `index.html` that skips `/api/`.

1. Add the production origin to CORS with credentials (step 7).
2. Deploy, passing the build-time variables:

   ```bash
   npx vercel@latest deploy --prod \
     --build-env SANITY_APP_PROJECT_ID=<projectId> \
     --build-env SANITY_APP_DATASET=production \
     --build-env SANITY_APP_GLOBAL_API_PROXY=true
   ```

   Or set the same variables in the Vercel project settings. Drop `SANITY_APP_GLOBAL_API_PROXY` if you removed the proxy.

Notes:

- Use a current Vercel CLI (`npx vercel@latest`). Older global installs can fail on upload.
- Vercel preview deployments sit behind Vercel Authentication by default, and each preview has its own origin. Login works on a preview only if that origin is in your project's CORS list.

## Verify a deployment

1. Open the deployed URL in a private window. You should see the sign-in page, not a redirect to `sanity.io`.
2. Sign in. You return to your domain, signed in. The URL should not keep `#sid=` or `?sid=`.
3. Reload. You stay signed in.
4. Recent documents load. In the browser's network panel, data requests go to `<projectId>.api.sanity.io`.
5. If the proxy is enabled, the "Global API hooks" panel shows `proxy: on` and real values. Global requests appear as `/sanity-api/...` on your origin, and responses carry `x-sanity-global-proxy: 1`.

To check the proxy without a browser:

```bash
curl -i "https://your-app.example.com/sanity-api/v2025-02-19/users/me"
```

With no token, expect `200` and `{}`, with the `x-sanity-global-proxy` header present.

## Limitations and security notes

- **One project per app.** The token from the project-scoped login only works on that project's host. Other projects' hosts return 401 "Session does not match project host". An app that uses several projects would need a session per project, and the SDK holds one token. This is untested.
- **The token can list the user's whole Sanity account.** The token can't read documents in other projects. But anything that holds it can list the user's organizations, projects, datasets and dataset ACLs through `api.sanity.io`. It lives in `localStorage` on your origin, so treat your app like any app that holds a user session: keep third-party scripts to a minimum and use a strict Content Security Policy. Moving the token server-side (an httpOnly cookie, with the server adding `Authorization`) would remove that exposure. It would also mean routing all project-host traffic, including live-update streams, through your server. This template does not do that.
- **Session expiry is not handled gracefully.** If the stored token expires or is revoked while `SDKProvider` is mounted, the SDK goes logged-out and redirects to `www.sanity.io/login`, which cannot return to your domain. Clear `localStorage` and reload to get back to the sign-in page. This comes from reading the SDK code and has not been observed. Token refresh against the project host has not been observed either.
- **No logout button.** Add one with `useLogOut()`. After logout, reload so the login gate renders.
- **Dashboard-only features do not work standalone.** Favorites, document history and `useFrameConnection` need the Dashboard frame. This is unrelated to hosting.
- **Not verified through the proxy.** PATCH and PUT, `useUsers`/`useUser`, `useDeleteApplication`, comments, agent actions, and cold-start latency. GET, POST and DELETE were tested through the same proxy design.
- **The proxy shim is always in the bundle.** `SANITY_APP_GLOBAL_API_PROXY` controls whether it is installed, not whether it is bundled.
- **Depends on SDK internals.** The `__sanity_auth_token` storage key, `auth.clientFactory` being used only for auth requests, and the `sid` handling are SDK 3.12.0 behavior. Re-test after SDK upgrades.

## Files in this template

| File | Purpose |
|---|---|
| `src/App.tsx` | Entry. Moves `#sid`, optionally installs the proxy shim, gates on a session, renders `SDKProvider`. |
| `src/env.ts` | Reads the `SANITY_APP_*` build-time variables. |
| `src/auth/projectAuth.ts` | Provider list, login URLs, session check, `#sid` fix, `projectHostClientFactory`. |
| `src/auth/ProjectLogin.tsx` | Sign-in page with one link per provider. |
| `src/RecentDocuments.tsx` | Example data view (`useDocuments`, `useDocumentProjection`). Replace with your app. |
| `src/GlobalApiCheck.tsx` | Diagnostic panel for global-API hooks. Optional. |
| `src/globalApiProxy.ts` | Optional browser shim: `api.sanity.io` → `/sanity-api`. |
| `api/sanity-proxy.ts` | Optional Vercel Function: `/sanity-api` → `api.sanity.io`, without `Origin`. |
| `vercel.json` | Build settings, proxy rewrite, SPA fallback. |
| `sanity.cli.ts` | App entry and `organizationId` for `sanity dev`. |
| `.env.example` | All variables, with notes. |
