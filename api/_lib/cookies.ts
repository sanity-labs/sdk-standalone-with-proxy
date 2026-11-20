import {isProduction} from './env.js'

export const SESSION_COOKIE_NAME = 'sanity_session'
export const OAUTH_TX_COOKIE_NAME = 'sanity_oauth_tx'

export function readCookie(request: Request, name: string): string | undefined {
  const header = request.headers.get('cookie')
  if (!header) return undefined
  for (const part of header.split(';')) {
    const index = part.indexOf('=')
    if (index === -1) continue
    if (part.slice(0, index).trim() !== name) continue
    const value = part.slice(index + 1).trim()
    try {
      return decodeURIComponent(value)
    } catch {
      return value
    }
  }
  return undefined
}

// httpOnly, SameSite=Lax, Secure in production. maxAge 0 clears the cookie.
export function setCookie(headers: Headers, name: string, value: string, maxAge: number): void {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    'Path=/',
    `Max-Age=${maxAge}`,
    'HttpOnly',
    'SameSite=Lax',
  ]
  if (isProduction) parts.push('Secure')
  headers.append('set-cookie', parts.join('; '))
}

export function clearCookie(headers: Headers, name: string): void {
  setCookie(headers, name, '', 0)
}
