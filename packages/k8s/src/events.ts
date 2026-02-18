import type { Event } from '@workspacekit/types'
import { coreV1, namespace } from './client.js'

/**
 * Lists events for a specific pod using a fieldSelector on involvedObject.name.
 * Returns an array of simplified event objects.
 */
export async function getPodEvents(podName: string): Promise<Event[]> {
  try {
    const response = await coreV1.listNamespacedEvent({
      namespace,
      fieldSelector: `involvedObject.name=${podName}`,
    })

    return response.items.map((event) => ({
      type: event.type ?? 'Normal',
      reason: event.reason ?? '',
      age: formatAge(event.lastTimestamp ?? event.eventTime ?? event.metadata?.creationTimestamp),
      message: event.message ?? '',
    }))
  } catch {
    return []
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Formats a timestamp into a human-readable relative age string.
 */
function formatAge(timestamp: Date | string | undefined | null): string {
  if (!timestamp) return ''

  const date = timestamp instanceof Date ? timestamp : new Date(timestamp)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()

  if (diffMs < 0) return '0s'

  const seconds = Math.floor(diffMs / 1000)
  if (seconds < 60) return `${seconds}s`

  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m`

  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h`

  const days = Math.floor(hours / 24)
  return `${days}d`
}
