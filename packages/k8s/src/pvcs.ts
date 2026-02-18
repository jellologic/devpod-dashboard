import * as k8s from '@kubernetes/client-node'
import { coreV1, namespace } from './client.js'

const MANAGED_BY_LABEL = 'managed-by=workspacekit'

/**
 * Lists PVCs with the managed-by=workspacekit label.
 */
export async function listWorkspacePvcs(): Promise<k8s.V1PersistentVolumeClaim[]> {
  const response = await coreV1.listNamespacedPersistentVolumeClaim({
    namespace,
    labelSelector: MANAGED_BY_LABEL,
  })
  return response.items
}

/**
 * Lists all PVCs in the namespace (regardless of labels).
 */
export async function listAllPvcs(): Promise<k8s.V1PersistentVolumeClaim[]> {
  const response = await coreV1.listNamespacedPersistentVolumeClaim({ namespace })
  return response.items
}

/**
 * Gets a single PVC by name. Returns null if not found.
 */
export async function getPvc(name: string): Promise<k8s.V1PersistentVolumeClaim | null> {
  try {
    return await coreV1.readNamespacedPersistentVolumeClaim({ name, namespace })
  } catch (err: unknown) {
    if (isHttpError(err) && err.code === 404) {
      return null
    }
    throw err
  }
}

/**
 * Creates a PVC from the given spec.
 */
export async function createPvc(
  spec: k8s.V1PersistentVolumeClaim,
): Promise<k8s.V1PersistentVolumeClaim> {
  return await coreV1.createNamespacedPersistentVolumeClaim({
    namespace,
    body: spec,
  })
}

/**
 * Deletes a PVC by name. Ignores 404 (already deleted).
 */
export async function deletePvc(name: string): Promise<void> {
  try {
    await coreV1.deleteNamespacedPersistentVolumeClaim({ name, namespace })
  } catch (err: unknown) {
    if (isHttpError(err) && err.code === 404) {
      return
    }
    throw err
  }
}

/**
 * Builds a PVC spec for a workspace.
 */
export function buildPvcSpec(
  name: string,
  uid: string,
  diskSize: string,
  ns: string = namespace,
): k8s.V1PersistentVolumeClaim {
  return {
    apiVersion: 'v1',
    kind: 'PersistentVolumeClaim',
    metadata: {
      name: `pvc-${uid}`,
      namespace: ns,
      labels: {
        'managed-by': 'workspacekit',
        'workspace-name': name,
        'workspace-uid': uid,
      },
    },
    spec: {
      accessModes: ['ReadWriteOnce'],
      resources: {
        requests: {
          storage: diskSize,
        },
      },
    },
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
