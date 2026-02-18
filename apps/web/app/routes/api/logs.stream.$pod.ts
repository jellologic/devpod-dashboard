import { createAPIFileRoute } from '@tanstack/react-start/api'
import { coreV1, namespace } from '@workspacekit/k8s'
import { requireAuth, sanitizeError } from '~/server/auth'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fail(message: string, status = 400): Response {
  return new Response(JSON.stringify({ ok: false, message }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

// ---------------------------------------------------------------------------
// Route
// ---------------------------------------------------------------------------

export const APIRoute = createAPIFileRoute('/api/logs/stream/$pod')({
  GET: async ({ request, params }) => {
    try {
      requireAuth(request)

      const { pod } = params

      if (!pod) {
        return fail('Missing pod parameter')
      }

      // Use the K8s API to stream pod logs via SSE.
      const logResponse = await coreV1.readNamespacedPodLog({
        name: pod,
        namespace,
        follow: true,
        tailLines: 200,
        timestamps: true,
      })

      const logText =
        typeof logResponse === 'string'
          ? logResponse
          : String(logResponse)

      const encoder = new TextEncoder()

      const stream = new ReadableStream({
        start(controller) {
          const lines = logText.split('\n')
          for (const line of lines) {
            if (line.trim()) {
              controller.enqueue(
                encoder.encode(`data: ${JSON.stringify(line)}\n\n`),
              )
            }
          }

          let lastLineCount = lines.length

          const pollInterval = setInterval(async () => {
            try {
              const freshLog = await coreV1.readNamespacedPodLog({
                name: pod,
                namespace,
                tailLines: 500,
                timestamps: true,
              })

              const freshText =
                typeof freshLog === 'string'
                  ? freshLog
                  : String(freshLog)
              const freshLines = freshText.split('\n')

              if (freshLines.length > lastLineCount) {
                for (let i = lastLineCount; i < freshLines.length; i++) {
                  if (freshLines[i].trim()) {
                    controller.enqueue(
                      encoder.encode(
                        `data: ${JSON.stringify(freshLines[i])}\n\n`,
                      ),
                    )
                  }
                }
                lastLineCount = freshLines.length
              }
            } catch {
              clearInterval(pollInterval)
              controller.enqueue(
                encoder.encode(
                  `data: ${JSON.stringify('[stream ended]')}\n\n`,
                ),
              )
              controller.close()
            }
          }, 2000)

          request.signal.addEventListener('abort', () => {
            clearInterval(pollInterval)
            try {
              controller.close()
            } catch {
              // Already closed
            }
          })
        },
      })

      return new Response(stream, {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
        },
      })
    } catch (err) {
      if (err instanceof Response) throw err
      const message =
        err instanceof Error ? err.message : 'Internal server error'
      console.error('[api/logs/stream] Error:', err)
      return fail(sanitizeError(message), 500)
    }
  },
})
