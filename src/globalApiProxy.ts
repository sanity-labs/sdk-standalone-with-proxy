// OPTIONAL. Sends the SDK's global-host requests through the same-origin proxy
// in api/sanity-proxy.ts. Enabled with SANITY_APP_GLOBAL_API_PROXY=true at build time.
//
// Why a fetch/XHR patch and not `auth.apiHost`: the SDK uses one apiHost for every
// client, and @sanity/client builds project URLs as `<projectId>.<apiHost host>`.
// An apiHost with a path would break every project-host request (data, listeners,
// mutations). This rewrites only `https://api.sanity.io/...` URLs; project-host
// traffic still goes direct.
//
// Never installed on localhost: the global API already allows localhost origins,
// and `sanity dev` has no /sanity-api route.

const GLOBAL_API = 'https://api.sanity.io/'
// Login is a page navigation, not fetch/XHR, but keep it out explicitly.
const NEVER_PROXY = [`${GLOBAL_API}v1/auth/login/`]

function isLocalhost(): boolean {
  return ['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname)
}

function rewrite(url: string): string {
  if (!url.startsWith(GLOBAL_API)) return url
  if (NEVER_PROXY.some((prefix) => url.startsWith(prefix))) return url
  return `${window.location.origin}/sanity-api/${url.slice(GLOBAL_API.length)}`
}

let installed = false

export function installGlobalApiProxy(): void {
  if (installed || isLocalhost()) return
  installed = true

  const originalFetch = window.fetch.bind(window)
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    if (typeof input === 'string') return originalFetch(rewrite(input), init)
    if (input instanceof URL) return originalFetch(rewrite(input.toString()), init)
    const rewritten = rewrite(input.url)
    return originalFetch(rewritten === input.url ? input : new Request(rewritten, input), init)
  }

  const originalOpen = XMLHttpRequest.prototype.open as (
    this: XMLHttpRequest,
    method: string,
    url: string | URL,
    async?: boolean,
    username?: string | null,
    password?: string | null,
  ) => void
  XMLHttpRequest.prototype.open = function (
    this: XMLHttpRequest,
    method: string,
    url: string | URL,
    async: boolean = true,
    username?: string | null,
    password?: string | null,
  ) {
    originalOpen.call(this, method, rewrite(url.toString()), async, username, password)
  } as XMLHttpRequest['open']
}

export function globalApiProxyActive(): boolean {
  return installed
}
