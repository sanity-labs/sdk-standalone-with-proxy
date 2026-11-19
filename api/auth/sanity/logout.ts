import {withConfig} from '../../_lib/env.js'
import {redirect, revokeToken} from '../../_lib/oauth.js'
import {getSession} from '../../_lib/session.js'

/** Revokes the session's token with Sanity, clears the session cookie, and starts a fresh sign-in. */
const logout = withConfig(async (request) => {
  const headers = new Headers()
  const session = await getSession(request, headers)
  const token = session.refreshToken ?? session.accessToken
  if (token) await revokeToken(token)
  session.destroy()
  // 303 so a POST from the sign-out form becomes a GET on the login route.
  return redirect(new URL('/api/auth/sanity/login?returnTo=/', request.url), headers, 303)
})

export const GET = logout
export const POST = logout
