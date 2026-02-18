import { createAPIFileRoute } from '@tanstack/react-start/api'
import { z } from 'zod'
import { SetExpiryInputSchema } from '@workspacekit/types'
import { getExpiryDays, setExpiryDays } from '@workspacekit/k8s'
import { requireAuth, requireCsrf, requireRole, sanitizeError } from '~/server/auth'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function ok(message: string): Response {
  return json({ ok: true, message })
}

function fail(message: string, status = 400): Response {
  return json({ ok: false, message }, status)
}

// ---------------------------------------------------------------------------
// Route
// ---------------------------------------------------------------------------

export const APIRoute = createAPIFileRoute('/api/expiry')({
  GET: async ({ request }) => {
    try {
      requireAuth(request)
      const days = await getExpiryDays()
      return json({ days })
    } catch (err) {
      if (err instanceof Response) throw err
      const message =
        err instanceof Error ? err.message : 'Internal server error'
      console.error('[api/expiry] GET error:', err)
      return fail(sanitizeError(message), 500)
    }
  },

  POST: async ({ request }) => {
    try {
      const session = requireAuth(request)
      requireCsrf(request)
      requireRole(session, 'admin')

      let body: unknown
      try {
        body = await request.json()
      } catch {
        return fail('Invalid JSON body')
      }
      const input = SetExpiryInputSchema.parse(body)

      await setExpiryDays(input.days)

      return ok(
        input.days > 0
          ? `Expiry set to ${input.days} day(s)`
          : 'Expiry disabled',
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
      console.error('[api/expiry] POST error:', err)
      return fail(sanitizeError(message), 500)
    }
  },
})
