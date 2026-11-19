/**
 * Sanity OAuth, server side. The app is a confidential client using the
 * authorization code flow with PKCE (S256):
 *
 * 1. `beginOauth` generates `state` and a PKCE verifier, seals them into a
 *    short-lived cookie, and redirects the browser to Sanity's authorize URL.
 * 2. Sanity sends the browser back to the callback function with `code` and `state`.
 * 3. The callback checks `state`, then `exchangeCode` trades the code (plus the
 *    verifier and the client secret) for an access token and a refresh token.
 * 4. `refreshTokens` swaps the refresh token for new tokens before expiry.
 *
 * The client secret is only ever sent from this server to Sanity's token and
 * revoke endpoints. It never reaches the browser.
 */
import {timingSafeEqual} from 'node:crypto'
import {sealData, unsealData} from 'iron-session'
import {clearCookie, OAUTH_TX_COOKIE_NAME, readCookie, setCookie} from './cookies.js'
import {serverEnv} from './env.js'

const TX_TTL_SECONDS = 10 * 60

export class OAuthRequestError extends Error {
  readonly status: number

  constructor(status: number) {
    super(`OAuth request failed (${status})`)
    this.status = status
  }
}

export interface OAuthTokens {
  accessToken: string
  refreshToken: string
  expiresAt: number
}

interface OauthTx {
  state: string
  verifier: string
  returnTo: string
}

interface TokenEndpointResponse {
  access_token?: unknown
  expires_in?: unknown
  refresh_token?: unknown
}

/**
 * RFC 8707 resource indicator. Scopes the issued tokens to the organization
 * that owns the project, and is sent on every authorize and token request.
 */
function resourceIndicator(): string {
  return `urn:io.sanity:organization:${serverEnv().organizationId}`
}

function base64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
}

function randomUrlSafe(): string {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return base64Url(bytes)
}

async function codeChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
  return base64Url(new Uint8Array(digest))
}

function sameString(a: string, b: string): boolean {
  const left = Buffer.from(a)
  const right = Buffer.from(b)
  if (left.length !== right.length) return false
  return timingSafeEqual(left, right)
}

/** A redirect with mutable headers. `Response.redirect` returns immutable headers. */
export function redirect(location: string | URL, headers = new Headers(), status = 302): Response {
  headers.set('location', location.toString())
  headers.set('cache-control', 'no-store')
  return new Response(null, {status, headers})
}

/**
 * Only a same-origin path. Rejects protocol-relative and absolute URLs so the
 * post-login redirect cannot be used as an open redirect.
 */
export function safeReturnTo(input: string | null): string {
  if (!input) return '/'
  if (!input.startsWith('/') || input.startsWith('//') || input.includes('\\')) return '/'
  if (input.includes('\n') || input.includes('\r')) return '/'
  return input
}

export function authorizeUrl(state: string, challenge: string): string {
  const env = serverEnv()
  const url = new URL(env.authorizeUrl)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('client_id', env.clientId)
  url.searchParams.set('redirect_uri', env.redirectUri)
  url.searchParams.set('state', state)
  url.searchParams.set('code_challenge', challenge)
  url.searchParams.set('code_challenge_method', 'S256')
  url.searchParams.set('resource', resourceIndicator())
  return url.toString()
}

/**
 * `state` (CSRF protection), the PKCE verifier and `returnTo` are sealed with
 * SESSION_SECRET into an httpOnly cookie, so the callback can verify them
 * without any server-side storage. Only the derived challenge goes to Sanity.
 */
export async function beginOauth(returnTo: string): Promise<Response> {
  const state = randomUrlSafe()
  const verifier = randomUrlSafe()
  const challenge = await codeChallenge(verifier)
  const seal = await sealData(
    {state, verifier, returnTo},
    {password: serverEnv().sessionSecret, ttl: TX_TTL_SECONDS},
  )
  const headers = new Headers()
  setCookie(headers, OAUTH_TX_COOKIE_NAME, seal, TX_TTL_SECONDS)
  return redirect(authorizeUrl(state, challenge), headers)
}

export async function readOauthTx(request: Request): Promise<OauthTx | null> {
  const raw = readCookie(request, OAUTH_TX_COOKIE_NAME)
  if (!raw) return null
  try {
    const data = await unsealData<Partial<OauthTx>>(raw, {
      password: serverEnv().sessionSecret,
      ttl: TX_TTL_SECONDS,
    })
    if (
      !data ||
      typeof data.state !== 'string' ||
      typeof data.verifier !== 'string' ||
      typeof data.returnTo !== 'string'
    ) {
      return null
    }
    return {state: data.state, verifier: data.verifier, returnTo: safeReturnTo(data.returnTo)}
  } catch {
    return null
  }
}

export function statesMatch(expected: string, returned: string): boolean {
  return sameString(expected, returned)
}

export function clearOauthTx(headers: Headers): void {
  clearCookie(headers, OAUTH_TX_COOKIE_NAME)
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

export function authErrorResponse(title: string, detail: string): Response {
  const html = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>${escapeHtml(title)}</title></head>
<body style="font-family: sans-serif; padding: 1.5rem">
<main>
<h1>${escapeHtml(title)}</h1>
<p>${escapeHtml(detail)}</p>
<p><a href="/api/auth/sanity/login?returnTo=/">Try signing in again</a></p>
</main>
</body>
</html>`
  const headers = new Headers({
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store',
  })
  clearOauthTx(headers)
  return new Response(html, {status: 400, headers})
}

async function postForm(url: string, params: URLSearchParams): Promise<TokenEndpointResponse> {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      accept: 'application/json',
    },
    body: params,
    cache: 'no-store',
  })
  if (!response.ok) {
    await response.text()
    throw new OAuthRequestError(response.status)
  }
  return (await response.json()) as TokenEndpointResponse
}

function confidentialParams(grant: Record<string, string>): URLSearchParams {
  const env = serverEnv()
  return new URLSearchParams({
    ...grant,
    client_id: env.clientId,
    client_secret: env.clientSecret,
    resource: resourceIndicator(),
  })
}

/**
 * A refresh response may omit `refresh_token`. In that case the previous one
 * stays valid and is kept.
 */
function parseTokens(body: TokenEndpointResponse, previousRefreshToken?: string): OAuthTokens {
  const accessToken = body.access_token
  const expiresIn = body.expires_in
  const refreshToken =
    typeof body.refresh_token === 'string' && body.refresh_token.length > 0
      ? body.refresh_token
      : previousRefreshToken
  if (typeof accessToken !== 'string' || accessToken.length === 0) {
    throw new OAuthRequestError(502)
  }
  if (typeof expiresIn !== 'number' || !Number.isFinite(expiresIn) || expiresIn <= 0) {
    throw new OAuthRequestError(502)
  }
  if (!refreshToken) throw new OAuthRequestError(502)
  return {accessToken, refreshToken, expiresAt: Date.now() + expiresIn * 1000}
}

export async function exchangeCode(code: string, verifier: string): Promise<OAuthTokens> {
  const body = await postForm(
    serverEnv().tokenUrl,
    confidentialParams({
      grant_type: 'authorization_code',
      code,
      code_verifier: verifier,
      redirect_uri: serverEnv().redirectUri,
    }),
  )
  return parseTokens(body)
}

export async function refreshTokens(refreshToken: string): Promise<OAuthTokens> {
  const body = await postForm(
    serverEnv().tokenUrl,
    confidentialParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    }),
  )
  return parseTokens(body, refreshToken)
}

/**
 * Revoke failures are ignored. Revoking the token does not necessarily end the
 * user's sanity.io login session, so the next sign-in may skip the login screen.
 */
export async function revokeToken(token: string): Promise<void> {
  const env = serverEnv()
  try {
    const response = await fetch(env.revokeUrl, {
      method: 'POST',
      headers: {'content-type': 'application/x-www-form-urlencoded'},
      body: new URLSearchParams({
        token,
        client_id: env.clientId,
        client_secret: env.clientSecret,
      }),
      cache: 'no-store',
    })
    await response.text()
  } catch {
    // Logout still clears the local session.
  }
}
