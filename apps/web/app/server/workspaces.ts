/**
 * Server functions for workspace CRUD operations.
 *
 * Each export is a `createServerFn` that runs on the server. They are called
 * from TanStack Start route loaders and client-side mutations.
 */

import { createServerFn } from '@tanstack/react-start'
import {
  listWorkspacePods,
  getPod,
  createPod,
  deletePod,
  patchPodAnnotations,
  removePodAnnotations,
  getContainerResources,
  getWorkspaceName,
  getWorkspaceUid,
  isPodReady,
  buildPodSpec,
  listWorkspaceServices,
  createService,
  deleteService,
  buildServiceSpec,
  getNodePort,
  listWorkspacePvcs,
  createPvc,
  deletePvc,
  buildPvcSpec,
  listConfigMaps,
  deleteConfigMap,
  savePodSpec,
  getSavedPodSpec,
  saveWorkspaceMeta,
  getWorkspaceMeta,
  getWorkspaceDefaults,
  getPodEvents,
  namespace,
} from '@workspacekit/k8s'
import type { BuildPodSpecOptions } from '@workspacekit/k8s'
import {
  CreateWorkspaceInputSchema,
  StopWorkspaceInputSchema,
  StartWorkspaceInputSchema,
  DeleteWorkspaceInputSchema,
  RebuildWorkspaceInputSchema,
  ResizeWorkspaceInputSchema,
  DuplicateWorkspaceInputSchema,
  SetTimerInputSchema,
  BulkActionInputSchema,
} from '@workspacekit/types'
import type {
  Workspace,
  WorkspaceDetail,
  ApiResponse,
  Resources,
} from '@workspacekit/types'
import { config } from '~/lib/config'
import { generateUid, repoToName, sanitizeName } from '~/lib/utils'
import { getPodMetricsCache } from './stats'
import { appendCreationLog, hasCreationLog } from './logs'
import { requireServerFnAuth, requireRole } from './auth'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Fetches devcontainer.json from a GitHub repo to extract the image,
 * postCreateCommand, and features. Returns defaults if not found.
 */
async function fetchDevcontainerConfig(
  repoUrl: string,
): Promise<{ image: string; postCreateCmd: string; features: import('@workspacekit/k8s').DevcontainerFeature[] }> {
  try {
    // Parse GitHub repo URL: https://github.com/{owner}/{repo}
    const match = repoUrl.match(
      /github\.com\/([^/]+)\/([^/.]+)/,
    )
    if (!match) {
      return { image: config.defaultImage, postCreateCmd: '', features: [] }
    }

    const [, owner, repo] = match
    const branch = 'main'
    const url = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/.devcontainer/devcontainer.json`

    const headers: Record<string, string> = {}
    const ghToken = process.env.GH_TOKEN
    if (ghToken) {
      headers['Authorization'] = `token ${ghToken}`
    }
    const response = await fetch(url, { headers, signal: AbortSignal.timeout(5000) })
    if (!response.ok) {
      return { image: config.defaultImage, postCreateCmd: '', features: [] }
    }

    const text = await response.text()
    // Strip single-line comments (devcontainer.json allows jsonc)
    const cleaned = text.replace(/\/\/.*$/gm, '')
    const devcontainer = JSON.parse(cleaned) as Record<string, unknown>

    const image =
      typeof devcontainer.image === 'string'
        ? devcontainer.image
        : config.defaultImage

    let postCreateCmd = ''
    if (typeof devcontainer.postCreateCommand === 'string') {
      postCreateCmd = devcontainer.postCreateCommand
    } else if (Array.isArray(devcontainer.postCreateCommand)) {
      postCreateCmd = (devcontainer.postCreateCommand as string[]).join(' && ')
    }

    // Parse devcontainer features
    const features: import('@workspacekit/k8s').DevcontainerFeature[] = []
    if (typeof devcontainer.features === 'object' && devcontainer.features !== null) {
      for (const [key, value] of Object.entries(devcontainer.features as Record<string, unknown>)) {
        // Parse ghcr.io/repo/name:tag (tag defaults to "latest")
        const featureMatch = key.match(/^ghcr\.io\/(.+?)(?::(.+))?$/)
        if (!featureMatch) continue
        const [, featureRepo, featureTag = 'latest'] = featureMatch
        const options: Record<string, string> = {}
        if (typeof value === 'object' && value !== null) {
          for (const [optKey, optValue] of Object.entries(value as Record<string, unknown>)) {
            options[optKey.toUpperCase()] = String(optValue)
          }
        }
        features.push({ repo: featureRepo, tag: featureTag, options })
      }
    }

    return { image, postCreateCmd, features }
  } catch {
    return { image: config.defaultImage, postCreateCmd: '', features: [] }
  }
}

/**
 * Builds a Workspace list item from a running pod.
 */
function podToWorkspace(
  pod: import('@kubernetes/client-node').V1Pod,
  serviceMap: Map<string, number>,
  metricsCache: Map<string, { cpu: string; memory: string }>,
): Workspace {
  const podName = pod.metadata?.name ?? ''
  const wsName = getWorkspaceName(pod)
  const uid = getWorkspaceUid(pod)
  const annotations = pod.metadata?.annotations ?? {}
  const ready = isPodReady(pod)
  const resources = getContainerResources(pod)
  const metric = metricsCache.get(podName)

  return {
    name: wsName,
    status: ready ? 'Running' : (pod.status?.phase ?? 'Unknown'),
    port: serviceMap.get(uid) ?? 0,
    pod: podName,
    uid,
    running: ready,
    creating: hasCreationLog(wsName),
    shutdown_at: annotations['wsk/shutdown-at'] ?? '',
    shutdown_hours: annotations['wsk/shutdown-hours'] ?? '',
    resources,
    repo: annotations['wsk/repo'] ?? '',
    branch: annotations['wsk/branch'] ?? '',
    dirty: annotations['wsk/dirty'] === 'true',
    last_commit: annotations['wsk/last-commit'] ?? '',
    usage: metric ? { cpu: metric.cpu, memory: metric.memory } : undefined,
    owner: annotations['wsk/owner'] ?? '',
    last_accessed: annotations['wsk/last-accessed'] ?? '',
    expiry_warning: annotations['wsk/expiry-warning'] ?? '',
  }
}

/**
 * Builds a Workspace list item from a saved (stopped) ConfigMap spec.
 */
function savedSpecToWorkspace(
  cm: import('@kubernetes/client-node').V1ConfigMap,
): Workspace | null {
  try {
    const spec = JSON.parse(cm.data?.spec ?? '{}') as import('@kubernetes/client-node').V1Pod
    const labels = cm.metadata?.labels ?? {}
    const wsName = labels['workspace-name'] ?? ''
    const uid = labels['workspace-uid'] ?? ''
    const annotations = spec.metadata?.annotations ?? {}

    if (!wsName || !uid) return null

    const container = spec.spec?.containers?.[0]
    const resources: Resources = {
      req_cpu: container?.resources?.requests?.['cpu'] ?? '',
      req_mem: container?.resources?.requests?.['memory'] ?? '',
      lim_cpu: container?.resources?.limits?.['cpu'] ?? '',
      lim_mem: container?.resources?.limits?.['memory'] ?? '',
    }

    return {
      name: wsName,
      status: 'Stopped',
      port: 0,
      pod: `ws-${uid}`,
      uid,
      running: false,
      creating: false,
      shutdown_at: '',
      shutdown_hours: '',
      resources,
      repo: annotations['wsk/repo'] ?? '',
      branch: annotations['wsk/branch'] ?? '',
      dirty: annotations['wsk/dirty'] === 'true',
      last_commit: annotations['wsk/last-commit'] ?? '',
      usage: undefined,
      owner: annotations['wsk/owner'] ?? '',
      last_accessed: annotations['wsk/last-accessed'] ?? '',
      expiry_warning: annotations['wsk/expiry-warning'] ?? '',
    }
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Server functions
// ---------------------------------------------------------------------------

/**
 * Lists all workspaces: running pods + stopped workspaces from saved specs.
 */
export const getWorkspaces = createServerFn({ method: 'GET' }).handler(
  async (): Promise<Workspace[]> => {
    await requireServerFnAuth()

    const [pods, services, savedCms] = await Promise.all([
      listWorkspacePods(),
      listWorkspaceServices(),
      listConfigMaps('managed-by=workspacekit,component=saved-spec'),
    ])

    // Build service NodePort lookup by workspace UID
    const serviceMap = new Map<string, number>()
    for (const svc of services) {
      const uid = svc.metadata?.labels?.['workspace-uid'] ?? ''
      if (uid) {
        serviceMap.set(uid, getNodePort(svc))
      }
    }

    // Track UIDs of running pods so we don't duplicate stopped entries
    const runningUids = new Set<string>()
    const metricsCache = getPodMetricsCache()

    const workspaces: Workspace[] = []

    for (const pod of pods) {
      const uid = getWorkspaceUid(pod)
      if (uid) runningUids.add(uid)
      workspaces.push(podToWorkspace(pod, serviceMap, metricsCache))
    }

    // Add stopped workspaces from saved spec ConfigMaps
    for (const cm of savedCms) {
      const uid = cm.metadata?.labels?.['workspace-uid'] ?? ''
      if (uid && !runningUids.has(uid)) {
        const ws = savedSpecToWorkspace(cm)
        if (ws) workspaces.push(ws)
      }
    }

    return workspaces
  },
)

/**
 * Gets detailed information for a single workspace, including events.
 */
export const getWorkspaceDetail = createServerFn({ method: 'GET' })
  .validator((input: { name: string }) => input)
  .handler(async ({ data }): Promise<WorkspaceDetail> => {
    await requireServerFnAuth()

    const { name } = data

    // Try to find a running pod for this workspace
    const pods = await listWorkspacePods()
    const pod = pods.find((p) => getWorkspaceName(p) === name)

    if (pod) {
      const podName = pod.metadata?.name ?? ''
      const uid = getWorkspaceUid(pod)
      const annotations = pod.metadata?.annotations ?? {}
      const resources = getContainerResources(pod)
      const metricsCache = getPodMetricsCache()
      const metric = metricsCache.get(podName)

      const [events, pvcs, services] = await Promise.all([
        getPodEvents(podName),
        listWorkspacePvcs(),
        listWorkspaceServices(),
      ])

      // Find the NodePort for this workspace
      const svc = services.find(
        (s) => s.metadata?.labels?.['workspace-uid'] === uid,
      )
      const port = svc ? getNodePort(svc) : 0

      const wsPvcs = pvcs
        .filter((pvc) => pvc.metadata?.labels?.['workspace-uid'] === uid)
        .map((pvc) => ({
          name: pvc.metadata?.name ?? '',
          capacity: pvc.status?.capacity?.['storage'] ?? '',
          status: pvc.status?.phase ?? '',
          storage_class: pvc.spec?.storageClassName ?? '',
        }))

      const containers = (pod.spec?.containers ?? []).map((c) => {
        const status = (pod.status?.containerStatuses ?? []).find(
          (s) => s.name === c.name,
        )
        return {
          name: c.name,
          image: c.image ?? '',
          ready: status?.ready ?? false,
          restart_count: status?.restartCount ?? 0,
          state: (status?.state ?? {}) as Record<string, unknown>,
          requests: (c.resources?.requests ?? {}) as Record<string, unknown>,
          limits: (c.resources?.limits ?? {}) as Record<string, unknown>,
        }
      })

      const ready = isPodReady(pod)
      const age = pod.metadata?.creationTimestamp
        ? formatAge(new Date(pod.metadata.creationTimestamp))
        : ''

      return {
        name,
        status: ready ? 'Running' : (pod.status?.phase ?? 'Unknown'),
        pod: podName,
        port,
        events,
        pvcs: wsPvcs,
        containers,
        usage: metric ? { cpu: metric.cpu, memory: metric.memory } : null,
        repo: annotations['wsk/repo'] ?? '',
        running: ready,
        creating: hasCreationLog(name),
        uid,
        pod_ip: pod.status?.podIP ?? '',
        node: pod.spec?.nodeName ?? '',
        phase: pod.status?.phase ?? '',
        conditions: (pod.status?.conditions ?? []) as unknown[],
        age,
        resources,
        branch: annotations['wsk/branch'] ?? '',
        dirty: annotations['wsk/dirty'] === 'true',
        last_commit: annotations['wsk/last-commit'] ?? '',
        pvc_usage: {},
        owner: annotations['wsk/owner'] ?? '',
        last_accessed: annotations['wsk/last-accessed'] ?? '',
        expiry_warning: annotations['wsk/expiry-warning'] ?? '',
      }
    }

    // Workspace is stopped -- look for saved spec
    const savedCms = await listConfigMaps(
      `managed-by=workspacekit,workspace-name=${name}`,
    )
    const savedCm = savedCms.find(
      (cm) => cm.metadata?.name?.startsWith('saved-'),
    )

    if (!savedCm) {
      throw new Response('Workspace not found', { status: 404 })
    }

    const uid = savedCm.metadata?.labels?.['workspace-uid'] ?? ''
    let spec: import('@kubernetes/client-node').V1Pod | undefined
    try {
      spec = JSON.parse(savedCm.data?.spec ?? '{}')
    } catch {
      spec = undefined
    }

    const annotations = spec?.metadata?.annotations ?? {}
    const container = spec?.spec?.containers?.[0]
    const resources: Resources = {
      req_cpu: container?.resources?.requests?.['cpu'] ?? '',
      req_mem: container?.resources?.requests?.['memory'] ?? '',
      lim_cpu: container?.resources?.limits?.['cpu'] ?? '',
      lim_mem: container?.resources?.limits?.['memory'] ?? '',
    }

    // Find PVCs for this workspace
    const pvcs = await listWorkspacePvcs()
    const wsPvcs = pvcs
      .filter((pvc) => pvc.metadata?.labels?.['workspace-uid'] === uid)
      .map((pvc) => ({
        name: pvc.metadata?.name ?? '',
        capacity: pvc.status?.capacity?.['storage'] ?? '',
        status: pvc.status?.phase ?? '',
        storage_class: pvc.spec?.storageClassName ?? '',
      }))

    return {
      name,
      status: 'Stopped',
      pod: null,
      port: 0,
      events: [],
      pvcs: wsPvcs,
      containers: [],
      usage: null,
      repo: annotations['wsk/repo'] ?? '',
      running: false,
      creating: false,
      uid,
      pod_ip: '',
      node: '',
      phase: 'Stopped',
      conditions: [],
      age: '',
      resources,
      branch: annotations['wsk/branch'] ?? '',
      dirty: annotations['wsk/dirty'] === 'true',
      last_commit: annotations['wsk/last-commit'] ?? '',
      pvc_usage: {},
      owner: annotations['wsk/owner'] ?? '',
      last_accessed: annotations['wsk/last-accessed'] ?? '',
      expiry_warning: annotations['wsk/expiry-warning'] ?? '',
    }
  })

/**
 * Creates a new workspace: PVC + Service + Pod + metadata ConfigMap.
 */
export const createWorkspace = createServerFn({ method: 'POST' })
  .validator((input: unknown) => CreateWorkspaceInputSchema.parse(input))
  .handler(async ({ data }): Promise<ApiResponse> => {
    const session = await requireServerFnAuth()
    requireRole(session, 'admin')

    const { repo, owner } = data
    const name = data.name
      ? sanitizeName(data.name)
      : repoToName(repo)
    const uid = generateUid()

    appendCreationLog(name, `Creating workspace "${name}" (uid: ${uid})`)

    // Fetch devcontainer.json from the repo
    appendCreationLog(name, 'Fetching devcontainer.json...')
    const devcontainer = await fetchDevcontainerConfig(repo)
    // Form-provided values override devcontainer/defaults
    const image = data.image || devcontainer.image
    const postCreateCmd = devcontainer.postCreateCmd
    appendCreationLog(name, `Using image: ${image}`)

    // Get resource defaults
    const defaults = await getWorkspaceDefaults()
    const resources: Resources = {
      req_cpu: data.req_cpu || defaults.req_cpu || '500m',
      req_mem: data.req_mem || defaults.req_mem || '512Mi',
      lim_cpu: data.lim_cpu || defaults.lim_cpu || '2',
      lim_mem: data.lim_mem || defaults.lim_mem || '4Gi',
    }

    // Create PVC
    appendCreationLog(name, `Creating PVC pvc-${uid} (${config.diskSize})...`)
    const pvcSpec = buildPvcSpec(name, uid, config.diskSize)
    await createPvc(pvcSpec)

    // Create Service
    appendCreationLog(name, `Creating Service svc-${uid}...`)
    const svcSpec = buildServiceSpec(name, uid)
    await createService(svcSpec)

    // Build and create pod
    appendCreationLog(name, `Creating Pod ws-${uid}...`)
    const podOptions: BuildPodSpecOptions = {
      name,
      uid,
      repoUrl: repo,
      image,
      resources,
      postCreateCmd: postCreateCmd || undefined,
      features: devcontainer.features,
      openvscodePath: config.openvscodePath,
    }
    const podSpec = buildPodSpec(podOptions)

    // Attach repo + owner annotations to the pod
    if (!podSpec.metadata!.annotations) {
      podSpec.metadata!.annotations = {}
    }
    podSpec.metadata!.annotations['wsk/repo'] = repo
    if (owner) {
      podSpec.metadata!.annotations['wsk/owner'] = owner
    }

    await createPod(podSpec)

    // Save workspace metadata ConfigMap
    appendCreationLog(name, 'Saving workspace metadata...')
    await saveWorkspaceMeta(name, uid, repo, image, postCreateCmd)

    appendCreationLog(name, 'Workspace created successfully.')

    return { ok: true, message: `Workspace "${name}" created` }
  })

/**
 * Stops a workspace: deletes the pod and saves its spec as a ConfigMap.
 */
export const stopWorkspace = createServerFn({ method: 'POST' })
  .validator((input: unknown) => StopWorkspaceInputSchema.parse(input))
  .handler(async ({ data }): Promise<ApiResponse> => {
    const session = await requireServerFnAuth()
    requireRole(session, 'admin', 'user')

    const { pod: podName } = data

    const pod = await getPod(podName)
    if (!pod) {
      return { ok: false, message: `Pod "${podName}" not found` }
    }

    const wsName = getWorkspaceName(pod)
    const uid = getWorkspaceUid(pod)

    // Save the pod spec before deleting
    await savePodSpec(uid, wsName, pod)

    // Delete the pod
    await deletePod(podName)

    return { ok: true, message: `Workspace "${wsName}" stopped` }
  })

/**
 * Starts a stopped workspace: recreates the pod from the saved ConfigMap spec.
 */
export const startWorkspace = createServerFn({ method: 'POST' })
  .validator((input: unknown) => StartWorkspaceInputSchema.parse(input))
  .handler(async ({ data }): Promise<ApiResponse> => {
    const session = await requireServerFnAuth()
    requireRole(session, 'admin', 'user')

    const { pod: podName } = data

    // Extract UID from pod name (ws-{uid})
    const uid = podName.replace(/^ws-/, '')

    const savedSpec = await getSavedPodSpec(uid)
    if (!savedSpec) {
      return { ok: false, message: `No saved spec found for "${podName}"` }
    }

    // Clear any status fields from the saved spec
    delete savedSpec.status
    if (savedSpec.metadata) {
      delete savedSpec.metadata.resourceVersion
      delete savedSpec.metadata.uid
      delete savedSpec.metadata.creationTimestamp
    }

    // Recreate the pod
    await createPod(savedSpec)

    // Remove the saved spec ConfigMap
    await deleteConfigMap(`saved-${uid}`)

    const wsName = savedSpec.metadata?.labels?.['workspace-name'] ?? podName

    return { ok: true, message: `Workspace "${wsName}" started` }
  })

/**
 * Deletes a workspace entirely: pod + PVC + service + ConfigMaps.
 */
export const deleteWorkspace = createServerFn({ method: 'POST' })
  .validator((input: unknown) => DeleteWorkspaceInputSchema.parse(input))
  .handler(async ({ data }): Promise<ApiResponse> => {
    const session = await requireServerFnAuth()
    requireRole(session, 'admin')

    const { name, pod: podName, uid } = data

    // Delete pod (if running)
    await deletePod(podName)

    // Delete PVC
    await deletePvc(`pvc-${uid}`)

    // Delete service
    await deleteService(`svc-${uid}`)

    // Delete saved spec ConfigMap (if stopped)
    await deleteConfigMap(`saved-${uid}`)

    // Delete meta ConfigMap
    await deleteConfigMap(`meta-${name}`)

    return { ok: true, message: `Workspace "${name}" deleted` }
  })

/**
 * Rebuilds a workspace: deletes and recreates the pod (keeps PVC data).
 */
export const rebuildWorkspace = createServerFn({ method: 'POST' })
  .validator((input: unknown) => RebuildWorkspaceInputSchema.parse(input))
  .handler(async ({ data }): Promise<ApiResponse> => {
    const session = await requireServerFnAuth()
    requireRole(session, 'admin')

    const { name, pod: podName, uid, repo, owner } = data

    // Get the current pod to preserve resources
    const existingPod = await getPod(podName)
    let resources: Resources = {
      req_cpu: '500m',
      req_mem: '512Mi',
      lim_cpu: '2',
      lim_mem: '4Gi',
    }

    if (existingPod) {
      resources = getContainerResources(existingPod)
    }

    // Delete the old pod
    await deletePod(podName, 0)

    // Fetch fresh devcontainer config
    const { image, postCreateCmd, features } = await fetchDevcontainerConfig(repo)

    // Build and create new pod
    const podOptions: BuildPodSpecOptions = {
      name,
      uid,
      repoUrl: repo,
      image,
      resources,
      postCreateCmd: postCreateCmd || undefined,
      features,
      openvscodePath: config.openvscodePath,
    }
    const podSpec = buildPodSpec(podOptions)

    if (!podSpec.metadata!.annotations) {
      podSpec.metadata!.annotations = {}
    }
    podSpec.metadata!.annotations['wsk/repo'] = repo
    if (owner) {
      podSpec.metadata!.annotations['wsk/owner'] = owner
    }

    await createPod(podSpec)

    // Update metadata
    await saveWorkspaceMeta(name, uid, repo, image, postCreateCmd)

    return { ok: true, message: `Workspace "${name}" rebuilt` }
  })

/**
 * Resizes a workspace by patching the pod's container resource requests/limits.
 */
export const resizeWorkspace = createServerFn({ method: 'POST' })
  .validator((input: unknown) => ResizeWorkspaceInputSchema.parse(input))
  .handler(async ({ data }): Promise<ApiResponse> => {
    const session = await requireServerFnAuth()
    requireRole(session, 'admin')

    const { pod: podName, req_cpu, req_mem, lim_cpu, lim_mem } = data

    // Kubernetes does not allow in-place resource updates on pods.
    // We need to delete and recreate the pod with new resources.
    const existingPod = await getPod(podName)
    if (!existingPod) {
      return { ok: false, message: `Pod "${podName}" not found` }
    }

    const wsName = getWorkspaceName(existingPod)
    const uid = getWorkspaceUid(existingPod)

    // Update resources on the spec
    const container = existingPod.spec?.containers?.[0]
    if (container) {
      container.resources = {
        requests: { cpu: req_cpu, memory: req_mem },
        limits: { cpu: lim_cpu, memory: lim_mem },
      }
    }

    // Clear status/metadata fields
    delete existingPod.status
    if (existingPod.metadata) {
      delete existingPod.metadata.resourceVersion
      delete existingPod.metadata.uid
      delete existingPod.metadata.creationTimestamp
    }

    // Delete old pod and create new one
    await deletePod(podName, 0)
    await createPod(existingPod)

    return {
      ok: true,
      message: `Workspace "${wsName}" resized`,
    }
  })

/**
 * Duplicates a workspace to a new name (creates fresh PVC + Service + Pod).
 */
export const duplicateWorkspace = createServerFn({ method: 'POST' })
  .validator((input: unknown) => DuplicateWorkspaceInputSchema.parse(input))
  .handler(async ({ data }): Promise<ApiResponse> => {
    const session = await requireServerFnAuth()
    requireRole(session, 'admin')

    const { source_pod, source_name, new_name, repo } = data
    const name = sanitizeName(new_name)
    const uid = generateUid()

    // Get source pod for image and resource info
    const sourcePod = await getPod(source_pod)

    let image = config.defaultImage
    let resources: Resources = {
      req_cpu: '500m',
      req_mem: '512Mi',
      lim_cpu: '2',
      lim_mem: '4Gi',
    }

    if (sourcePod) {
      image = sourcePod.spec?.containers?.[0]?.image ?? config.defaultImage
      resources = getContainerResources(sourcePod)
    }

    // Get postCreateCmd and features from devcontainer config
    const devcontainer = await fetchDevcontainerConfig(repo)
    const meta = await getWorkspaceMeta(source_name)
    const postCreateCmd = meta?.data?.post_create_cmd || devcontainer.postCreateCmd

    // Create PVC
    const pvcSpec = buildPvcSpec(name, uid, config.diskSize)
    await createPvc(pvcSpec)

    // Create Service
    const svcSpec = buildServiceSpec(name, uid)
    await createService(svcSpec)

    // Create Pod
    const podOptions: BuildPodSpecOptions = {
      name,
      uid,
      repoUrl: repo,
      image,
      resources,
      postCreateCmd: postCreateCmd || undefined,
      features: devcontainer.features,
      openvscodePath: config.openvscodePath,
    }
    const podSpec = buildPodSpec(podOptions)

    if (!podSpec.metadata!.annotations) {
      podSpec.metadata!.annotations = {}
    }
    podSpec.metadata!.annotations['wsk/repo'] = repo

    await createPod(podSpec)

    // Save metadata
    await saveWorkspaceMeta(name, uid, repo, image, postCreateCmd)

    return { ok: true, message: `Workspace duplicated as "${name}"` }
  })

/**
 * Sets (or clears) an auto-shutdown timer annotation on a running pod.
 */
export const setTimer = createServerFn({ method: 'POST' })
  .validator((input: unknown) => SetTimerInputSchema.parse(input))
  .handler(async ({ data }): Promise<ApiResponse> => {
    const session = await requireServerFnAuth()
    requireRole(session, 'admin', 'user')

    const { pod: podName, hours } = data

    if (hours <= 0) {
      // Clear timer
      await removePodAnnotations(podName, [
        'wsk/shutdown-at',
        'wsk/shutdown-hours',
      ])
      return { ok: true, message: 'Timer cleared' }
    }

    const shutdownAt = new Date(
      Date.now() + hours * 60 * 60 * 1000,
    ).toISOString()

    await patchPodAnnotations(podName, {
      'wsk/shutdown-at': shutdownAt,
      'wsk/shutdown-hours': String(hours),
    })

    return { ok: true, message: `Timer set: ${hours}h` }
  })

/**
 * Performs a bulk action (start, stop, or delete) on multiple workspaces.
 */
export const bulkAction = createServerFn({ method: 'POST' })
  .validator((input: unknown) => BulkActionInputSchema.parse(input))
  .handler(async ({ data }): Promise<ApiResponse> => {
    const session = await requireServerFnAuth()
    // Bulk delete requires admin; start/stop allowed for admin+user
    if (data.action === 'delete') {
      requireRole(session, 'admin')
    } else {
      requireRole(session, 'admin', 'user')
    }

    const { action, workspaces } = data
    const results: string[] = []

    for (const ws of workspaces) {
      try {
        switch (action) {
          case 'stop': {
            const pod = await getPod(ws.pod)
            if (pod) {
              const wsName = getWorkspaceName(pod)
              const uid = getWorkspaceUid(pod)
              await savePodSpec(uid, wsName, pod)
              await deletePod(ws.pod)
              results.push(`Stopped: ${ws.name}`)
            }
            break
          }
          case 'start': {
            const uid = ws.pod.replace(/^ws-/, '')
            const savedSpec = await getSavedPodSpec(uid)
            if (savedSpec) {
              delete savedSpec.status
              if (savedSpec.metadata) {
                delete savedSpec.metadata.resourceVersion
                delete savedSpec.metadata.uid
                delete savedSpec.metadata.creationTimestamp
              }
              await createPod(savedSpec)
              await deleteConfigMap(`saved-${uid}`)
              results.push(`Started: ${ws.name}`)
            }
            break
          }
          case 'delete': {
            await deletePod(ws.pod)
            await deletePvc(`pvc-${ws.uid}`)
            await deleteService(`svc-${ws.uid}`)
            await deleteConfigMap(`saved-${ws.uid}`)
            await deleteConfigMap(`meta-${ws.name}`)
            results.push(`Deleted: ${ws.name}`)
            break
          }
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        results.push(`Failed ${ws.name}: ${msg}`)
      }
    }

    return {
      ok: true,
      message: results.join('; '),
    }
  })

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function formatAge(date: Date): string {
  const diffMs = Date.now() - date.getTime()
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
