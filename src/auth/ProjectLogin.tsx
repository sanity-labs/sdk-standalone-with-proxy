import {useEffect, useState} from 'react'
import {ssoLoginUrl, ssoOnly, ssoTitle} from '../env'
import {fetchLoginProviders, loginHref, type LoginProvider} from './projectAuth'

// Rendered instead of SDKProvider while there is no session. Each link goes to
// the project-scoped provider login, which returns to this origin with `#sid=`.
export function ProjectLogin() {
  const [providers, setProviders] = useState<LoginProvider[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  // With SANITY_APP_SSO_ONLY, the SSO link is the only option, so the project's
  // own provider list is not fetched.
  const ssoOnlyMode = ssoOnly && Boolean(ssoLoginUrl)

  useEffect(() => {
    if (ssoOnlyMode) {
      setProviders([])
      return
    }
    fetchLoginProviders().then(setProviders, (err: unknown) => setError(String(err)))
  }, [ssoOnlyMode])

  if (error) return <p>Could not load login providers: {error}</p>
  if (!providers) return <p>Loading login options…</p>

  // SAML SSO is not in the project's auth/providers list. Add the login URL from
  // sanity.io/manage as one more provider, the way a Studio config does.
  const options = ssoLoginUrl
    ? [...providers, {name: 'sso', title: ssoTitle, url: ssoLoginUrl}]
    : providers

  return (
    <div className="login">
      <h1>Sign in</h1>      <ul>
        {options.map((provider) => (
          <li key={provider.name}>
            <a href={loginHref(provider)}>Continue with {provider.title}</a>
          </li>
        ))}
      </ul>
    </div>
  )
}
