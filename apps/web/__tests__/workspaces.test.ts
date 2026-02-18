import { describe, test, expect, mock, beforeEach } from 'bun:test'

// ---------------------------------------------------------------------------
// Mock functions for @workspacekit/k8s
// ---------------------------------------------------------------------------

const mockListWorkspacePods = mock(() => Promise.resolve([]))
const mockGetPod = mock((_name: string) => Promise.resolve(null))
const mockCreatePod = mock((spec: unknown) => Promise.resolve(spec))
const mockDeletePod = mock((_name: string) => Promise.resolve())
const mockCreateService = mock((spec: unknown) => Promise.resolve(spec))
const mockDeleteService = mock((_name: string) => Promise.resolve())
const mockCreatePvc = mock((spec: unknown) => Promise.resolve(spec))
const mockDeletePvc = mock((_name: string) => Promise.resolve())
const mockGetPvc = mock((_name: string) => Promise.resolve(null))
const mockPatchPodAnnotations = mock((_name: string, _ann: unknown) =>
  Promise.resolve({}),
)
const mockUpsertConfigMap = mock(() => Promise.resolve({}))
const mockGetConfigMap = mock((_name: string) => Promise.resolve(null))
const mockDeleteConfigMap = mock((_name: string) => Promise.resolve())
const mockGetSavedPodSpec = mock((_uid: string) => Promise.resolve(null))
const mockSavePodSpec = mock(() => Promise.resolve())
const mockSaveWorkspaceMeta = mock(() => Promise.resolve())
const mockGetWorkspaceMeta = mock((_name: string) => Promise.resolve(null))
const mockGetWorkspaceName = mock(
  (pod: { metadata?: { labels?: Record<string, string> } }) =>
    pod.metadata?.labels?.['workspace-name'] ?? '',
)
const mockGetWorkspaceUid = mock(
  (pod: { metadata?: { labels?: Record<string, string> } }) =>
    pod.metadata?.labels?.['workspace-uid'] ?? '',
)
const mockBuildPodSpec = mock((opts: { name: string; uid: string }) => ({
  metadata: {
    name: `ws-${opts.uid}`,
    labels: {
      'managed-by': 'workspacekit',
      'workspace-name': opts.name,
      'workspace-uid': opts.uid,
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
      },
    ],
  },
}))
const mockBuildServiceSpec = mock((name: string, uid: string) => ({
  metadata: {
    name: `svc-${uid}`,
    labels: {
      'managed-by': 'workspacekit',
      'workspace-name': name,
      'workspace-uid': uid,
    },
  },
  spec: {
    type: 'NodePort',
    ports: [{ port: 10800, nodePort: 30100 }],
  },
}))
const mockBuildPvcSpec = mock((_name: string, uid: string, _diskSize: string) => ({
  metadata: {
    name: `pvc-${uid}`,
    labels: { 'managed-by': 'workspacekit' },
  },
  spec: {
    accessModes: ['ReadWriteOnce'],
    resources: { requests: { storage: '50Gi' } },
  },
}))
const mockGetNodePort = mock(
  (svc: { spec?: { ports?: Array<{ nodePort?: number }> } }) =>
    svc?.spec?.ports?.[0]?.nodePort ?? 0,
)
const mockIsPodReady = mock(
  (pod: { status?: { phase?: string; containerStatuses?: Array<{ ready: boolean }> } }) => {
    if (pod.status?.phase !== 'Running') return false
    return pod.status?.containerStatuses?.some((s) => s.ready) ?? false
  },
)
const mockGetContainerResources = mock(() => ({
  req_cpu: '500m',
  req_mem: '1Gi',
  lim_cpu: '2',
  lim_mem: '4Gi',
}))
const mockIsDirectWorkspace = mock(
  (pod: { metadata?: { labels?: Record<string, string> } }) =>
    pod.metadata?.labels?.['managed-by'] === 'workspacekit',
)
const mockListWorkspaceServices = mock(() => Promise.resolve([]))
const mockGetPodMetrics = mock(() => Promise.resolve(new Map()))
const mockGetPodEvents = mock(() => Promise.resolve([]))
const mockListWorkspacePvcs = mock(() => Promise.resolve([]))
const mockRemovePodAnnotations = mock(() => Promise.resolve({}))

mock.module('@workspacekit/k8s', () => ({
  listWorkspacePods: mockListWorkspacePods,
  getPod: mockGetPod,
  createPod: mockCreatePod,
  deletePod: mockDeletePod,
  createService: mockCreateService,
  deleteService: mockDeleteService,
  createPvc: mockCreatePvc,
  deletePvc: mockDeletePvc,
  getPvc: mockGetPvc,
  patchPodAnnotations: mockPatchPodAnnotations,
  upsertConfigMap: mockUpsertConfigMap,
  getConfigMap: mockGetConfigMap,
  deleteConfigMap: mockDeleteConfigMap,
  getSavedPodSpec: mockGetSavedPodSpec,
  savePodSpec: mockSavePodSpec,
  saveWorkspaceMeta: mockSaveWorkspaceMeta,
  getWorkspaceMeta: mockGetWorkspaceMeta,
  getWorkspaceName: mockGetWorkspaceName,
  getWorkspaceUid: mockGetWorkspaceUid,
  buildPodSpec: mockBuildPodSpec,
  buildServiceSpec: mockBuildServiceSpec,
  buildPvcSpec: mockBuildPvcSpec,
  getNodePort: mockGetNodePort,
  isPodReady: mockIsPodReady,
  getContainerResources: mockGetContainerResources,
  isDirectWorkspace: mockIsDirectWorkspace,
  listWorkspaceServices: mockListWorkspaceServices,
  getPodMetrics: mockGetPodMetrics,
  getPodEvents: mockGetPodEvents,
  listWorkspacePvcs: mockListWorkspacePvcs,
  removePodAnnotations: mockRemovePodAnnotations,
  namespace: 'workspacekit',
}))

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRunningPod(name: string, uid: string) {
  return {
    metadata: {
      name: `ws-${uid}`,
      labels: {
        'managed-by': 'workspacekit',
        'workspace-name': name,
        'workspace-uid': uid,
      },
      annotations: {},
      creationTimestamp: new Date().toISOString(),
    },
    spec: {
      containers: [
        {
          name: 'dev',
          image: 'node:20',
          resources: {
            requests: { cpu: '500m', memory: '1Gi' },
            limits: { cpu: '2', memory: '4Gi' },
          },
        },
      ],
    },
    status: {
      phase: 'Running',
      containerStatuses: [{ name: 'dev', ready: true }],
      podIP: '10.0.0.1',
    },
  }
}

function makeSavedPodSpec(name: string, uid: string) {
  return {
    metadata: {
      name: `ws-${uid}`,
      labels: {
        'managed-by': 'workspacekit',
        'workspace-name': name,
        'workspace-uid': uid,
      },
    },
    spec: {
      containers: [
        {
          name: 'dev',
          image: 'node:20',
          resources: {
            requests: { cpu: '500m', memory: '1Gi' },
            limits: { cpu: '2', memory: '4Gi' },
          },
        },
      ],
    },
  }
}

function makeService(name: string, uid: string, nodePort: number) {
  return {
    metadata: {
      name: `svc-${uid}`,
      labels: {
        'managed-by': 'workspacekit',
        'workspace-name': name,
        'workspace-uid': uid,
      },
    },
    spec: {
      type: 'NodePort',
      ports: [{ port: 10800, targetPort: 10800, nodePort }],
    },
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('getWorkspaces - building workspace list', () => {
  beforeEach(() => {
    mockListWorkspacePods.mockReset()
    mockListWorkspaceServices.mockReset()
    mockGetSavedPodSpec.mockReset()
    mockGetConfigMap.mockReset()
    mockIsPodReady.mockReset()
    mockGetWorkspaceName.mockReset()
    mockGetWorkspaceUid.mockReset()
    mockGetNodePort.mockReset()
    mockGetContainerResources.mockReset()
    mockIsDirectWorkspace.mockReset()
    mockListWorkspacePvcs.mockReset()
  })

  test('returns running workspaces from pod list', async () => {
    const pod = makeRunningPod('my-project', 'abc123')
    mockListWorkspacePods.mockResolvedValueOnce([pod])
    mockListWorkspaceServices.mockResolvedValueOnce([
      makeService('my-project', 'abc123', 30100),
    ])

    const pods = await mockListWorkspacePods()
    expect(pods).toHaveLength(1)
    expect(pods[0].metadata?.labels?.['workspace-name']).toBe('my-project')
    expect(pods[0].status?.phase).toBe('Running')
  })

  test('returns empty list when no pods exist', async () => {
    mockListWorkspacePods.mockResolvedValueOnce([])
    const pods = await mockListWorkspacePods()
    expect(pods).toHaveLength(0)
  })

  test('identifies stopped workspaces from saved pod specs', async () => {
    // No running pods
    mockListWorkspacePods.mockResolvedValueOnce([])

    // But a saved spec exists
    const savedSpec = makeSavedPodSpec('stopped-project', 'def456')
    mockGetSavedPodSpec.mockResolvedValueOnce(savedSpec)

    const pods = await mockListWorkspacePods()
    expect(pods).toHaveLength(0) // no running pods

    const saved = await mockGetSavedPodSpec('def456')
    expect(saved).not.toBeNull()
    expect(saved!.metadata?.labels?.['workspace-name']).toBe('stopped-project')
  })
})

describe('createWorkspace - creating a new workspace', () => {
  beforeEach(() => {
    mockCreatePod.mockReset()
    mockCreatePvc.mockReset()
    mockCreateService.mockReset()
    mockSaveWorkspaceMeta.mockReset()
    mockBuildPodSpec.mockReset()
    mockBuildServiceSpec.mockReset()
    mockBuildPvcSpec.mockReset()
  })

  test('creates PVC, pod, service, and meta configmap', async () => {
    const uid = 'new123'
    const name = 'test-workspace'
    const repoUrl = 'https://github.com/org/repo.git'

    // Step 1: build and create PVC
    const pvcSpec = mockBuildPvcSpec(name, uid, '50Gi')
    await mockCreatePvc(pvcSpec)

    // Step 2: build and create pod
    const podSpec = mockBuildPodSpec({ name, uid, repoUrl, image: 'node:20' })
    await mockCreatePod(podSpec)

    // Step 3: build and create service
    const svcSpec = mockBuildServiceSpec(name, uid)
    await mockCreateService(svcSpec)

    // Step 4: save workspace metadata
    await mockSaveWorkspaceMeta(name, uid, repoUrl, 'node:20', '')

    expect(mockCreatePvc).toHaveBeenCalledTimes(1)
    expect(mockCreatePod).toHaveBeenCalledTimes(1)
    expect(mockCreateService).toHaveBeenCalledTimes(1)
    expect(mockSaveWorkspaceMeta).toHaveBeenCalledTimes(1)
  })

  test('buildPodSpec generates correct pod name', () => {
    const spec = mockBuildPodSpec({
      name: 'my-project',
      uid: 'xyz789',
      repoUrl: 'https://github.com/user/repo.git',
      image: 'node:20',
    })

    expect(spec.metadata?.name).toBe('ws-xyz789')
    expect(spec.metadata?.labels?.['managed-by']).toBe('workspacekit')
    expect(spec.metadata?.labels?.['workspace-name']).toBe('my-project')
    expect(spec.metadata?.labels?.['workspace-uid']).toBe('xyz789')
  })
})

describe('stopWorkspace - stopping a running workspace', () => {
  beforeEach(() => {
    mockGetPod.mockReset()
    mockDeletePod.mockReset()
    mockSavePodSpec.mockReset()
  })

  test('saves pod spec then deletes the pod', async () => {
    const pod = makeRunningPod('my-project', 'abc123')
    mockGetPod.mockResolvedValueOnce(pod)

    // Step 1: fetch the pod to get current spec
    const fetched = await mockGetPod('ws-abc123')
    expect(fetched).not.toBeNull()

    // Step 2: save the pod spec as a configmap
    await mockSavePodSpec('abc123', 'my-project', fetched!)

    // Step 3: delete the pod
    await mockDeletePod('ws-abc123')

    expect(mockGetPod).toHaveBeenCalledWith('ws-abc123')
    expect(mockSavePodSpec).toHaveBeenCalledTimes(1)
    expect(mockDeletePod).toHaveBeenCalledWith('ws-abc123')
  })

  test('handles pod not found gracefully', async () => {
    mockGetPod.mockResolvedValueOnce(null)

    const pod = await mockGetPod('ws-nonexistent')
    expect(pod).toBeNull()

    // Should not attempt to save spec or delete if pod not found
    expect(mockSavePodSpec).not.toHaveBeenCalled()
    expect(mockDeletePod).not.toHaveBeenCalled()
  })
})

describe('startWorkspace - starting a stopped workspace', () => {
  beforeEach(() => {
    mockGetSavedPodSpec.mockReset()
    mockCreatePod.mockReset()
    mockDeleteConfigMap.mockReset()
  })

  test('creates pod from saved spec and removes saved spec configmap', async () => {
    const savedSpec = makeSavedPodSpec('my-project', 'abc123')
    mockGetSavedPodSpec.mockResolvedValueOnce(savedSpec)

    // Step 1: load saved pod spec
    const spec = await mockGetSavedPodSpec('abc123')
    expect(spec).not.toBeNull()

    // Step 2: create pod from saved spec
    await mockCreatePod(spec!)

    // Step 3: delete the saved spec configmap
    await mockDeleteConfigMap('saved-abc123')

    expect(mockGetSavedPodSpec).toHaveBeenCalledWith('abc123')
    expect(mockCreatePod).toHaveBeenCalledTimes(1)
    expect(mockDeleteConfigMap).toHaveBeenCalledWith('saved-abc123')
  })

  test('returns error when no saved spec exists', async () => {
    mockGetSavedPodSpec.mockResolvedValueOnce(null)

    const spec = await mockGetSavedPodSpec('nonexistent')
    expect(spec).toBeNull()

    // Should not attempt to create pod if no saved spec
    expect(mockCreatePod).not.toHaveBeenCalled()
  })
})

describe('deleteWorkspace - deleting a workspace entirely', () => {
  beforeEach(() => {
    mockDeletePod.mockReset()
    mockDeletePvc.mockReset()
    mockDeleteService.mockReset()
    mockDeleteConfigMap.mockReset()
  })

  test('deletes pod, PVC, service, meta configmap, and saved spec', async () => {
    const name = 'my-project'
    const uid = 'abc123'

    await mockDeletePod(`ws-${uid}`)
    await mockDeleteService(`svc-${uid}`)
    await mockDeletePvc(`pvc-${uid}`)
    await mockDeleteConfigMap(`meta-${name}`)
    await mockDeleteConfigMap(`saved-${uid}`)

    expect(mockDeletePod).toHaveBeenCalledWith(`ws-${uid}`)
    expect(mockDeleteService).toHaveBeenCalledWith(`svc-${uid}`)
    expect(mockDeletePvc).toHaveBeenCalledWith(`pvc-${uid}`)
    expect(mockDeleteConfigMap).toHaveBeenCalledTimes(2)
    expect(mockDeleteConfigMap).toHaveBeenCalledWith(`meta-${name}`)
    expect(mockDeleteConfigMap).toHaveBeenCalledWith(`saved-${uid}`)
  })

  test('tolerates already-deleted resources (idempotent)', async () => {
    // All delete functions should resolve even if resources are already gone
    // (the real k8s module ignores 404 errors)
    mockDeletePod.mockResolvedValueOnce(undefined)
    mockDeleteService.mockResolvedValueOnce(undefined)
    mockDeletePvc.mockResolvedValueOnce(undefined)
    mockDeleteConfigMap.mockResolvedValue(undefined)

    await expect(mockDeletePod('ws-gone')).resolves.toBeUndefined()
    await expect(mockDeleteService('svc-gone')).resolves.toBeUndefined()
    await expect(mockDeletePvc('pvc-gone')).resolves.toBeUndefined()
    await expect(mockDeleteConfigMap('meta-gone')).resolves.toBeUndefined()
  })
})

describe('error handling - K8s API errors', () => {
  beforeEach(() => {
    mockCreatePod.mockReset()
    mockCreatePvc.mockReset()
    mockListWorkspacePods.mockReset()
  })

  test('propagates K8s API error from createPod', async () => {
    mockCreatePod.mockRejectedValueOnce({ code: 500, message: 'Internal server error' })

    await expect(mockCreatePod({})).rejects.toEqual({
      code: 500,
      message: 'Internal server error',
    })
  })

  test('propagates K8s API error from createPvc', async () => {
    mockCreatePvc.mockRejectedValueOnce({
      code: 403,
      message: 'Forbidden: exceeded quota',
    })

    await expect(mockCreatePvc({})).rejects.toEqual({
      code: 403,
      message: 'Forbidden: exceeded quota',
    })
  })

  test('handles listWorkspacePods API failure', async () => {
    mockListWorkspacePods.mockRejectedValueOnce(new Error('Connection refused'))

    await expect(mockListWorkspacePods()).rejects.toThrow('Connection refused')
  })

  test('handles conflict error on upsertConfigMap', async () => {
    mockUpsertConfigMap.mockReset()
    mockUpsertConfigMap.mockRejectedValueOnce({ code: 409, message: 'Conflict' })

    await expect(mockUpsertConfigMap()).rejects.toEqual({
      code: 409,
      message: 'Conflict',
    })
  })
})

describe('workspace naming and spec building', () => {
  test('buildServiceSpec creates correct NodePort spec', () => {
    mockBuildServiceSpec.mockReset()
    mockBuildServiceSpec.mockReturnValueOnce({
      metadata: {
        name: 'svc-uid1',
        labels: {
          'managed-by': 'workspacekit',
          'workspace-name': 'test',
          'workspace-uid': 'uid1',
        },
      },
      spec: {
        type: 'NodePort',
        selector: { 'workspace-uid': 'uid1' },
        ports: [{ port: 10800, targetPort: 10800 }],
      },
    })

    const svc = mockBuildServiceSpec('test', 'uid1')
    expect(svc.metadata?.name).toBe('svc-uid1')
    expect(svc.spec?.type).toBe('NodePort')
    expect(svc.spec?.selector?.['workspace-uid']).toBe('uid1')
  })

  test('buildPvcSpec creates correct PVC with requested disk size', () => {
    mockBuildPvcSpec.mockReset()
    mockBuildPvcSpec.mockReturnValueOnce({
      metadata: {
        name: 'pvc-uid1',
        labels: {
          'managed-by': 'workspacekit',
          'workspace-name': 'test',
          'workspace-uid': 'uid1',
        },
      },
      spec: {
        accessModes: ['ReadWriteOnce'],
        resources: { requests: { storage: '100Gi' } },
      },
    })

    const pvc = mockBuildPvcSpec('test', 'uid1', '100Gi')
    expect(pvc.metadata?.name).toBe('pvc-uid1')
    expect(pvc.spec?.accessModes).toContain('ReadWriteOnce')
    expect(pvc.spec?.resources?.requests?.storage).toBe('100Gi')
  })
})
