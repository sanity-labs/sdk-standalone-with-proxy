import {isProduction, serverEnv, withConfig} from '../../_lib/env.js'
import {OAuthRequestError, refreshTokens} from '../../_lib/oauth.js'
import {getSession, sessionIsComplete} from '../../_lib/session.js'

function json(body: unknown, status: number, headers: Headers): Response {
  headers.set('cache-control', 'no-store')
  return Response.json(body, {status, headers})
}

/**
 * The browser's only way to get an access token. Returns the current token from
 * the session, refreshing it first once it is inside the refresh window
 * (SANITY_TOKEN_REFRESH_WINDOW_SECONDS before expiry).
 */
export const GET = withConfig(async (request) => {
  const headers = new Headers()
  const session = await getSession(request, headers)
  if (!sessionIsComplete(session)) return json({error: 'unauthorized'}, 401, headers)

  // Dev checkpoint: pretend the access token is inside the refresh window.
  const forceRefresh =
    !isProduction && new URL(request.url).searchParams.get('forceRefresh') === '1'
  const refreshAt = session.expiresAt - serverEnv().refreshWindowSeconds * 1000
  const shouldRefresh = forceRefresh || Date.now() >= refreshAt

  if (shouldRefresh) {
    try {
      const next = await refreshTokens(session.refreshToken)
      session.accessToken = next.accessToken
      session.refreshToken = next.refreshToken
      session.expiresAt = next.expiresAt
      await session.save()
    } catch (error) {
      // A 4xx (other than timeout or rate limit) means the refresh token is no longer
      // valid, so the session is dropped and the client sends the user to sign in.
      // Network errors and 5xx are treated as temporary and keep the session.
      const status = error instanceof OAuthRequestError ? error.status : 0
      const unrecoverable = status >= 400 && status < 500 && status !== 408 && status !== 429
      if (unrecoverable) {
        session.destroy()
        return json({error: 'unauthorized'}, 401, headers)
      }
      return json({error: 'refresh failed'}, 503, headers)
    }
  }

  return json({accessToken: session.accessToken, expiresAt: session.expiresAt}, 200, headers)
})
