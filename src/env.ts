// `sanity dev` and `sanity build` replace `process.env.SANITY_APP_*` with literal
// values at build time. Values come from the shell or `.env`.
// Everything here ends up in the browser bundle: identifiers only, never tokens.
declare const process: {env: Record<string, string | undefined>}

export const projectId = process.env.SANITY_APP_PROJECT_ID || ''
export const dataset = process.env.SANITY_APP_DATASET || 'production'
// Optional: limit the example document list to one `_type`.
export const documentType = process.env.SANITY_APP_DOCUMENT_TYPE || ''
// Optional: route global api.sanity.io calls through the /sanity-api proxy
// (needs api/sanity-proxy.ts deployed on the same origin).
export const useGlobalApiProxy = process.env.SANITY_APP_GLOBAL_API_PROXY === 'true'
