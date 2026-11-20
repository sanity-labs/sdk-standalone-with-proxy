// Project-scoped login for a standalone App SDK app on your own domain.
//
// The SDK's built-in standalone login (SDK 3.12.0) sends users to
// www.sanity.io/login. That page only returns users to localhost and Sanity
// domains, so on any other origin the user ends up on sanity.io/welcome. The SDK
// then exchanges the `sid` and calls users/me on the global api.sanity.io, which
// sends no CORS headers for your origin.
//
// This module does what a self-hosted Sanity Studio does instead:
// 1. Lists login providers from `<projectId>.api.sanity.io/auth/providers`.
// 2. Sends the user to `api.sanity.io/v1/auth/login/<provider>?origin&projectId&withSid=true`.
//    That endpoint accepts any origin in the project's CORS origins.
// 3. Gives the SDK an `auth.clientFactory` that sends its auth requests
//    (auth/fetch, users/me, auth/refresh-token, auth/logout) to the project host,
//    which honors project CORS.
import {createClient, type ClientConfig, type SanityClient} from '@sanity/client'
import {projectId} from '../env'

export interface LoginProvider {
  name: string
  title: string
  url: string
}

// The localStorage key the SDK's standalone auth reads and writes.
const SDK_TOKEN_STORAGE_KEY = '__sanity_auth_token'

export async function fetchLoginProviders(): Promise<LoginProvider[]> {
  const res = await fetch(`https://${projectId}.api.sanity.io/v2021-10-01/auth/providers`)
  if (!res.ok) throw new Error(`auth/providers returned ${res.status}`)
  const body = (await res.json()) as {providers: LoginProvider[]}
  return body.providers
}

export function loginHref(provider: LoginProvider): string {
  // `set`, not append: a login URL copied from sanity.io/manage (SAML SSO) can
  // already carry its own `origin`, which must be replaced with this page.
  const url = new URL(provider.url)
  url.searchParams.set('origin', `${window.location.origin}${window.location.pathname}`)
  url.searchParams.set('projectId', projectId)
  url.searchParams.set('withSid', 'true')
  return url.toString()
}

// True when SDKProvider can mount without redirecting to www.sanity.io/login:
// a `sid` came back from the login redirect, or the SDK already stored a token.
export function hasSessionOrCallback(): boolean {
  const hash = new URLSearchParams(window.location.hash.slice(1))
  const search = new URLSearchParams(window.location.search)
  if (hash.get('sid') || search.get('sid')) return true
  try {
    return Boolean(window.localStorage.getItem(SDK_TOKEN_STORAGE_KEY))
  } catch {
    return false
  }
}

// The provider login returns `#sid=...` in the hash. The SDK reads `sid` from the
// hash or the query, but only removes it from the query after the exchange. A
// `#sid` left in the URL makes a reload retry a used sid ("The session ID is
// invalid or expired"). Moving it to the query lets the SDK's cleanup remove it.
// Call before SDKProvider mounts.
export function moveHashSidToQuery(): void {
  const hash = new URLSearchParams(window.location.hash.slice(1))
  const sid = hash.get('sid')
  if (!sid) return
  hash.delete('sid')
  const url = new URL(window.location.href)
  url.searchParams.set('sid', sid)
  const rest = hash.toString()
  url.hash = rest ? `#${rest}` : ''
  window.history.replaceState(null, '', url.toString())
}

// The SDK calls `auth.clientFactory` only from its auth store. In standalone mode
// those clients use `useProjectHostname: false`. Point them at the project host.
export function projectHostClientFactory(config: ClientConfig): SanityClient {
  if (config.useProjectHostname === false && !config.projectId) {
    return createClient({...config, projectId, useProjectHostname: true})
  }
  return createClient(config)
}
