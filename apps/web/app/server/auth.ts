/**
 * Session-based cookie authentication for TanStack Start.
 *
 * Replaces the Python HTTP Basic Auth with signed JSON cookies.
 * Users are loaded from a JSON file (config.usersFile) or fall back to a
 * single admin user from config.authUser / config.authPass.
 */

import crypto from 'node:crypto'
import fs from 'node:fs'
import { createMiddleware } from '@tanstack/react-start'
import { config } from '~/lib/config'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface UserRecord {
  username: string
  password: string
  role: 'admin' | 'user'
}

export interface SessionPayload {
  user: string
  role: string
  /** Epoch milliseconds when the session was created. */
  iat?: number
}

// ---------------------------------------------------------------------------
// Cookie config
// ---------------------------------------------------------------------------

const COOKIE_NAME = 'wsk_session'

/** Maximum session lifetime: 24 hours. */
const MAX_AGE_SECONDS = 86400

/** In-memory set of revoked session cookie values (cleared on restart). */
const revokedSessions = new Set<string>()

// ---------------------------------------------------------------------------
// User loading
// ---------------------------------------------------------------------------

/**
 * Loads the user list. Reads from the JSON file at `config.usersFile` if set,
 * otherwise creates a single admin user from config.authUser/authPass.
 */
function loadUsers(): UserRecord[] {
  if (config.usersFile) {
    try {
      const raw = fs.readFileSync(config.usersFile, 'utf-8')
      const parsed = JSON.parse(raw) as UserRecord[]
      if (Array.isArray(parsed)) {
        return parsed
      }
    } catch (err) {
      console.error(`[auth] Failed to load users file ${config.usersFile}:`, err)
    }
  }

  // Fallback: single admin user from env vars
  return [
    {
      username: config.authUser,
      password: config.authPass,
      role: 'admin',
    },
  ]
}

// ---------------------------------------------------------------------------
// Cookie signing
// ---------------------------------------------------------------------------

/**
 * Signs a payload string with HMAC-SHA256 using the session secret.
 */
function sign(payload: string): string {
  const hmac = crypto.createHmac('sha256', config.sessionSecret)
  hmac.update(payload)
  return hmac.digest('base64url')
}

/**
 * Creates a signed cookie value: `base64url(payload).signature`
 */
function signCookie(payload: SessionPayload): string {
  const json = JSON.stringify(payload)
  const encoded = Buffer.from(json, 'utf-8').toString('base64url')
  const signature = sign(encoded)
  return `${encoded}.${signature}`
}

/**
 * Verifies and decodes a signed cookie value.
 * Returns null if the signature is invalid or the payload is malformed.
 */
function verifyCookie(cookieValue: string): SessionPayload | null {
  const dotIndex = cookieValue.lastIndexOf('.')
  if (dotIndex === -1) return null

  const encoded = cookieValue.slice(0, dotIndex)
  const signature = cookieValue.slice(dotIndex + 1)

  const expectedSignature = sign(encoded)
  const sigBuf = Buffer.from(signature)
  const expectedBuf = Buffer.from(expectedSignature)
  if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
    return null
  }

  try {
    const json = Buffer.from(encoded, 'base64url').toString('utf-8')
    const parsed = JSON.parse(json)
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      typeof parsed.user === 'string' &&
      typeof parsed.role === 'string'
    ) {
      // Enforce server-side max age if iat is present
      if (typeof parsed.iat === 'number') {
        const now = Date.now()
        if (now - parsed.iat > MAX_AGE_SECONDS * 1000) return null
      }
      return { user: parsed.user, role: parsed.role, iat: parsed.iat }
    }
    return null
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Cookie header parsing
// ---------------------------------------------------------------------------

/**
 * Parses a raw `Cookie` header and returns the value for the given cookie name.
 */
function parseCookie(cookieHeader: string, name: string): string | null {
  const cookies = cookieHeader.split(';')
  for (const cookie of cookies) {
    const [cookieName, ...rest] = cookie.trim().split('=')
    if (cookieName === name) {
      return rest.join('=')
    }
  }
  return null
}

// ---------------------------------------------------------------------------
// Password verification (Fix 3)
// ---------------------------------------------------------------------------

/**
 * Compares a candidate password against a stored password.
 * Supports hashed passwords (argon2id/bcrypt) and plaintext.
 */
async function verifyPassword(candidate: string, stored: string): Promise<boolean> {
  // Hashed password (argon2 or bcrypt)
  if (stored.startsWith('$argon2') || stored.startsWith('$2b$') || stored.startsWith('$2a$')) {
    return Bun.password.verify(candidate, stored)
  }
  // Plaintext: constant-time comparison
  const candidateBuf = Buffer.from(candidate)
  const storedBuf = Buffer.from(stored)
  if (candidateBuf.length !== storedBuf.length) return false
  return crypto.timingSafeEqual(candidateBuf, storedBuf)
}

// ---------------------------------------------------------------------------
// RBAC helpers (Fix 7)
// ---------------------------------------------------------------------------

type Role = 'admin' | 'user'

/**
 * Checks that the session has one of the allowed roles.
 * Throws a 403 Response if the role is not permitted.
 */
export function requireRole(session: SessionPayload, ...allowedRoles: Role[]): void {
  if (!allowedRoles.includes(session.role as Role)) {
    throw new Response('Forbidden', { status: 403 })
  }
}

// ---------------------------------------------------------------------------
// CSRF helpers (Fix 10)
// ---------------------------------------------------------------------------

const CSRF_HEADER = 'x-requested-with'
const CSRF_VALUE = 'workspacekit'

/**
 * Validates the X-Requested-With header on mutation requests.
 * Throws a 403 Response if the header is missing or incorrect.
 */
export function requireCsrf(request: Request): void {
  const value = request.headers.get(CSRF_HEADER)
  if (value !== CSRF_VALUE) {
    throw new Response('Forbidden: missing CSRF header', { status: 403 })
  }
}

// ---------------------------------------------------------------------------
// Error sanitization (Fix 13)
// ---------------------------------------------------------------------------

/**
 * Strips internal details from error messages before returning to clients.
 */
export function sanitizeError(message: string): string {
  return message
    // Strip namespace references like "in namespace \"workspacekit\""
    .replace(/\bin namespace\s+"[^"]+"/gi, '')
    // Strip internal IP addresses (10.x, 172.16-31.x, 192.168.x)
    .replace(/\b(?:10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3})\b/g, '[internal]')
    // Strip node names (typically k8s node hostname patterns)
    .replace(/\bon node\s+"[^"]+"/gi, '')
    .trim()
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Validates a username/password combination against the loaded users.
 * Returns the matched user record or null if credentials are invalid.
 * Supports both hashed and plaintext passwords.
 */
export async function validateLogin(
  username: string,
  password: string,
): Promise<UserRecord | null> {
  const users = loadUsers()
  for (const u of users) {
    if (u.username === username && await verifyPassword(password, u.password)) {
      return u
    }
  }
  return null
}

/**
 * Creates a signed session cookie value for the given user record.
 */
export function createSession(user: UserRecord): string {
  return signCookie({
    user: user.username,
    role: user.role,
    iat: Date.now(),
  })
}

/**
 * Determines whether the Secure flag should be set based on the request URL.
 * Only set Secure when actually serving over HTTPS.
 */
export function isSecureOrigin(requestUrl: string | undefined): boolean {
  if (!requestUrl) return false
  try {
    return new URL(requestUrl).protocol === 'https:'
  } catch {
    return false
  }
}

/**
 * Builds a Set-Cookie header string for the session cookie.
 * Adds the Secure flag only when the request originated over HTTPS.
 */
export function buildSetCookieHeader(cookieValue: string, requestUrl?: string): string {
  const secure = isSecureOrigin(requestUrl) ? '; Secure' : ''
  return `${COOKIE_NAME}=${cookieValue}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${MAX_AGE_SECONDS}${secure}`
}

/**
 * Builds a Set-Cookie header that clears the session cookie (for logout).
 * Adds the Secure flag only when the request originated over HTTPS.
 */
export function buildClearCookieHeader(requestUrl?: string): string {
  const secure = isSecureOrigin(requestUrl) ? '; Secure' : ''
  return `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`
}

/**
 * Revokes a session cookie value so it can no longer be used.
 */
export function revokeSession(cookieHeader: string | null): void {
  if (!cookieHeader) return
  const value = parseCookie(cookieHeader, COOKIE_NAME)
  if (value) revokedSessions.add(value)
}

/**
 * Extracts and verifies the session from a Cookie header string.
 * Returns the session payload or null if not authenticated.
 */
export function getSession(
  cookieHeader: string | null,
): SessionPayload | null {
  if (!cookieHeader) return null
  const value = parseCookie(cookieHeader, COOKIE_NAME)
  if (!value) return null
  if (revokedSessions.has(value)) return null
  return verifyCookie(value)
}

/**
 * Extracts and verifies the session from a Request object.
 * Throws a 401 Response if the user is not authenticated.
 */
export function requireAuth(request: Request): SessionPayload {
  const cookieHeader = request.headers.get('cookie')
  const session = getSession(cookieHeader)
  if (!session) {
    throw new Response('Unauthorized', { status: 401 })
  }
  return session
}

/**
 * Auth guard for TanStack Start server functions (Fix 4).
 * Extracts the request from vinxi/http and validates the session.
 * Throws a 401 Response if not authenticated.
 */
export async function requireServerFnAuth(): Promise<SessionPayload> {
  const { getWebRequest } = await import('vinxi/http')
  const request = getWebRequest()
  const session = getSession(request.headers.get('cookie'))
  if (!session) {
    throw new Response('Unauthorized', { status: 401 })
  }
  return session
}

/**
 * TanStack Start middleware that checks for a valid session cookie.
 * Attaches `{ user, role }` to the context so downstream server functions
 * can access the authenticated user.
 */
export const authMiddleware = createMiddleware().server(
  async ({ next, context }) => {
    // The request is available in the context from TanStack Start
    const request = (context as Record<string, unknown>).request as
      | Request
      | undefined
    if (!request) {
      throw new Response('Unauthorized', { status: 401 })
    }

    const session = getSession(request.headers.get('cookie'))
    if (!session) {
      throw new Response('Unauthorized', { status: 401 })
    }

    return next({
      context: {
        ...context,
        session,
      },
    })
  },
)
