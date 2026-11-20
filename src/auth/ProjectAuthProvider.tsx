import {type SanityConfig} from '@sanity/sdk'
import {SDKProvider} from '@sanity/sdk-react'
import {type ReactNode} from 'react'
import {dataset, projectId} from '../env'
import {hasSessionOrCallback, projectHostClientFactory} from './projectAuth'
import {ProjectLogin} from './ProjectLogin'

// Auth mode `project` (default). Project-scoped Sanity login, browser only.
// While logged out, renders the login screen instead of SDKProvider, because
// SDKProvider would redirect to www.sanity.io/login. Call moveHashSidToQuery()
// before this mounts (see App.tsx).

const config: SanityConfig[] = [
  {projectId, dataset, auth: {clientFactory: projectHostClientFactory}},
]

export function ProjectAuthProvider({children}: {children?: ReactNode}) {
  if (!hasSessionOrCallback()) return <ProjectLogin />
  return (
    <SDKProvider config={config} fallback={<p>Loading…</p>}>
      {children}
    </SDKProvider>
  )
}
