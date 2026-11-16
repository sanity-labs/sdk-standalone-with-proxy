// OPTIONAL. Vercel Function: same-origin reverse proxy for the global Sanity API.
// Delete this file, the /sanity-api rewrite in vercel.json, and
// src/globalApiProxy.ts if your app does not use global-API hooks.
//
// Why it exists: some SDK hooks (useProject, useProjects, useOrganizations,
// useUsers, useCheckPermissions, ...) call the global host https://api.sanity.io.
// That host sends no CORS headers for your origin, and it rejects requests whose
// Origin header it does not allow ("CORS Origin not allowed"), even with a valid
// token. A plain rewrite forwards the browser's Origin header, so this function
// forwards the request without it.
//
// Flow: src/globalApiProxy.ts rewrites https://api.sanity.io/<path> to
// /sanity-api/<path>. vercel.json rewrites that to
// /api/sanity-proxy?__sanity_path=<path>. Vercel also appends the named rewrite
// param to the query, which is why it has this unusual name and is removed here.
//
// The user's token stays in the browser and passes through in the Authorization
// header. The upstream host is fixed, so this is not an open proxy.

const UPSTREAM = 'https://api.sanity.io'
const PATH_PARAM = '__sanity_path'
const FORWARD_REQUEST_HEADERS = ['authorization', 'content-type', 'accept', 'accept-language']
const DROP_RESPONSE_HEADERS = new Set([
  'content-encoding',
  'content-length',
  'transfer-encoding',
  'connection',
  'set-cookie',
])

async function proxy(request: Request): Promise<Response> {
  const incoming = new URL(request.url)
  const path = incoming.searchParams.get(PATH_PARAM) ?? ''
  // Only versioned API paths, e.g. v2025-02-19/projects or v1/...
  if (!/^v[\w.-]+\//.test(path)) {
    return Response.json({error: 'Only versioned API paths are proxied'}, {status: 400})
  }
  incoming.searchParams.delete(PATH_PARAM)
  const upstreamUrl = `${UPSTREAM}/${path}${incoming.search}`

  // Allowlist request headers. Origin, Referer and Cookie are never forwarded.
  const headers = new Headers()
  for (const name of FORWARD_REQUEST_HEADERS) {
    const value = request.headers.get(name)
    if (value) headers.set(name, value)
  }

  const hasBody = request.method !== 'GET' && request.method !== 'HEAD'
  const upstream = await fetch(upstreamUrl, {
    method: request.method,
    headers,
    body: hasBody ? await request.arrayBuffer() : undefined,
  })

  const responseHeaders = new Headers()
  upstream.headers.forEach((value, name) => {
    if (!DROP_RESPONSE_HEADERS.has(name.toLowerCase())) responseHeaders.set(name, value)
  })
  responseHeaders.set('x-sanity-global-proxy', '1')
  return new Response(upstream.body, {status: upstream.status, headers: responseHeaders})
}

export const GET = proxy
export const POST = proxy
export const PUT = proxy
export const PATCH = proxy
export const DELETE = proxy
