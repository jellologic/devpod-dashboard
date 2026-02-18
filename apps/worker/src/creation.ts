import {
  listWorkspacePods,
  isPodReady,
  patchPodAnnotations,
} from '@workspacekit/k8s'

// ---------------------------------------------------------------------------
// Annotation keys
// ---------------------------------------------------------------------------

const STUCK_ANNOTATION = 'wsk/creation-stuck'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum time a pod is allowed to be in a non-ready state before being flagged. */
const STUCK_THRESHOLD_MS = 10 * 60 * 1000 // 10 minutes

// ---------------------------------------------------------------------------
// Creation monitor
// ---------------------------------------------------------------------------

/**
 * Scans workspace pods that are not yet Running/ready. If a pod has been
 * in a non-ready state for longer than the stuck threshold, it gets annotated
 * so the dashboard can display a warning.
 *
 * This serves as a safety net -- the web server polls pod status directly,
 * but this background check catches pods that may have been missed.
 */
export async function checkCreatingPods(): Promise<void> {
  let pods: Awaited<ReturnType<typeof listWorkspacePods>>
  try {
    pods = await listWorkspacePods()
  } catch (err) {
    console.error('[creation] Failed to list workspace pods:', err)
    return
  }

  const now = Date.now()

  for (const pod of pods) {
    const podName = pod.metadata?.name
    if (!podName) continue

    // Skip pods that are already ready
    if (isPodReady(pod)) continue

    // Skip pods that are already annotated as stuck
    if (pod.metadata?.annotations?.[STUCK_ANNOTATION]) continue

    // Determine how long the pod has been creating
    const creationStr = pod.metadata?.creationTimestamp
    if (!creationStr) continue

    const createdAtMs =
      typeof creationStr === 'string'
        ? new Date(creationStr).getTime()
        : new Date(creationStr as unknown as string).getTime()

    if (isNaN(createdAtMs)) continue

    const elapsedMs = now - createdAtMs

    if (elapsedMs > STUCK_THRESHOLD_MS) {
      // Determine the reason for being stuck
      const reason = getStuckReason(pod)
      const message = `Pod ${podName} stuck creating for ${Math.round(elapsedMs / 60_000)} minutes: ${reason}`

      console.warn(`[creation] ${message}`)

      try {
        await patchPodAnnotations(podName, {
          [STUCK_ANNOTATION]: new Date(now).toISOString(),
          'wsk/creation-stuck-reason': reason,
        })
      } catch (err) {
        console.error(
          `[creation] Failed to annotate stuck pod ${podName}:`,
          err,
        )
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Extracts a human-readable reason for why the pod is not ready.
 */
function getStuckReason(pod: {
  status?: {
    phase?: string
    containerStatuses?: Array<{
      state?: {
        waiting?: { reason?: string; message?: string }
        terminated?: { reason?: string; message?: string }
      }
    }>
    initContainerStatuses?: Array<{
      state?: {
        waiting?: { reason?: string; message?: string }
        terminated?: { reason?: string; exitCode?: number }
      }
    }>
    conditions?: Array<{
      type?: string
      status?: string
      reason?: string
      message?: string
    }>
  }
}): string {
  // Check container statuses first
  const containerStatuses = pod.status?.containerStatuses ?? []
  for (const cs of containerStatuses) {
    const waiting = cs.state?.waiting
    if (waiting?.reason) {
      return waiting.reason + (waiting.message ? `: ${waiting.message}` : '')
    }
    const terminated = cs.state?.terminated
    if (terminated?.reason) {
      return terminated.reason + (terminated.message ? `: ${terminated.message}` : '')
    }
  }

  // Check init container statuses
  const initStatuses = pod.status?.initContainerStatuses ?? []
  for (const is of initStatuses) {
    const waiting = is.state?.waiting
    if (waiting?.reason) {
      return `Init container: ${waiting.reason}`
    }
    const terminated = is.state?.terminated
    if (terminated?.reason) {
      return `Init container: ${terminated.reason}`
    }
  }

  // Check pod conditions
  const conditions = pod.status?.conditions ?? []
  for (const cond of conditions) {
    if (cond.status === 'False' && cond.reason) {
      return cond.reason + (cond.message ? `: ${cond.message}` : '')
    }
  }

  // Fallback to phase
  return pod.status?.phase ?? 'Unknown'
}

// ---------------------------------------------------------------------------
// Interval loop
// ---------------------------------------------------------------------------

/**
 * Starts the creation monitor on a repeating interval.
 */
export function startCreationMonitor(intervalMs: number): void {
  // Run immediately on startup
  checkCreatingPods().catch((err) =>
    console.error('[creation] Initial check failed:', err),
  )

  setInterval(() => {
    checkCreatingPods().catch((err) =>
      console.error('[creation] Check failed:', err),
    )
  }, intervalMs)

  console.log(
    `[creation] Creation monitor started (interval=${intervalMs}ms)`,
  )
}
