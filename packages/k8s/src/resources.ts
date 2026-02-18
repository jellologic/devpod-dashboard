import * as k8s from '@kubernetes/client-node'
import type { LimitRange, Quota } from '@workspacekit/types'
import { coreV1, namespace } from './client.js'

const LIMIT_RANGE_NAME = 'workspacekit-limits'
const RESOURCE_QUOTA_NAME = 'workspacekit-quota'

// ---------------------------------------------------------------------------
// LimitRange
// ---------------------------------------------------------------------------

/**
 * Gets the workspacekit-limits LimitRange. Returns parsed fields or null if not found.
 */
export async function getLimitRange(): Promise<LimitRange | null> {
  try {
    const lr = await coreV1.readNamespacedLimitRange({
      name: LIMIT_RANGE_NAME,
      namespace,
    })

    const containerLimit = lr.spec?.limits?.find((l) => l.type === 'Container')
    if (!containerLimit) {
      return null
    }

    return {
      max_cpu: containerLimit.max?.['cpu'] ?? '',
      max_mem: containerLimit.max?.['memory'] ?? '',
      def_cpu: containerLimit._default?.['cpu'] ?? '',
      def_mem: containerLimit._default?.['memory'] ?? '',
      def_req_cpu: containerLimit.defaultRequest?.['cpu'] ?? '',
      def_req_mem: containerLimit.defaultRequest?.['memory'] ?? '',
    }
  } catch (err: unknown) {
    if (isHttpError(err) && err.code === 404) {
      return null
    }
    throw err
  }
}

/**
 * Creates or replaces the workspacekit-limits LimitRange.
 */
export async function saveLimitRange(
  maxCpu: string,
  maxMem: string,
  defReqCpu: string,
  defReqMem: string,
  ns: string = namespace,
): Promise<void> {
  const limitRange: k8s.V1LimitRange = {
    apiVersion: 'v1',
    kind: 'LimitRange',
    metadata: {
      name: LIMIT_RANGE_NAME,
      namespace: ns,
    },
    spec: {
      limits: [
        {
          type: 'Container',
          max: {
            cpu: maxCpu,
            memory: maxMem,
          },
          _default: {
            cpu: maxCpu,
            memory: maxMem,
          },
          defaultRequest: {
            cpu: defReqCpu,
            memory: defReqMem,
          },
        },
      ],
    },
  }

  try {
    await coreV1.createNamespacedLimitRange({
      namespace: ns,
      body: limitRange,
    })
  } catch (err: unknown) {
    if (isHttpError(err) && err.code === 409) {
      await coreV1.replaceNamespacedLimitRange({
        name: LIMIT_RANGE_NAME,
        namespace: ns,
        body: limitRange,
      })
      return
    }
    throw err
  }
}

// ---------------------------------------------------------------------------
// ResourceQuota
// ---------------------------------------------------------------------------

/**
 * Gets the workspacekit-quota ResourceQuota. Returns parsed fields or null if not found.
 */
export async function getResourceQuota(): Promise<Quota | null> {
  try {
    const rq = await coreV1.readNamespacedResourceQuota({
      name: RESOURCE_QUOTA_NAME,
      namespace,
    })

    return {
      req_cpu: rq.spec?.hard?.['requests.cpu'] ?? '',
      req_mem: rq.spec?.hard?.['requests.memory'] ?? '',
      pods: rq.spec?.hard?.['pods'] ?? '',
      used_req_cpu: rq.status?.used?.['requests.cpu'] ?? '',
      used_req_mem: rq.status?.used?.['requests.memory'] ?? '',
      used_pods: rq.status?.used?.['pods'] ?? '',
    }
  } catch (err: unknown) {
    if (isHttpError(err) && err.code === 404) {
      return null
    }
    throw err
  }
}

/**
 * Creates or replaces the workspacekit-quota ResourceQuota.
 */
export async function saveResourceQuota(
  reqCpu: string,
  reqMem: string,
  pods: string,
  ns: string = namespace,
): Promise<void> {
  const quota: k8s.V1ResourceQuota = {
    apiVersion: 'v1',
    kind: 'ResourceQuota',
    metadata: {
      name: RESOURCE_QUOTA_NAME,
      namespace: ns,
    },
    spec: {
      hard: {
        'requests.cpu': reqCpu,
        'requests.memory': reqMem,
        pods,
      },
    },
  }

  try {
    await coreV1.createNamespacedResourceQuota({
      namespace: ns,
      body: quota,
    })
  } catch (err: unknown) {
    if (isHttpError(err) && err.code === 409) {
      await coreV1.replaceNamespacedResourceQuota({
        name: RESOURCE_QUOTA_NAME,
        namespace: ns,
        body: quota,
      })
      return
    }
    throw err
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
