import { describe, test, expect, mock, beforeEach } from 'bun:test'
import type * as k8s from '@kubernetes/client-node'

// ---------------------------------------------------------------------------
// Mock functions
// ---------------------------------------------------------------------------

const mockListNamespacedService = mock(() =>
  Promise.resolve({
    items: [
      {
        metadata: {
          name: 'svc-abc123',
          labels: { 'managed-by': 'workspacekit', 'workspace-uid': 'abc123' },
        },
        spec: {
          type: 'NodePort',
          ports: [{ port: 10800, targetPort: 10800, nodePort: 31234 }],
        },
      },
    ],
  }),
)

const mockReadNamespacedService = mock(() =>
  Promise.resolve({
    metadata: { name: 'svc-abc123' },
    spec: { ports: [{ port: 10800, nodePort: 31234 }] },
  }),
)

const mockCreateNamespacedService = mock((params: { body: k8s.V1Service }) =>
  Promise.resolve(params.body),
)

const mockDeleteNamespacedService = mock(() => Promise.resolve({}))

// ---------------------------------------------------------------------------
// Mock the client module
// ---------------------------------------------------------------------------

mock.module('../src/client', () => ({
  coreV1: {
    listNamespacedService: mockListNamespacedService,
    readNamespacedService: mockReadNamespacedService,
    createNamespacedService: mockCreateNamespacedService,
    deleteNamespacedService: mockDeleteNamespacedService,
  },
  namespace: 'workspacekit',
}))

const {
  listWorkspaceServices,
  getService,
  createService,
  deleteService,
  buildServiceSpec,
  getNodePort,
} = await import('../src/services')

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('listWorkspaceServices', () => {
  beforeEach(() => {
    mockListNamespacedService.mockClear()
  })

  test('returns services with managed-by label', async () => {
    const services = await listWorkspaceServices()
    expect(services).toHaveLength(1)
    expect(services[0].metadata?.name).toBe('svc-abc123')
    expect(mockListNamespacedService).toHaveBeenCalledWith({
      namespace: 'workspacekit',
      labelSelector: 'managed-by=workspacekit',
    })
  })

  test('returns empty array when no services', async () => {
    mockListNamespacedService.mockResolvedValueOnce({ items: [] })
    const services = await listWorkspaceServices()
    expect(services).toHaveLength(0)
  })
})

describe('getService', () => {
  beforeEach(() => {
    mockReadNamespacedService.mockClear()
  })

  test('returns service when found', async () => {
    const svc = await getService('svc-abc123')
    expect(svc).not.toBeNull()
    expect(svc!.metadata?.name).toBe('svc-abc123')
  })

  test('returns null on 404', async () => {
    mockReadNamespacedService.mockRejectedValueOnce({ code: 404 })
    const svc = await getService('nonexistent')
    expect(svc).toBeNull()
  })

  test('throws on non-404 errors', async () => {
    mockReadNamespacedService.mockRejectedValueOnce({ code: 500 })
    await expect(getService('svc-abc123')).rejects.toEqual({ code: 500 })
  })
})

describe('createService', () => {
  beforeEach(() => {
    mockCreateNamespacedService.mockClear()
  })

  test('creates and returns a service', async () => {
    const spec = { metadata: { name: 'svc-new' } } as k8s.V1Service
    const created = await createService(spec)
    expect(created.metadata?.name).toBe('svc-new')
    expect(mockCreateNamespacedService).toHaveBeenCalledTimes(1)
  })
})

describe('deleteService', () => {
  beforeEach(() => {
    mockDeleteNamespacedService.mockClear()
  })

  test('deletes a service', async () => {
    await deleteService('svc-abc123')
    expect(mockDeleteNamespacedService).toHaveBeenCalledWith({
      name: 'svc-abc123',
      namespace: 'workspacekit',
    })
  })

  test('ignores 404 errors', async () => {
    mockDeleteNamespacedService.mockRejectedValueOnce({ code: 404 })
    await expect(deleteService('nonexistent')).resolves.toBeUndefined()
  })

  test('throws on non-404 errors', async () => {
    mockDeleteNamespacedService.mockRejectedValueOnce({ code: 403 })
    await expect(deleteService('svc-abc123')).rejects.toEqual({ code: 403 })
  })
})

describe('buildServiceSpec', () => {
  test('builds a NodePort service spec', () => {
    const svc = buildServiceSpec('my-project', 'abc123', 'workspacekit')

    expect(svc.metadata?.name).toBe('svc-abc123')
    expect(svc.metadata?.namespace).toBe('workspacekit')
    expect(svc.metadata?.labels?.['managed-by']).toBe('workspacekit')
    expect(svc.metadata?.labels?.['workspace-name']).toBe('my-project')
    expect(svc.metadata?.labels?.['workspace-uid']).toBe('abc123')
    expect(svc.spec?.type).toBe('NodePort')
    expect(svc.spec?.selector?.['workspace-uid']).toBe('abc123')
    expect(svc.spec?.ports?.[0].port).toBe(10800)
    expect(svc.spec?.ports?.[0].targetPort).toBe(10800)
  })
})

describe('getNodePort', () => {
  test('extracts NodePort from service', () => {
    const svc = {
      spec: { ports: [{ port: 10800, nodePort: 31234 }] },
    } as k8s.V1Service
    expect(getNodePort(svc)).toBe(31234)
  })

  test('returns 0 when no ports', () => {
    const svc = { spec: { ports: [] } } as k8s.V1Service
    expect(getNodePort(svc)).toBe(0)
  })

  test('returns 0 when no nodePort assigned', () => {
    const svc = {
      spec: { ports: [{ port: 10800 }] },
    } as k8s.V1Service
    expect(getNodePort(svc)).toBe(0)
  })
})
