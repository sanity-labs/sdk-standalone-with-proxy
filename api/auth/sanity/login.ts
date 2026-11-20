import {withConfig} from '../../_lib/env.js'
import {beginOauth, safeReturnTo} from '../../_lib/oauth.js'

/** Starts sign-in: redirects to Sanity's authorize URL. `?returnTo=` is where to land afterwards. */
export const GET = withConfig(async (request) => {
  const returnTo = safeReturnTo(new URL(request.url).searchParams.get('returnTo'))
  return beginOauth(returnTo)
})
