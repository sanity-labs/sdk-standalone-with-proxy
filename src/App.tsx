import {useCurrentUser} from '@sanity/sdk-react'
import {Suspense} from 'react'
import {SanityProvider} from './auth/SanityProvider'
import {dataset, projectId, useGlobalApiProxy} from './env'
import {GlobalApiCheck} from './GlobalApiCheck'
import {installGlobalApiProxy} from './globalApiProxy'
import {RecentDocuments} from './RecentDocuments'
import './App.css'

// Runs before SDKProvider creates its clients.
if (useGlobalApiProxy) installGlobalApiProxy()

function Home() {
  const user = useCurrentUser()
  return (
    <main>
      <p className="muted">
        Signed in as {user?.name ?? '(unknown)'} · {projectId}/{dataset}
      </p>
      <form method="post" action="/api/auth/sanity/logout">
        <button type="submit">Sign out</button>
      </form>
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
  // SDKProvider (inside SanityProvider), not SanityApp: SanityApp redirects to
  // sanity.io/welcome on any origin that is not localhost and not inside the
  // Sanity Dashboard. SanityProvider gets the token from the server-side OAuth
  // session, and sends the user to sign in when there is none.
  return (
    <SanityProvider tokenUrl="/api/auth/sanity/token" rotate>
      <Home />
    </SanityProvider>
  )
}

export default App
