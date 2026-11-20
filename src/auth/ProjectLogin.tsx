import {useEffect, useState} from 'react'
import {fetchLoginProviders, loginHref, type LoginProvider} from './projectAuth'

// Rendered instead of SDKProvider while there is no session. Each link goes to
// the project-scoped provider login, which returns to this origin with `#sid=`.
export function ProjectLogin() {
  const [providers, setProviders] = useState<LoginProvider[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetchLoginProviders().then(setProviders, (err: unknown) => setError(String(err)))
  }, [])

  if (error) return <p>Could not load login providers: {error}</p>
  if (!providers) return <p>Loading login options…</p>

  return (
    <div className="login">
      <h1>Sign in</h1>
      <ul>
        {providers.map((provider) => (
          <li key={provider.name}>
            <a href={loginHref(provider)}>Continue with {provider.title}</a>
          </li>
        ))}
      </ul>
    </div>
  )
}
