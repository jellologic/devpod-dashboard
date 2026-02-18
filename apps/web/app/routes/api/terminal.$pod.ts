import { createAPIFileRoute } from '@tanstack/react-start/api'
import { exec, namespace } from '@workspacekit/k8s'
import { requireAuth, requireCsrf, sanitizeError } from '~/server/auth'
import { PassThrough } from 'node:stream'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function fail(message: string, status = 400): Response {
  return json({ ok: false, message }, status)
}

// ---------------------------------------------------------------------------
// Route
// ---------------------------------------------------------------------------

export const APIRoute = createAPIFileRoute('/api/terminal/$pod')({
  GET: async ({ request, params }) => {
    try {
      requireAuth(request)

      const { pod } = params

      if (!pod) {
        return fail('Missing pod parameter')
      }

      return json({
        ok: true,
        pod,
        namespace,
        message:
          'Terminal ready. Connect via WebSocket at the adapter-level endpoint.',
        websocket_path: `/api/terminal/${pod}/ws`,
      })
    } catch (err) {
      if (err instanceof Response) throw err
      const message =
        err instanceof Error ? err.message : 'Internal server error'
      console.error('[api/terminal] GET error:', err)
      return fail(sanitizeError(message), 500)
    }
  },

  POST: async ({ request, params }) => {
    try {
      requireAuth(request)
      requireCsrf(request)

      const { pod } = params

      if (!pod) {
        return fail('Missing pod parameter')
      }

      let body: Record<string, unknown>
      try {
        body = await request.json() as Record<string, unknown>
      } catch {
        return fail('Invalid JSON body')
      }
      const command: string[] = Array.isArray(body.command)
        ? body.command
        : ['sh', '-c', String(body.command ?? 'echo "no command"')]

      const stdout = new PassThrough()
      const stderr = new PassThrough()

      let stdoutData = ''
      let stderrData = ''

      stdout.on('data', (chunk: Buffer) => {
        stdoutData += chunk.toString('utf-8')
      })
      stderr.on('data', (chunk: Buffer) => {
        stderrData += chunk.toString('utf-8')
      })

      const ws = await exec.exec(
        namespace,
        pod,
        'dev',
        command,
        stdout,
        stderr,
        null, // stdin
        false, // tty
      )

      // Wait for the exec to finish
      await new Promise<void>((resolve) => {
        const onClose = () => {
          resolve()
        }

        if (ws && typeof ws.onclose === 'function') {
          ws.onclose = onClose
        } else if (ws && 'on' in ws) {
          ;(ws as unknown as NodeJS.EventEmitter).on('close', onClose)
        } else {
          setTimeout(resolve, 3000)
        }
      })

      return json({
        ok: true,
        stdout: stdoutData,
        stderr: stderrData,
      })
    } catch (err) {
      if (err instanceof Response) throw err
      const message =
        err instanceof Error ? err.message : 'Internal server error'
      console.error('[api/terminal] POST error:', err)
      return fail(sanitizeError(message), 500)
    }
  },
})
