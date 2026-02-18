import { createAPIFileRoute } from '@tanstack/react-start/api'
import { z } from 'zod'
import {
  SaveLimitRangeInputSchema,
  SaveQuotaInputSchema,
  SaveDefaultsInputSchema,
} from '@workspacekit/types'
import {
  saveLimitRange,
  saveResourceQuota,
  saveWorkspaceDefaults,
} from '@workspacekit/k8s'
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

const SettingsActionSchema = z.object({
  action: z.enum(['save-limitrange', 'save-quota', 'save-defaults']),
})

// ---------------------------------------------------------------------------
// Route
// ---------------------------------------------------------------------------

export const APIRoute = createAPIFileRoute('/api/settings')({
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
      const { action } = SettingsActionSchema.parse(body)

      switch (action) {
        case 'save-limitrange':
          return await handleSaveLimitRange(body)
        case 'save-quota':
          return await handleSaveQuota(body)
        case 'save-defaults':
          return await handleSaveDefaults(body)
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
      console.error('[api/settings] Error:', err)
      return fail(sanitizeError(message), 500)
    }
  },
})

// ---------------------------------------------------------------------------
// Action handlers
// ---------------------------------------------------------------------------

async function handleSaveLimitRange(body: unknown): Promise<Response> {
  const input = SaveLimitRangeInputSchema.parse(body)

  await saveLimitRange(
    input.max_cpu,
    input.max_mem,
    input.def_req_cpu,
    input.def_req_mem,
  )

  return ok('LimitRange saved')
}

async function handleSaveQuota(body: unknown): Promise<Response> {
  const input = SaveQuotaInputSchema.parse(body)

  await saveResourceQuota(input.req_cpu, input.req_mem, input.pods)

  return ok('ResourceQuota saved')
}

async function handleSaveDefaults(body: unknown): Promise<Response> {
  const input = SaveDefaultsInputSchema.parse(body)

  await saveWorkspaceDefaults({
    req_cpu: input.req_cpu,
    req_mem: input.req_mem,
    lim_cpu: input.lim_cpu,
    lim_mem: input.lim_mem,
  })

  return ok('Workspace defaults saved')
}
