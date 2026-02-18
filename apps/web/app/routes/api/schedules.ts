import { createAPIFileRoute } from '@tanstack/react-start/api'
import { z } from 'zod'
import { SetScheduleInputSchema, RemoveScheduleInputSchema } from '@workspacekit/types'
import type { Schedule } from '@workspacekit/types'
import { getSchedules, saveSchedules } from '@workspacekit/k8s'
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
// POST action schema
// ---------------------------------------------------------------------------

const ScheduleActionSchema = z.object({
  action: z.enum(['set', 'remove']),
})

// ---------------------------------------------------------------------------
// Route
// ---------------------------------------------------------------------------

export const APIRoute = createAPIFileRoute('/api/schedules')({
  GET: async ({ request }) => {
    try {
      requireAuth(request)
      const schedules = await getSchedules()
      return json(schedules)
    } catch (err) {
      if (err instanceof Response) throw err
      const message =
        err instanceof Error ? err.message : 'Internal server error'
      console.error('[api/schedules] GET error:', err)
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
      const { action } = ScheduleActionSchema.parse(body)

      switch (action) {
        case 'set':
          return await handleSetSchedule(body)
        case 'remove':
          return await handleRemoveSchedule(body)
        default:
          return fail(`Unknown action: ${action}`)
      }
    } catch (err) {
      if (err instanceof Response) throw err
      if (err instanceof z.ZodError) {
        return fail(
          `Validation error: ${err.errors.map((e) => e.message).join(', ')}`,
        )
      }
      const message =
        err instanceof Error ? err.message : 'Internal server error'
      console.error('[api/schedules] POST error:', err)
      return fail(sanitizeError(message), 500)
    }
  },
})

// ---------------------------------------------------------------------------
// Action handlers
// ---------------------------------------------------------------------------

async function handleSetSchedule(body: unknown): Promise<Response> {
  const input = SetScheduleInputSchema.parse(body)
  const schedules = await getSchedules()

  // Remove any existing schedule for the same workspace + action
  const filtered = schedules.filter(
    (s) => !(s.workspace === input.workspace && s.action === input.action),
  )

  const newSchedule: Schedule = {
    workspace: input.workspace,
    pod_name: input.pod_name,
    action: input.action,
    days: input.days,
    hour: input.hour,
    minute: input.minute,
  }

  filtered.push(newSchedule)
  await saveSchedules(filtered)

  return ok(
    `Schedule "${input.action}" set for workspace "${input.workspace}"`,
  )
}

async function handleRemoveSchedule(body: unknown): Promise<Response> {
  const input = RemoveScheduleInputSchema.parse(body)
  const schedules = await getSchedules()

  const filtered = schedules.filter(
    (s) => !(s.workspace === input.workspace && s.action === input.action),
  )

  if (filtered.length === schedules.length) {
    return fail(
      `No "${input.action}" schedule found for workspace "${input.workspace}"`,
      404,
    )
  }

  await saveSchedules(filtered)

  return ok(
    `Schedule "${input.action}" removed for workspace "${input.workspace}"`,
  )
}
