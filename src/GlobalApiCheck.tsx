import {useOrganizations, useProject, useProjects} from '@sanity/sdk-react'
import {Component, Suspense, type ReactNode} from 'react'
import {globalApiProxyActive} from './globalApiProxy'

// Diagnostic panel: renders SDK hooks that call the global api.sanity.io host.
// On a deployed origin these fail with CORS errors unless the proxy is enabled.
// Each row has its own error boundary so one failure does not hide the others.

class RowBoundary extends Component<{children: ReactNode}, {error: unknown}> {
  state = {error: null as unknown}
  static getDerivedStateFromError(error: unknown) {
    return {error}
  }
  render() {
    if (this.state.error) {
      const e = this.state.error
      return <span className="error">failed: {e instanceof Error ? e.message : String(e)}</span>
    }
    return this.props.children
  }
}

function Row({label, children}: {label: string; children: ReactNode}) {
  return (
    <li>
      <code>{label}</code>:{' '}
      <RowBoundary>
        <Suspense fallback={<span className="muted">loading…</span>}>{children}</Suspense>
      </RowBoundary>
    </li>
  )
}

function ProjectName() {
  const {data} = useProject({includeMembers: false, includeFeatures: false})
  return <>{data.displayName}</>
}

function ProjectCount() {
  const {data} = useProjects({includeFeatures: false})
  return <>{data.length} projects</>
}

function OrganizationCount() {
  const {data} = useOrganizations()
  return <>{data.length} organizations</>
}

export function GlobalApiCheck() {
  return (
    <section>
      <h2>Global API hooks</h2>
      <p className="muted">
        proxy: {globalApiProxyActive() ? 'on (/sanity-api → api.sanity.io)' : 'off (direct)'}
      </p>
      <ul>
        <Row label="useProject">
          <ProjectName />
        </Row>
        <Row label="useProjects">
          <ProjectCount />
        </Row>
        <Row label="useOrganizations">
          <OrganizationCount />
        </Row>
      </ul>
    </section>
  )
}
