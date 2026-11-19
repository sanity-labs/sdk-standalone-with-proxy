// Server-only configuration for the OAuth functions. Read at request time, so a
// missing variable fails that request with a clear message instead of crashing
// the function at import. Files under api/ are never bundled into the browser,
// so these values (including the OAuth client secret) stay on the server.
//
// The variables below must not use the SANITY_APP_ prefix: `sanity build`
// inlines every referenced SANITY_APP_* value into the browser bundle.

export class ConfigError extends Error {}

export interface ServerEnv {
  clientId: string
  clientSecret: string
  sessionSecret: string
  authorizeUrl: string
  tokenUrl: string
  revokeUrl: string
  redirectUri: string
  refreshWindowSeconds: number
  projectId: string
  dataset: string
  organizationId: string
}

function required(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) throw new ConfigError(`Missing ${name}. See .env.example.`)
  return value
}

function requiredUrl(name: string): string {
  const value = required(name)
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new ConfigError(`${name} is not an absolute URL.`)
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new ConfigError(`${name} must be an http(s) URL.`)
  }
  return value
}

let cached: ServerEnv | undefined

export function serverEnv(): ServerEnv {
  if (cached) return cached

  const sessionSecret = required('SESSION_SECRET')
  if (sessionSecret.length < 32) {
    throw new ConfigError('SESSION_SECRET must be at least 32 characters.')
  }

  const refreshWindowSeconds = Number(process.env.SANITY_TOKEN_REFRESH_WINDOW_SECONDS ?? '86400')
  if (!Number.isFinite(refreshWindowSeconds) || refreshWindowSeconds < 0) {
    throw new ConfigError('SANITY_TOKEN_REFRESH_WINDOW_SECONDS must be a non-negative number.')
  }

  cached = {
    clientId: required('SANITY_OAUTH_CLIENT_ID'),
    clientSecret: required('SANITY_OAUTH_CLIENT_SECRET'),
    sessionSecret,
    authorizeUrl: requiredUrl('SANITY_OAUTH_AUTHORIZE_URL'),
    tokenUrl: requiredUrl('SANITY_OAUTH_TOKEN_URL'),
    revokeUrl: requiredUrl('SANITY_OAUTH_REVOKE_URL'),
    redirectUri: requiredUrl('SANITY_OAUTH_REDIRECT_URI'),
    refreshWindowSeconds,
    // Shared with the browser build. Identifiers, not secrets.
    projectId: required('SANITY_APP_PROJECT_ID'),
    dataset: process.env.SANITY_APP_DATASET?.trim() || 'production',
    organizationId: required('SANITY_APP_ORGANIZATION_ID'),
  }
  return cached
}

export const isProduction = process.env.NODE_ENV === 'production'

// Wraps a handler so configuration errors become a readable 500.
export function withConfig(
  handler: (request: Request) => Promise<Response>,
): (request: Request) => Promise<Response> {
  return async (request) => {
    try {
      return await handler(request)
    } catch (error) {
      if (error instanceof ConfigError) {
        return Response.json(
          {error: 'Server is not configured', detail: error.message},
          {status: 500, headers: {'cache-control': 'no-store'}},
        )
      }
      throw error
    }
  }
}
