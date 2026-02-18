import * as k8s from '@kubernetes/client-node'
import { coreV1, namespace } from './client.js'

const MANAGED_BY_LABEL = 'managed-by=workspacekit'

/**
 * Lists all services with the managed-by=workspacekit label.
 */
export async function listWorkspaceServices(): Promise<k8s.V1Service[]> {
  const response = await coreV1.listNamespacedService({
    namespace,
    labelSelector: MANAGED_BY_LABEL,
  })
  return response.items
}

/**
 * Gets a single service by name. Returns null if not found.
 */
export async function getService(name: string): Promise<k8s.V1Service | null> {
  try {
    return await coreV1.readNamespacedService({ name, namespace })
  } catch (err: unknown) {
    if (isHttpError(err) && err.code === 404) {
      return null
    }
    throw err
  }
}

/**
 * Creates a service from the given spec.
 */
export async function createService(spec: k8s.V1Service): Promise<k8s.V1Service> {
  return await coreV1.createNamespacedService({
    namespace,
    body: spec,
  })
}

/**
 * Deletes a service by name. Ignores 404 (already deleted).
 */
export async function deleteService(name: string): Promise<void> {
  try {
    await coreV1.deleteNamespacedService({ name, namespace })
  } catch (err: unknown) {
    if (isHttpError(err) && err.code === 404) {
      return
    }
    throw err
  }
}

/**
 * Builds a NodePort service spec for a workspace pod.
 */
export function buildServiceSpec(
  name: string,
  uid: string,
  ns: string = namespace,
): k8s.V1Service {
  return {
    apiVersion: 'v1',
    kind: 'Service',
    metadata: {
      name: `svc-${uid}`,
      namespace: ns,
      labels: {
        'managed-by': 'workspacekit',
        'workspace-name': name,
        'workspace-uid': uid,
      },
    },
    spec: {
      type: 'NodePort',
      selector: {
        'workspace-uid': uid,
      },
      ports: [
        {
          port: 10800,
          targetPort: 10800,
          protocol: 'TCP',
          name: 'openvscode',
        },
      ],
    },
  }
}

/**
 * Extracts the NodePort number from a service.
 */
export function getNodePort(svc: k8s.V1Service): number {
  const ports = svc.spec?.ports ?? []
  return ports[0]?.nodePort ?? 0
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
