import * as k8s from '@kubernetes/client-node'
import type { Schedule, Preset, WorkspaceDefaults } from '@workspacekit/types'
import { coreV1, namespace } from './client.js'

// ---------------------------------------------------------------------------
// ConfigMap name constants
// ---------------------------------------------------------------------------

export const SCHEDULES_CM = 'workspacekit-schedules'
export const EXPIRY_CM = 'workspacekit-expiry'
export const TEMPLATES_CM = 'workspacekit-templates'
export const DEFAULTS_CM = 'workspacekit-defaults'

// ---------------------------------------------------------------------------
// Generic ConfigMap CRUD
// ---------------------------------------------------------------------------

/**
 * Gets a configmap by name. Returns null if not found.
 */
export async function getConfigMap(name: string): Promise<k8s.V1ConfigMap | null> {
  try {
    return await coreV1.readNamespacedConfigMap({ name, namespace })
  } catch (err: unknown) {
    if (isHttpError(err) && err.code === 404) {
      return null
    }
    throw err
  }
}

/**
 * Creates or replaces a configmap. Tries create first; if 409 Conflict, does a replace.
 */
export async function upsertConfigMap(
  name: string,
  ns: string,
  data: Record<string, string>,
  labels?: Record<string, string>,
): Promise<k8s.V1ConfigMap> {
  const cm: k8s.V1ConfigMap = {
    apiVersion: 'v1',
    kind: 'ConfigMap',
    metadata: {
      name,
      namespace: ns,
      labels,
    },
    data,
  }

  try {
    return await coreV1.createNamespacedConfigMap({
      namespace: ns,
      body: cm,
    })
  } catch (err: unknown) {
    if (isHttpError(err) && err.code === 409) {
      return await coreV1.replaceNamespacedConfigMap({
        name,
        namespace: ns,
        body: cm,
      })
    }
    throw err
  }
}

/**
 * Deletes a configmap by name. Ignores 404 (already deleted).
 */
export async function deleteConfigMap(name: string): Promise<void> {
  try {
    await coreV1.deleteNamespacedConfigMap({ name, namespace })
  } catch (err: unknown) {
    if (isHttpError(err) && err.code === 404) {
      return
    }
    throw err
  }
}

/**
 * Lists configmaps matching a label selector.
 */
export async function listConfigMaps(labelSelector: string): Promise<k8s.V1ConfigMap[]> {
  const response = await coreV1.listNamespacedConfigMap({
    namespace,
    labelSelector,
  })
  return response.items
}

// ---------------------------------------------------------------------------
// Schedules
// ---------------------------------------------------------------------------

/**
 * Reads schedules from the schedules configmap.
 */
export async function getSchedules(): Promise<Schedule[]> {
  const cm = await getConfigMap(SCHEDULES_CM)
  if (!cm?.data?.schedules) {
    return []
  }
  try {
    return JSON.parse(cm.data.schedules) as Schedule[]
  } catch {
    return []
  }
}

/**
 * Writes schedules to the schedules configmap.
 */
export async function saveSchedules(schedules: Schedule[]): Promise<void> {
  await upsertConfigMap(SCHEDULES_CM, namespace, {
    schedules: JSON.stringify(schedules),
  })
}

// ---------------------------------------------------------------------------
// Expiry
// ---------------------------------------------------------------------------

/**
 * Reads the expiry days setting. Returns 0 if not set (disabled).
 */
export async function getExpiryDays(): Promise<number> {
  const cm = await getConfigMap(EXPIRY_CM)
  if (!cm?.data?.days) {
    return 0
  }
  const parsed = parseInt(cm.data.days, 10)
  return isNaN(parsed) ? 0 : parsed
}

/**
 * Writes the expiry days setting.
 */
export async function setExpiryDays(days: number): Promise<void> {
  await upsertConfigMap(EXPIRY_CM, namespace, {
    days: String(days),
  })
}

// ---------------------------------------------------------------------------
// Presets (Templates)
// ---------------------------------------------------------------------------

/**
 * Reads presets from the templates configmap.
 */
export async function getPresets(): Promise<Preset[]> {
  const cm = await getConfigMap(TEMPLATES_CM)
  if (!cm?.data?.templates) {
    return []
  }
  try {
    return JSON.parse(cm.data.templates) as Preset[]
  } catch {
    return []
  }
}

/**
 * Writes presets to the templates configmap.
 */
export async function savePresets(presets: Preset[]): Promise<void> {
  await upsertConfigMap(TEMPLATES_CM, namespace, {
    templates: JSON.stringify(presets),
  })
}

// ---------------------------------------------------------------------------
// Workspace Defaults
// ---------------------------------------------------------------------------

/**
 * Reads workspace resource defaults.
 */
export async function getWorkspaceDefaults(): Promise<WorkspaceDefaults> {
  const cm = await getConfigMap(DEFAULTS_CM)
  return {
    req_cpu: cm?.data?.req_cpu ?? '',
    req_mem: cm?.data?.req_mem ?? '',
    lim_cpu: cm?.data?.lim_cpu ?? '',
    lim_mem: cm?.data?.lim_mem ?? '',
  }
}

/**
 * Writes workspace resource defaults.
 */
export async function saveWorkspaceDefaults(defaults: WorkspaceDefaults): Promise<void> {
  await upsertConfigMap(DEFAULTS_CM, namespace, {
    req_cpu: defaults.req_cpu,
    req_mem: defaults.req_mem,
    lim_cpu: defaults.lim_cpu,
    lim_mem: defaults.lim_mem,
  })
}

// ---------------------------------------------------------------------------
// Workspace Meta
// ---------------------------------------------------------------------------

/**
 * Saves workspace metadata as a configmap named `meta-{name}`.
 */
export async function saveWorkspaceMeta(
  name: string,
  uid: string,
  repoUrl: string,
  image: string,
  postCreateCmd: string,
  ns: string = namespace,
): Promise<void> {
  await upsertConfigMap(
    `meta-${name}`,
    ns,
    {
      repo_url: repoUrl,
      image,
      post_create_cmd: postCreateCmd,
    },
    {
      'managed-by': 'workspacekit',
      component: 'workspace-meta',
      'workspace-name': name,
      'workspace-uid': uid,
    },
  )
}

/**
 * Gets workspace metadata configmap.
 */
export async function getWorkspaceMeta(name: string): Promise<k8s.V1ConfigMap | null> {
  return getConfigMap(`meta-${name}`)
}

// ---------------------------------------------------------------------------
// Saved Pod Spec
// ---------------------------------------------------------------------------

/**
 * Saves a pod spec as a configmap named `saved-{uid}`.
 */
export async function savePodSpec(
  uid: string,
  workspaceName: string,
  spec: k8s.V1Pod,
  ns: string = namespace,
): Promise<void> {
  await upsertConfigMap(
    `saved-${uid}`,
    ns,
    {
      spec: JSON.stringify(spec),
    },
    {
      'managed-by': 'workspacekit',
      'workspace-uid': uid,
      'workspace-name': workspaceName,
      'component': 'saved-spec',
    },
  )
}

/**
 * Gets a saved pod spec. Returns the parsed V1Pod or null.
 */
export async function getSavedPodSpec(uid: string): Promise<k8s.V1Pod | null> {
  const cm = await getConfigMap(`saved-${uid}`)
  if (!cm?.data?.spec) {
    return null
  }
  try {
    return JSON.parse(cm.data.spec) as k8s.V1Pod
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isHttpError(err: unknown): err is { code: number } {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    typeof (err as Record<string, unknown>).code === 'number'
  )
}
