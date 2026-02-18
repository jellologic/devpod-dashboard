import { describe, test, expect, mock, beforeEach } from 'bun:test'
import type * as k8s from '@kubernetes/client-node'

// ---------------------------------------------------------------------------
// Mock functions
// ---------------------------------------------------------------------------

const mockListNamespacedPod = mock(() =>
  Promise.resolve({
    items: [
      {
        metadata: {
          name: 'ws-abc123',
          labels: {
            'managed-by': 'workspacekit',
            'workspace-name': 'my-project',
            'workspace-uid': 'abc123',
          },
        },
        spec: {
          containers: [
            {
              name: 'dev',
              resources: {
                requests: { cpu: '500m', memory: '1Gi' },
                limits: { cpu: '2', memory: '4Gi' },
              },
              volumeMounts: [
                { name: 'workspace', mountPath: '/workspace/my-project' },
              ],
            },
          ],
        },
        status: {
          phase: 'Running',
          containerStatuses: [{ name: 'dev', ready: true }],
        },
      },
    ],
  }),
)

const mockReadNamespacedPod = mock(() =>
  Promise.resolve({
    metadata: {
      name: 'ws-abc123',
      labels: {
        'managed-by': 'workspacekit',
        'workspace-name': 'my-project',
        'workspace-uid': 'abc123',
      },
    },
    status: { phase: 'Running', containerStatuses: [{ name: 'dev', ready: true }] },
  }),
)

const mockCreateNamespacedPod = mock((params: { body: k8s.V1Pod }) =>
  Promise.resolve(params.body),
)

const mockDeleteNamespacedPod = mock(() => Promise.resolve({}))

const mockPatchNamespacedPod = mock(() =>
  Promise.resolve({ metadata: { name: 'ws-abc123', annotations: { foo: 'bar' } } }),
)

// ---------------------------------------------------------------------------
// Mock the client module
// ---------------------------------------------------------------------------

mock.module('../src/client', () => ({
  coreV1: {
    listNamespacedPod: mockListNamespacedPod,
    readNamespacedPod: mockReadNamespacedPod,
    createNamespacedPod: mockCreateNamespacedPod,
    deleteNamespacedPod: mockDeleteNamespacedPod,
    patchNamespacedPod: mockPatchNamespacedPod,
  },
  exec: {
    exec: mock(() => Promise.resolve({})),
  },
  namespace: 'workspacekit',
}))

// Import after mocking
const {
  listWorkspacePods,
  getPod,
  createPod,
  deletePod,
  patchPodAnnotations,
  removePodAnnotations,
  getContainerResources,
  isDirectWorkspace,
  getWorkspaceName,
  getWorkspaceUid,
  isPodReady,
  buildPodSpec,
} = await import('../src/pods')

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('listWorkspacePods', () => {
  beforeEach(() => {
    mockListNamespacedPod.mockClear()
  })

  test('returns pods with managed-by label', async () => {
    const pods = await listWorkspacePods()
    expect(pods).toHaveLength(1)
    expect(pods[0].metadata?.name).toBe('ws-abc123')
    expect(mockListNamespacedPod).toHaveBeenCalledWith({
      namespace: 'workspacekit',
      labelSelector: 'managed-by=workspacekit',
    })
  })

  test('returns empty array when no pods exist', async () => {
    mockListNamespacedPod.mockResolvedValueOnce({ items: [] })
    const pods = await listWorkspacePods()
    expect(pods).toHaveLength(0)
  })
})

describe('getPod', () => {
  beforeEach(() => {
    mockReadNamespacedPod.mockClear()
  })

  test('returns pod when found', async () => {
    const pod = await getPod('ws-abc123')
    expect(pod).not.toBeNull()
    expect(pod!.metadata?.name).toBe('ws-abc123')
  })

  test('returns null on 404', async () => {
    mockReadNamespacedPod.mockRejectedValueOnce({ code: 404 })
    const pod = await getPod('nonexistent')
    expect(pod).toBeNull()
  })

  test('throws on non-404 errors', async () => {
    mockReadNamespacedPod.mockRejectedValueOnce({ code: 500, message: 'server error' })
    await expect(getPod('ws-abc123')).rejects.toEqual({
      code: 500,
      message: 'server error',
    })
  })
})

describe('createPod', () => {
  beforeEach(() => {
    mockCreateNamespacedPod.mockClear()
  })

  test('creates and returns a pod', async () => {
    const spec = { metadata: { name: 'ws-new' } } as k8s.V1Pod
    const created = await createPod(spec)
    expect(created.metadata?.name).toBe('ws-new')
    expect(mockCreateNamespacedPod).toHaveBeenCalledTimes(1)
  })
})

describe('deletePod', () => {
  beforeEach(() => {
    mockDeleteNamespacedPod.mockClear()
  })

  test('deletes a pod with default grace period', async () => {
    await deletePod('ws-abc123')
    expect(mockDeleteNamespacedPod).toHaveBeenCalledWith({
      name: 'ws-abc123',
      namespace: 'workspacekit',
      gracePeriodSeconds: 30,
    })
  })

  test('deletes a pod with custom grace period', async () => {
    await deletePod('ws-abc123', 0)
    expect(mockDeleteNamespacedPod).toHaveBeenCalledWith({
      name: 'ws-abc123',
      namespace: 'workspacekit',
      gracePeriodSeconds: 0,
    })
  })

  test('ignores 404 errors', async () => {
    mockDeleteNamespacedPod.mockRejectedValueOnce({ code: 404 })
    await expect(deletePod('nonexistent')).resolves.toBeUndefined()
  })

  test('throws on non-404 errors', async () => {
    mockDeleteNamespacedPod.mockRejectedValueOnce({ code: 500 })
    await expect(deletePod('ws-abc123')).rejects.toEqual({ code: 500 })
  })
})

describe('patchPodAnnotations', () => {
  beforeEach(() => {
    mockPatchNamespacedPod.mockClear()
  })

  test('patches annotations on a pod', async () => {
    const result = await patchPodAnnotations('ws-abc123', { foo: 'bar' })
    expect(result.metadata?.annotations?.foo).toBe('bar')
    expect(mockPatchNamespacedPod).toHaveBeenCalledTimes(1)
  })
})

describe('removePodAnnotations', () => {
  beforeEach(() => {
    mockPatchNamespacedPod.mockClear()
  })

  test('removes annotations by setting them to null', async () => {
    await removePodAnnotations('ws-abc123', ['shutdown-at', 'timer-hours'])
    expect(mockPatchNamespacedPod).toHaveBeenCalledTimes(1)
  })
})

describe('getContainerResources', () => {
  test('extracts resources from first container', () => {
    const pod = {
      spec: {
        containers: [
          {
            name: 'dev',
            resources: {
              requests: { cpu: '500m', memory: '1Gi' },
              limits: { cpu: '2', memory: '4Gi' },
            },
          },
        ],
      },
    } as k8s.V1Pod

    const resources = getContainerResources(pod)
    expect(resources.req_cpu).toBe('500m')
    expect(resources.req_mem).toBe('1Gi')
    expect(resources.lim_cpu).toBe('2')
    expect(resources.lim_mem).toBe('4Gi')
  })

  test('returns empty strings when no resources defined', () => {
    const pod = { spec: { containers: [{ name: 'dev' }] } } as k8s.V1Pod
    const resources = getContainerResources(pod)
    expect(resources.req_cpu).toBe('')
    expect(resources.req_mem).toBe('')
    expect(resources.lim_cpu).toBe('')
    expect(resources.lim_mem).toBe('')
  })

  test('returns empty strings when pod has no spec', () => {
    const pod = {} as k8s.V1Pod
    const resources = getContainerResources(pod)
    expect(resources.req_cpu).toBe('')
  })
})

describe('isDirectWorkspace', () => {
  test('returns true for managed pods', () => {
    const pod = {
      metadata: { labels: { 'managed-by': 'workspacekit' } },
    } as k8s.V1Pod
    expect(isDirectWorkspace(pod)).toBe(true)
  })

  test('returns false for unmanaged pods', () => {
    const pod = {
      metadata: { labels: { 'managed-by': 'something-else' } },
    } as k8s.V1Pod
    expect(isDirectWorkspace(pod)).toBe(false)
  })

  test('returns false when no labels', () => {
    const pod = { metadata: {} } as k8s.V1Pod
    expect(isDirectWorkspace(pod)).toBe(false)
  })
})

describe('getWorkspaceName', () => {
  test('returns name from label', () => {
    const pod = {
      metadata: { labels: { 'workspace-name': 'my-project' } },
    } as k8s.V1Pod
    expect(getWorkspaceName(pod)).toBe('my-project')
  })

  test('falls back to volume mount path', () => {
    const pod = {
      metadata: { labels: {} },
      spec: {
        containers: [
          {
            name: 'dev',
            volumeMounts: [{ name: 'workspace', mountPath: '/workspace/fallback-name' }],
          },
        ],
      },
    } as k8s.V1Pod
    expect(getWorkspaceName(pod)).toBe('fallback-name')
  })

  test('falls back to pod name', () => {
    const pod = {
      metadata: { name: 'ws-xyz', labels: {} },
      spec: { containers: [{ name: 'dev', volumeMounts: [] }] },
    } as k8s.V1Pod
    expect(getWorkspaceName(pod)).toBe('ws-xyz')
  })
})

describe('getWorkspaceUid', () => {
  test('returns uid from label', () => {
    const pod = {
      metadata: { labels: { 'workspace-uid': 'abc123' } },
    } as k8s.V1Pod
    expect(getWorkspaceUid(pod)).toBe('abc123')
  })

  test('returns empty string when no uid label', () => {
    const pod = { metadata: { labels: {} } } as k8s.V1Pod
    expect(getWorkspaceUid(pod)).toBe('')
  })
})

describe('isPodReady', () => {
  test('returns true when Running and container ready', () => {
    const pod = {
      status: {
        phase: 'Running',
        containerStatuses: [{ name: 'dev', ready: true }],
      },
    } as k8s.V1Pod
    expect(isPodReady(pod)).toBe(true)
  })

  test('returns false when not Running', () => {
    const pod = {
      status: { phase: 'Pending', containerStatuses: [] },
    } as k8s.V1Pod
    expect(isPodReady(pod)).toBe(false)
  })

  test('returns false when Running but no containers ready', () => {
    const pod = {
      status: {
        phase: 'Running',
        containerStatuses: [{ name: 'dev', ready: false }],
      },
    } as k8s.V1Pod
    expect(isPodReady(pod)).toBe(false)
  })

  test('returns false when no status', () => {
    const pod = {} as k8s.V1Pod
    expect(isPodReady(pod)).toBe(false)
  })
})

describe('buildPodSpec', () => {
  test('builds a complete pod spec', () => {
    const pod = buildPodSpec({
      name: 'my-project',
      uid: 'abc123',
      repoUrl: 'https://github.com/user/repo.git',
      image: 'node:20',
      resources: {
        req_cpu: '500m',
        req_mem: '1Gi',
        lim_cpu: '2',
        lim_mem: '4Gi',
      },
    })

    expect(pod.metadata?.name).toBe('ws-abc123')
    expect(pod.metadata?.labels?.['managed-by']).toBe('workspacekit')
    expect(pod.metadata?.labels?.['workspace-name']).toBe('my-project')
    expect(pod.metadata?.labels?.['workspace-uid']).toBe('abc123')

    // Init container
    expect(pod.spec?.initContainers).toHaveLength(1)
    expect(pod.spec?.initContainers?.[0].name).toBe('git-clone')
    expect(pod.spec?.initContainers?.[0].image).toBe('alpine/git')

    // Main container
    expect(pod.spec?.containers).toHaveLength(1)
    const container = pod.spec!.containers[0]
    expect(container.name).toBe('dev')
    expect(container.image).toBe('node:20')
    expect(container.ports?.[0].containerPort).toBe(10800)
    expect(container.resources?.requests?.cpu).toBe('500m')
    expect(container.resources?.limits?.memory).toBe('4Gi')
    expect(container.workingDir).toBe('/workspace/my-project')
    expect(container.envFrom?.[0].secretRef?.name).toBe('gh-credentials')

    // Volumes
    expect(pod.spec?.volumes).toHaveLength(2)
    expect(pod.spec?.volumes?.[0].persistentVolumeClaim?.claimName).toBe('pvc-abc123')
    expect(pod.spec?.volumes?.[1].hostPath?.path).toBe('/opt/openvscode')
  })

  test('appends post-create command to init container', () => {
    const pod = buildPodSpec({
      name: 'my-project',
      uid: 'abc123',
      repoUrl: 'https://github.com/user/repo.git',
      image: 'node:20',
      resources: { req_cpu: '500m', req_mem: '1Gi', lim_cpu: '2', lim_mem: '4Gi' },
      postCreateCmd: 'npm install',
    })

    const initArgs = pod.spec!.initContainers![0].args![0]
    expect(initArgs).toContain('npm install')
    expect(initArgs).toContain('cd /workspace/my-project')
  })

  test('uses custom openvscode path', () => {
    const pod = buildPodSpec({
      name: 'my-project',
      uid: 'abc123',
      repoUrl: 'https://github.com/user/repo.git',
      image: 'node:20',
      resources: { req_cpu: '500m', req_mem: '1Gi', lim_cpu: '2', lim_mem: '4Gi' },
      openvscodePath: '/custom/path',
    })

    expect(pod.spec?.containers[0].command?.[0]).toBe('/custom/path/bin/openvscode-server')
    expect(pod.spec?.volumes?.[1].hostPath?.path).toBe('/custom/path')
  })
})
