import {authMode, projectId} from '../env'

// The localStorage key the SDK's standalone auth reads and writes in auth mode `project`.
const PROJECT_MODE_TOKEN_KEY = '__sanity_auth_token'

// Auth mode `project`: end the session on the project host (which honors project
// CORS), clear the stored token, and reload to show the login screen.
async function projectSignOut() {
  let token: string | undefined
  try {
    token = JSON.parse(window.localStorage.getItem(PROJECT_MODE_TOKEN_KEY) ?? 'null')?.token
  } catch {
    token = undefined
  }
  if (token) {
    await fetch(`https://${projectId}.api.sanity.io/v2021-06-07/auth/logout`, {
      method: 'POST',
      headers: {Authorization: `Bearer ${token}`},
    }).catch(() => undefined)
  }
  window.localStorage.removeItem(PROJECT_MODE_TOKEN_KEY)
  window.location.reload()
}

export function SignOutButton() {
  if (authMode === 'oauth') {
    // Auth mode `oauth`: the logout function revokes the token and clears the session cookie.
    return (
      <form method="post" action="/api/auth/sanity/logout">
        <button type="submit">Sign out</button>
      </form>
    )
  }
  return (
    <button type="button" onClick={() => void projectSignOut()}>
      Sign out
    </button>
  )
}
