import {useCurrentUser} from '@sanity/sdk-react'
import {Suspense} from 'react'
import {OAuthAuthProvider} from './auth/OAuthAuthProvider'
import {ProjectAuthProvider} from './auth/ProjectAuthProvider'
import {SignOutButton} from './auth/SignOutButton'
import {authMode, dataset, projectId, useGlobalApiProxy} from './env'
import {GlobalApiCheck} from './GlobalApiCheck'
import {installGlobalApiProxy} from './globalApiProxy'
import {RecentDocuments} from './RecentDocuments'
import './App.css'

// Runs before SDKProvider creates its clients.
if (useGlobalApiProxy) installGlobalApiProxy()

// SANITY_APP_AUTH_MODE: `project` (default) or `oauth`. See README "Choose an auth mode".
const AuthProvider = authMode === 'oauth' ? OAuthAuthProvider : ProjectAuthProvider

function Home() {
  const user = useCurrentUser()
  return (
    <main>
      <p className="muted">
        Signed in as {user?.name ?? '(unknown)'} · {projectId}/{dataset}
      </p>
      <SignOutButton />
      <h2>Recent documents</h2>
      <Suspense fallback={<p>Loading documents…</p>}>
        <RecentDocuments />
      </Suspense>
      <GlobalApiCheck />
    </main>
  )
}

function App() {
  if (!projectId) {
    return <p>Set SANITY_APP_PROJECT_ID in .env (see .env.example).</p>
  }
  // Both providers render SDKProvider, not SanityApp: SanityApp redirects to
  // sanity.io/welcome on any origin that is not localhost and not inside the
  // Sanity Dashboard. `project` mode shows a project-scoped login screen while
  // logged out. `oauth` mode gets the token from the server-side OAuth session.
  return (
    <AuthProvider>
      <Home />
    </AuthProvider>
  )
}

export default App
