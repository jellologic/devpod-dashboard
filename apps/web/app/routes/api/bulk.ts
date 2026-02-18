import { createAPIFileRoute } from '@tanstack/react-start/api'
import { z } from 'zod'
import { BulkActionInputSchema } from '@workspacekit/types'
import {
  deletePod,
  deleteService,
  deletePvc,
  getSavedPodSpec,
  createPod,
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

// ---------------------------------------------------------------------------
// Route
// ---------------------------------------------------------------------------

export const APIRoute = createAPIFileRoute('/api/bulk')({
  POST: async ({ request }) => {
    try {
      const session = requireAuth(request)
      requireCsrf(request)

      let body: unknown
      try {
        body = await request.json()
      } catch {
        return json({ ok: false, message: 'Invalid JSON body' }, 400)
      }
      const input = BulkActionInputSchema.parse(body)

      // RBAC: bulk delete requires admin
      if (input.action === 'delete') {
        requireRole(session, 'admin')
      } else {
        requireRole(session, 'admin', 'user')
      }

      const results: { name: string; ok: boolean; message: string }[] = []

      for (const workspace of input.workspaces) {
        try {
          switch (input.action) {
            case 'stop': {
              await deletePod(workspace.pod, 30)
              results.push({
                name: workspace.name,
                ok: true,
                message: 'Stopped',
              })
              break
            }

            case 'start': {
              const uid = workspace.pod.replace(/^ws-/, '')
              const savedSpec = await getSavedPodSpec(uid)
              if (!savedSpec) {
                results.push({
                  name: workspace.name,
                  ok: false,
                  message: 'No saved spec found',
                })
                break
              }
              await createPod(savedSpec)
              results.push({
                name: workspace.name,
                ok: true,
                message: 'Started',
              })
              break
            }

            case 'delete': {
              await deletePod(workspace.pod, 0)
              await deleteService(`svc-${workspace.uid}`)
              await deletePvc(`pvc-${workspace.uid}`)
              results.push({
                name: workspace.name,
                ok: true,
                message: 'Deleted',
              })
              break
            }
          }
        } catch (err) {
          const message =
            err instanceof Error ? err.message : 'Unknown error'
          results.push({ name: workspace.name, ok: false, message: sanitizeError(message) })
        }
      }

      const allOk = results.every((r) => r.ok)
      return json({
        ok: allOk,
        message: allOk
          ? `Bulk ${input.action} completed for ${results.length} workspace(s)`
          : `Bulk ${input.action} completed with errors`,
        results,
      })
    } catch (err) {
      if (err instanceof Response) throw err
      if (err instanceof z.ZodError) {
        return json(
          {
            ok: false,
            message: `Validation error: ${err.errors.map((e) => e.message).join(', ')}`,
          },
          400,
        )
      }
      const message =
        err instanceof Error ? err.message : 'Internal server error'
      console.error('[api/bulk] Error:', err)
      return json({ ok: false, message: sanitizeError(message) }, 500)
    }
  },
})
