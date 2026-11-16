import {type SanityConfig} from '@sanity/sdk'
import {SDKProvider, useCurrentUser} from '@sanity/sdk-react'
import {hasSessionOrCallback, moveHashSidToQuery, projectHostClientFactory} from './auth/projectAuth'
import {ProjectLogin} from './auth/ProjectLogin'
import {Suspense} from 'react'
import {dataset, projectId, useGlobalApiProxy} from './env'
import {GlobalApiCheck} from './GlobalApiCheck'
import {installGlobalApiProxy} from './globalApiProxy'
import {RecentDocuments} from './RecentDocuments'
import './App.css'

// Both run before SDKProvider creates its instance, reads location.href and
// creates its clients.
moveHashSidToQuery()
if (useGlobalApiProxy) installGlobalApiProxy()

const config: SanityConfig[] = [
  {projectId, dataset, auth: {clientFactory: projectHostClientFactory}},
]

function Home() {
  const user = useCurrentUser()
  return (
    <main>
      <p className="muted">
        Signed in as {user?.name ?? '(unknown)'} · {projectId}/{dataset}
      </p>
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
    return <p>Set SANITY_APP_PROJECT_ID in .env.local (see .env.example).</p>
  }
  // SDKProvider, not SanityApp: SanityApp redirects to sanity.io/welcome on any
  // origin that is not localhost and not inside the Sanity Dashboard.
  // While logged out, render the login screen instead of SDKProvider, because
  // SDKProvider would redirect to www.sanity.io/login.
  if (!hasSessionOrCallback()) return <ProjectLogin />
  return (
    <SDKProvider config={config} fallback={<p>Loading…</p>}>
      <Home />
    </SDKProvider>
  )
}

export default App
