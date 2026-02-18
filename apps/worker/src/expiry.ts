import {
  getExpiryDays,
  listWorkspacePods,
  deletePod,
  patchPodAnnotations,
  getWorkspaceName,
  getWorkspaceUid,
  deletePvc,
  deleteService,
  deleteConfigMap,
} from '@workspacekit/k8s'

// ---------------------------------------------------------------------------
// Annotation keys
// ---------------------------------------------------------------------------

const LAST_ACCESSED_ANNOTATION = 'wsk/last-accessed'
const EXPIRY_WARNING_ANNOTATION = 'wsk/expiry-warning'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MS_PER_DAY = 86_400_000

// ---------------------------------------------------------------------------
// Expiry checker
// ---------------------------------------------------------------------------

/**
 * Checks all workspace pods for expiry based on idle time.
 *
 * If expiry days is 0, the check is disabled.
 * For each pod:
 *   - Reads the last-accessed annotation (falls back to creation timestamp)
 *   - If idle for longer than expiry_days: deletes the workspace
 *   - If idle for longer than (expiry_days - 1) and no warning: adds warning annotation
 */
export async function checkExpiry(): Promise<void> {
  let expiryDays: number
  try {
    expiryDays = await getExpiryDays()
  } catch (err) {
    console.error('[expiry] Failed to read expiry days:', err)
    return
  }

  if (expiryDays <= 0) {
    return // Expiry disabled
  }

  let pods: Awaited<ReturnType<typeof listWorkspacePods>>
  try {
    pods = await listWorkspacePods()
  } catch (err) {
    console.error('[expiry] Failed to list workspace pods:', err)
    return
  }

  const now = Date.now()

  for (const pod of pods) {
    const podName = pod.metadata?.name
    if (!podName) continue

    const workspaceName = getWorkspaceName(pod)
    const uid = getWorkspaceUid(pod)

    // Determine last accessed time
    const lastAccessedStr =
      pod.metadata?.annotations?.[LAST_ACCESSED_ANNOTATION]
    let lastAccessedMs: number

    if (lastAccessedStr) {
      lastAccessedMs = new Date(lastAccessedStr).getTime()
    } else {
      // Fall back to pod creation timestamp
      const creationStr = pod.metadata?.creationTimestamp
      if (creationStr) {
        lastAccessedMs =
          typeof creationStr === 'string'
            ? new Date(creationStr).getTime()
            : new Date(creationStr as unknown as string).getTime()
      } else {
        // No timestamp available, skip
        continue
      }
    }

    if (isNaN(lastAccessedMs)) continue

    const idleDays = (now - lastAccessedMs) / MS_PER_DAY

    if (idleDays > expiryDays) {
      // Workspace has expired -- delete all resources
      console.log(
        `[expiry] Workspace ${workspaceName} (pod=${podName}) expired ` +
          `(idle ${idleDays.toFixed(1)} days > ${expiryDays} days). Deleting...`,
      )

      try {
        await deleteWorkspaceResources(podName, uid, workspaceName)
        console.log(`[expiry] Deleted expired workspace ${workspaceName}`)
      } catch (err) {
        console.error(
          `[expiry] Failed to delete workspace ${workspaceName}:`,
          err,
        )
      }
    } else if (
      idleDays > expiryDays - 1 &&
      !pod.metadata?.annotations?.[EXPIRY_WARNING_ANNOTATION]
    ) {
      // Nearly expired -- add warning annotation
      console.log(
        `[expiry] Workspace ${workspaceName} (pod=${podName}) approaching expiry ` +
          `(idle ${idleDays.toFixed(1)} days, expires at ${expiryDays} days). Adding warning.`,
      )

      try {
        await patchPodAnnotations(podName, {
          [EXPIRY_WARNING_ANNOTATION]: new Date(now).toISOString(),
        })
      } catch (err) {
        console.error(
          `[expiry] Failed to add expiry warning to ${workspaceName}:`,
          err,
        )
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Resource cleanup for expired workspaces
// ---------------------------------------------------------------------------

async function deleteWorkspaceResources(
  podName: string,
  uid: string,
  workspaceName: string,
): Promise<void> {
  // Delete the pod
  await deletePod(podName)

  // Delete the PVC (pvc-{uid})
  if (uid) {
    try {
      await deletePvc(`pvc-${uid}`)
    } catch (err) {
      console.error(`[expiry] Failed to delete PVC pvc-${uid}:`, err)
    }
  }

  // Delete the service (svc-{uid})
  if (uid) {
    try {
      await deleteService(`svc-${uid}`)
    } catch (err) {
      console.error(`[expiry] Failed to delete service svc-${uid}:`, err)
    }
  }

  // Delete workspace meta configmap (meta-{name})
  try {
    await deleteConfigMap(`meta-${workspaceName}`)
  } catch (err) {
    console.error(
      `[expiry] Failed to delete meta configmap for ${workspaceName}:`,
      err,
    )
  }

  // Delete saved spec configmap (saved-{uid})
  if (uid) {
    try {
      await deleteConfigMap(`saved-${uid}`)
    } catch (err) {
      console.error(
        `[expiry] Failed to delete saved spec for uid=${uid}:`,
        err,
      )
    }
  }
}

// ---------------------------------------------------------------------------
// Interval loop
// ---------------------------------------------------------------------------

/**
 * Starts the expiry checker on a repeating interval.
 */
export function startExpiryChecker(intervalMs: number): void {
  // Run immediately on startup
  checkExpiry().catch((err) =>
    console.error('[expiry] Initial check failed:', err),
  )

  setInterval(() => {
    checkExpiry().catch((err) =>
      console.error('[expiry] Check failed:', err),
    )
  }, intervalMs)

  console.log(
    `[expiry] Expiry checker started (interval=${intervalMs}ms)`,
  )
}
