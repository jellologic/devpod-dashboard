import { createAPIFileRoute } from '@tanstack/react-start/api'
import { z } from 'zod'
import { LoginInputSchema } from '@workspacekit/types'
import {
  validateLogin,
  createSession,
  buildSetCookieHeader,
  buildClearCookieHeader,
  requireAuth,
  revokeSession,
  requireCsrf,
  sanitizeError,
} from '~/server/auth'

// ---------------------------------------------------------------------------
// Rate limiting (Fix 5)
// ---------------------------------------------------------------------------

const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000 // 15 minutes
const RATE_LIMIT_MAX = 5

const loginAttempts = new Map<string, { count: number; firstAttempt: number }>()

// Periodically clean up expired entries
setInterval(() => {
  const now = Date.now()
  for (const [ip, entry] of loginAttempts) {
    if (now - entry.firstAttempt > RATE_LIMIT_WINDOW_MS) {
      loginAttempts.delete(ip)
    }
  }
}, 60_000)

function getClientIp(request: Request): string {
  return (
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip') ||
    'unknown'
  )
}

function checkRateLimit(ip: string): boolean {
  const now = Date.now()
  const entry = loginAttempts.get(ip)

  if (!entry || now - entry.firstAttempt > RATE_LIMIT_WINDOW_MS) {
    loginAttempts.set(ip, { count: 1, firstAttempt: now })
    return true
  }

  if (entry.count >= RATE_LIMIT_MAX) {
    return false
  }

  entry.count++
  return true
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function json(data: unknown, status = 200, headers?: Record<string, string>): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  })
}

function fail(message: string, status = 400): Response {
  return json({ ok: false, message }, status)
}

// ---------------------------------------------------------------------------
// Route
// ---------------------------------------------------------------------------

export const APIRoute = createAPIFileRoute('/api/login')({
  POST: async ({ request }) => {
    try {
      // Rate limit check (Fix 5)
      const ip = getClientIp(request)
      if (!checkRateLimit(ip)) {
        return fail('Too many login attempts. Try again later.', 429)
      }

      let body: unknown
      try {
        body = await request.json()
      } catch {
        return fail('Invalid JSON body')
      }
      const input = LoginInputSchema.parse(body)

      const user = await validateLogin(input.username, input.password)
      if (!user) {
        return fail('Invalid credentials', 401)
      }

      // Reset rate limit on successful login
      loginAttempts.delete(ip)

      const cookieValue = createSession(user)
      const setCookie = buildSetCookieHeader(cookieValue, request.url)

      return json(
        { ok: true, message: 'Login successful' },
        200,
        { 'Set-Cookie': setCookie },
      )
    } catch (err) {
      if (err instanceof Response) throw err
      if (err instanceof z.ZodError) {
        return fail(
          `Validation error: ${err.errors.map((e) => e.message).join(', ')}`,
        )
      }
      const message =
        err instanceof Error ? err.message : 'Internal server error'
      console.error('[api/login] POST error:', err)
      return fail(sanitizeError(message), 500)
    }
  },

  DELETE: async ({ request }) => {
    try {
      requireAuth(request)
      requireCsrf(request)
      revokeSession(request.headers.get('cookie'))

      const clearCookie = buildClearCookieHeader(request.url)

      return json(
        { ok: true, message: 'Logged out' },
        200,
        { 'Set-Cookie': clearCookie },
      )
    } catch (err) {
      if (err instanceof Response) throw err
      const message =
        err instanceof Error ? err.message : 'Internal server error'
      console.error('[api/login] DELETE error:', err)
      return fail(sanitizeError(message), 500)
    }
  },
})
