import {
  getSchedules,
  getPod,
  deletePod,
  createPod,
  savePodSpec,
  getSavedPodSpec,
  getWorkspaceMeta,
  getWorkspaceName,
  getWorkspaceUid,
} from '@workspacekit/k8s'
import type { Schedule } from '@workspacekit/types'

// ---------------------------------------------------------------------------
// Deduplication
// ---------------------------------------------------------------------------

/**
 * Tracks recently fired schedule actions to prevent duplicate execution.
 * Key format: `{workspace}:{action}:{day}:{hour}:{minute}`
 * Value: timestamp of when the action was fired.
 */
const firedMap = new Map<string, number>()

/** Window in milliseconds within which a duplicate firing is suppressed. */
const DEDUP_WINDOW_MS = 2 * 60 * 1000 // 2 minutes

function dedupKey(schedule: Schedule, day: string): string {
  return `${schedule.workspace}:${schedule.action}:${day}:${schedule.hour}:${schedule.minute}`
}

function wasFiredRecently(key: string, now: number): boolean {
  const ts = firedMap.get(key)
  if (ts === undefined) return false
  return now - ts < DEDUP_WINDOW_MS
}

function recordFired(key: string, now: number): void {
  firedMap.set(key, now)
}

/**
 * Purges entries older than the dedup window to prevent unbounded growth.
 */
function cleanFiredMap(now: number): void {
  for (const [key, ts] of firedMap) {
    if (now - ts > DEDUP_WINDOW_MS) {
      firedMap.delete(key)
    }
  }
}

/** Exposed for testing: clears the dedup map. */
export function _resetDedupMap(): void {
  firedMap.clear()
}

// ---------------------------------------------------------------------------
// Schedule checker
// ---------------------------------------------------------------------------

/**
 * Checks all schedules and fires matching actions for the current UTC time.
 */
export async function checkSchedules(): Promise<void> {
  const now = Date.now()
  const utcNow = new Date(now)

  const currentDay = utcNow.toLocaleString('en-US', {
    weekday: 'short',
    timeZone: 'UTC',
  }) // "Mon", "Tue", ...
  const currentHour = utcNow.getUTCHours()
  const currentMinute = utcNow.getUTCMinutes()

  let schedules: Schedule[]
  try {
    schedules = await getSchedules()
  } catch (err) {
    console.error('[scheduler] Failed to read schedules:', err)
    return
  }

  if (schedules.length === 0) return

  // Clean stale dedup entries
  cleanFiredMap(now)

  for (const schedule of schedules) {
    // Check if this schedule matches the current time
    if (schedule.hour !== currentHour) continue
    if (schedule.minute !== currentMinute) continue
    if (!schedule.days.includes(currentDay)) continue

    const key = dedupKey(schedule, currentDay)
    if (wasFiredRecently(key, now)) {
      continue
    }

    try {
      await fireScheduleAction(schedule)
      recordFired(key, now)
    } catch (err) {
      console.error(
        `[scheduler] Failed to fire ${schedule.action} for ${schedule.workspace}:`,
        err,
      )
    }
  }
}

// ---------------------------------------------------------------------------
// Action handlers
// ---------------------------------------------------------------------------

async function fireScheduleAction(schedule: Schedule): Promise<void> {
  if (schedule.action === 'stop') {
    await handleStop(schedule)
  } else if (schedule.action === 'start') {
    await handleStart(schedule)
  }
}

async function handleStop(schedule: Schedule): Promise<void> {
  const pod = await getPod(schedule.pod_name)
  if (!pod) {
    console.log(
      `[scheduler] Pod ${schedule.pod_name} not found for stop action, skipping`,
    )
    return
  }

  // Save the pod spec before deleting so it can be recreated on start
  const uid = getWorkspaceUid(pod)
  const workspaceName = getWorkspaceName(pod)
  if (uid) {
    await savePodSpec(uid, workspaceName, pod)
    console.log(`[scheduler] Saved pod spec for ${workspaceName} (uid=${uid})`)
  }

  await deletePod(schedule.pod_name)
  console.log(
    `[scheduler] Stopped workspace ${schedule.workspace} (deleted pod ${schedule.pod_name})`,
  )
}

async function handleStart(schedule: Schedule): Promise<void> {
  // Check if pod already exists (already running)
  const existingPod = await getPod(schedule.pod_name)
  if (existingPod) {
    console.log(
      `[scheduler] Pod ${schedule.pod_name} already exists for start action, skipping`,
    )
    return
  }

  // Try to find a saved pod spec.
  // Pod names follow the pattern ws-{uid}, so derive the uid from the name.
  const uid = schedule.pod_name.replace(/^ws-/, '')

  const savedSpec = await getSavedPodSpec(uid)
  if (savedSpec) {
    // Clear any resourceVersion / uid from the saved spec to allow re-creation
    if (savedSpec.metadata) {
      delete savedSpec.metadata.resourceVersion
      delete savedSpec.metadata.uid
      delete savedSpec.metadata.creationTimestamp
      if (savedSpec.metadata.annotations) {
        delete savedSpec.metadata.annotations['kubectl.kubernetes.io/last-applied-configuration']
      }
    }
    // Clear pod status
    delete (savedSpec as Record<string, unknown>).status

    await createPod(savedSpec)
    console.log(
      `[scheduler] Started workspace ${schedule.workspace} from saved spec`,
    )
    return
  }

  // Fall back to workspace meta
  const meta = await getWorkspaceMeta(schedule.workspace)
  if (meta?.data) {
    console.log(
      `[scheduler] Found workspace meta for ${schedule.workspace}, but pod recreation from meta requires the web server`,
    )
    // Workspace meta contains repo_url, image, etc. but full pod recreation
    // is better handled by the web server's create flow. Log for visibility.
    return
  }

  console.warn(
    `[scheduler] No saved spec or meta found for workspace ${schedule.workspace}, cannot start`,
  )
}

// ---------------------------------------------------------------------------
// Interval loop
// ---------------------------------------------------------------------------

/**
 * Starts the schedule checker on a repeating interval.
 */
export function startScheduler(intervalMs: number): void {
  // Run immediately on startup
  checkSchedules().catch((err) =>
    console.error('[scheduler] Initial check failed:', err),
  )

  setInterval(() => {
    checkSchedules().catch((err) =>
      console.error('[scheduler] Check failed:', err),
    )
  }, intervalMs)

  console.log(
    `[scheduler] Schedule checker started (interval=${intervalMs}ms)`,
  )
}
