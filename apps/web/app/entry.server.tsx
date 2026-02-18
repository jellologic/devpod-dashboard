import { getRouterManifest } from '@tanstack/react-start/router-manifest'
import {
  createStartHandler,
  defaultStreamHandler,
} from '@tanstack/react-start/server'
import { createRouter } from './router'
import { startStatsCollection } from './server/stats'
import { getSession } from './server/auth'
import { exec, namespace, getPod } from '@workspacekit/k8s'
import { PassThrough } from 'node:stream'

// Start background stats collection when the server starts
startStatsCollection()

// ---------------------------------------------------------------------------
// TanStack Start request handler
// ---------------------------------------------------------------------------

const handler = createStartHandler({
  createRouter,
  getRouterManifest,
})(defaultStreamHandler)

// ---------------------------------------------------------------------------
// Bun server with WebSocket support for terminal
// ---------------------------------------------------------------------------

export default {
  async fetch(request: Request, server: any) {
    // Check for WebSocket upgrade on /api/terminal/{pod} paths
    const upgradeHeader = request.headers.get('upgrade')
    if (upgradeHeader?.toLowerCase() === 'websocket') {
      const url = new URL(request.url)
      const match = url.pathname.match(/^\/api\/terminal\/([^/]+)/)
      if (match) {
        // Auth check via cookie
        const session = getSession(request.headers.get('cookie'))
        if (!session) {
          return new Response('Unauthorized', { status: 401 })
        }

        const podName = decodeURIComponent(match[1])

        // Pod access restriction (Fix 8): non-admin users can only
        // access pods they own (wsk/owner annotation matches username)
        if (session.role !== 'admin') {
          try {
            const pod = await getPod(podName)
            if (!pod) {
              return new Response('Pod not found', { status: 404 })
            }
            const podOwner = pod.metadata?.annotations?.['wsk/owner'] ?? ''
            if (podOwner !== session.user) {
              return new Response('Forbidden: you can only access your own pods', { status: 403 })
            }
          } catch {
            return new Response('Failed to verify pod ownership', { status: 500 })
          }
        }

        const upgraded = server.upgrade(request, { data: { pod: podName } })
        if (upgraded) return undefined
        return new Response('WebSocket upgrade failed', { status: 500 })
      }
    }

    // All other requests -> TanStack Start handler
    return handler(request)
  },

  websocket: {
    open(ws: any) {
      const pod: string = ws.data.pod
      const stdin = new PassThrough()
      const stdout = new PassThrough()
      const stderr = new PassThrough()

      // Forward container stdout/stderr to the browser WebSocket
      stdout.on('data', (chunk: Buffer) => {
        try {
          ws.send(chunk)
        } catch {
          // WebSocket may have closed
        }
      })
      stderr.on('data', (chunk: Buffer) => {
        try {
          ws.send(chunk)
        } catch {
          // WebSocket may have closed
        }
      })

      // Spawn interactive shell in the pod
      exec
        .exec(
          namespace,
          pod,
          'dev',
          ['sh'],
          stdout,
          stderr,
          stdin,
          true, // tty
        )
        .then((k8sWs: any) => {
          ws.data.k8sWs = k8sWs
          ws.data.stdin = stdin
        })
        .catch((err: unknown) => {
          const msg =
            err instanceof Error ? err.message : 'Failed to exec into pod'
          console.error('[terminal] exec error:', msg)
          try {
            ws.send(`\r\nError: ${msg}\r\n`)
            ws.close()
          } catch {
            // Already closed
          }
        })
    },

    message(ws: any, message: string | Buffer) {
      const stdin: PassThrough | undefined = ws.data.stdin
      if (!stdin) return

      // Check if this is a resize message (JSON with cols/rows)
      if (typeof message === 'string') {
        try {
          const parsed = JSON.parse(message)
          if (parsed.type === 'resize' && parsed.cols && parsed.rows) {
            // K8s exec resize is handled via the WebSocket protocol
            // For now, just ignore resize messages gracefully
            return
          }
        } catch {
          // Not JSON, treat as keystroke data
        }
      }

      // Forward keystrokes to pod stdin
      stdin.write(typeof message === 'string' ? message : Buffer.from(message))
    },

    close(ws: any) {
      const stdin: PassThrough | undefined = ws.data.stdin
      const k8sWs: any = ws.data.k8sWs

      if (stdin) {
        stdin.end()
      }
      if (k8sWs && typeof k8sWs.close === 'function') {
        k8sWs.close()
      }
    },
  },
}
