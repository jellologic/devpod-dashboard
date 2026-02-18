import {
  listWorkspacePods,
  listWorkspacePvcs,
  listWorkspaceServices,
  listConfigMaps,
  deleteService,
  deleteConfigMap,
  getWorkspaceUid,
} from '@workspacekit/k8s'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** ConfigMaps with component=creating older than this are considered stale. */
const STALE_CREATING_THRESHOLD_MS = 60 * 60 * 1000 // 1 hour

// ---------------------------------------------------------------------------
// Cleanup logic
// ---------------------------------------------------------------------------

/**
 * Scans for orphaned resources and cleans up what is safe to remove:
 *
 * 1. PVCs with no matching pod, saved-spec, or meta ConfigMap -- logged only
 *    (too dangerous to auto-delete persistent storage).
 * 2. Services with no matching pod and no saved spec -- deleted.
 * 3. Stale `creating-*` ConfigMaps older than 1 hour -- deleted.
 */
export async function cleanupOrphans(): Promise<void> {
  let pods: Awaited<ReturnType<typeof listWorkspacePods>>
  let pvcs: Awaited<ReturnType<typeof listWorkspacePvcs>>
  let services: Awaited<ReturnType<typeof listWorkspaceServices>>

  try {
    ;[pods, pvcs, services] = await Promise.all([
      listWorkspacePods(),
      listWorkspacePvcs(),
      listWorkspaceServices(),
    ])
  } catch (err) {
    console.error('[cleanup] Failed to list resources:', err)
    return
  }

  // Build sets of known UIDs from pods
  const podUids = new Set<string>()
  for (const pod of pods) {
    const uid = getWorkspaceUid(pod)
    if (uid) podUids.add(uid)
  }

  // Load saved-spec and meta ConfigMaps to check for stopped workspaces
  let savedSpecCms: Awaited<ReturnType<typeof listConfigMaps>> = []
  let metaCms: Awaited<ReturnType<typeof listConfigMaps>> = []
  try {
    ;[savedSpecCms, metaCms] = await Promise.all([
      listConfigMaps('managed-by=workspacekit,component=saved-spec').catch(
        () => [] as Awaited<ReturnType<typeof listConfigMaps>>,
      ),
      listConfigMaps(
        'managed-by=workspacekit,component=workspace-meta',
      ).catch(() => [] as Awaited<ReturnType<typeof listConfigMaps>>),
    ])
  } catch {
    // Non-fatal: proceed with empty lists
  }

  const savedSpecUids = new Set<string>()
  for (const cm of savedSpecCms) {
    const uid = cm.metadata?.labels?.['workspace-uid']
    if (uid) savedSpecUids.add(uid)
  }

  const metaNames = new Set<string>()
  for (const cm of metaCms) {
    const name = cm.metadata?.labels?.['workspace-name']
    if (name) metaNames.add(name)
  }

  // ------ PVC orphan detection (log only) ------
  for (const pvc of pvcs) {
    const pvcUid = pvc.metadata?.labels?.['workspace-uid']
    if (!pvcUid) continue

    const hasMatchingPod = podUids.has(pvcUid)
    const hasSavedSpec = savedSpecUids.has(pvcUid)
    const pvcName = pvc.metadata?.labels?.['workspace-name'] ?? ''
    const hasMeta = metaNames.has(pvcName)

    if (!hasMatchingPod && !hasSavedSpec && !hasMeta) {
      console.warn(
        `[cleanup] Orphaned PVC detected: ${pvc.metadata?.name} ` +
          `(uid=${pvcUid}, workspace=${pvcName}). Manual cleanup required.`,
      )
    }
  }

  // ------ Service orphan cleanup ------
  for (const svc of services) {
    const svcUid = svc.metadata?.labels?.['workspace-uid']
    if (!svcUid) continue

    const hasMatchingPod = podUids.has(svcUid)
    const hasSavedSpec = savedSpecUids.has(svcUid)

    if (!hasMatchingPod && !hasSavedSpec) {
      const svcName = svc.metadata?.name
      if (!svcName) continue

      console.log(
        `[cleanup] Deleting orphaned service: ${svcName} (uid=${svcUid})`,
      )
      try {
        await deleteService(svcName)
      } catch (err) {
        console.error(`[cleanup] Failed to delete service ${svcName}:`, err)
      }
    }
  }

  // ------ Stale creating ConfigMaps ------
  await cleanStaleCreatingConfigMaps()
}

/**
 * Removes `creating-*` ConfigMaps that are older than the stale threshold.
 */
async function cleanStaleCreatingConfigMaps(): Promise<void> {
  let creatingCms: Awaited<ReturnType<typeof listConfigMaps>>
  try {
    creatingCms = await listConfigMaps(
      'managed-by=workspacekit,component=creating',
    )
  } catch (err) {
    console.error('[cleanup] Failed to list creating ConfigMaps:', err)
    return
  }

  const now = Date.now()

  for (const cm of creatingCms) {
    const cmName = cm.metadata?.name
    if (!cmName) continue

    const creationStr = cm.metadata?.creationTimestamp
    if (!creationStr) continue

    const createdAtMs =
      typeof creationStr === 'string'
        ? new Date(creationStr).getTime()
        : new Date(creationStr as unknown as string).getTime()

    if (isNaN(createdAtMs)) continue

    const ageMs = now - createdAtMs

    if (ageMs > STALE_CREATING_THRESHOLD_MS) {
      console.log(
        `[cleanup] Deleting stale creating ConfigMap: ${cmName} ` +
          `(age=${Math.round(ageMs / 60_000)} min)`,
      )
      try {
        await deleteConfigMap(cmName)
      } catch (err) {
        console.error(
          `[cleanup] Failed to delete creating ConfigMap ${cmName}:`,
          err,
        )
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Interval loop
// ---------------------------------------------------------------------------

/**
 * Starts the cleanup process on a repeating interval.
 */
export function startCleanup(intervalMs: number): void {
  // Run immediately on startup
  cleanupOrphans().catch((err) =>
    console.error('[cleanup] Initial cleanup failed:', err),
  )

  setInterval(() => {
    cleanupOrphans().catch((err) =>
      console.error('[cleanup] Cleanup failed:', err),
    )
  }, intervalMs)

  console.log(`[cleanup] Cleanup started (interval=${intervalMs}ms)`)
}
