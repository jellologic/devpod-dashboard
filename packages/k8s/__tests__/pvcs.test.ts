import { describe, test, expect, mock, beforeEach } from 'bun:test'
import type * as k8s from '@kubernetes/client-node'

// ---------------------------------------------------------------------------
// Mock functions
// ---------------------------------------------------------------------------

const mockListNamespacedPVC = mock(() =>
  Promise.resolve({
    items: [
      {
        metadata: {
          name: 'pvc-abc123',
          labels: { 'managed-by': 'workspacekit', 'workspace-uid': 'abc123' },
        },
        spec: { accessModes: ['ReadWriteOnce'], resources: { requests: { storage: '10Gi' } } },
        status: { phase: 'Bound' },
      },
    ],
  }),
)

const mockReadNamespacedPVC = mock(() =>
  Promise.resolve({
    metadata: { name: 'pvc-abc123' },
    spec: { accessModes: ['ReadWriteOnce'] },
    status: { phase: 'Bound' },
  }),
)

const mockCreateNamespacedPVC = mock((params: { body: k8s.V1PersistentVolumeClaim }) =>
  Promise.resolve(params.body),
)

const mockDeleteNamespacedPVC = mock(() => Promise.resolve({}))

// ---------------------------------------------------------------------------
// Mock the client module
// ---------------------------------------------------------------------------

mock.module('../src/client', () => ({
  coreV1: {
    listNamespacedPersistentVolumeClaim: mockListNamespacedPVC,
    readNamespacedPersistentVolumeClaim: mockReadNamespacedPVC,
    createNamespacedPersistentVolumeClaim: mockCreateNamespacedPVC,
    deleteNamespacedPersistentVolumeClaim: mockDeleteNamespacedPVC,
  },
  namespace: 'workspacekit',
}))

const {
  listWorkspacePvcs,
  listAllPvcs,
  getPvc,
  createPvc,
  deletePvc,
  buildPvcSpec,
} = await import('../src/pvcs')

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('listWorkspacePvcs', () => {
  beforeEach(() => {
    mockListNamespacedPVC.mockClear()
  })

  test('returns PVCs with managed-by label', async () => {
    const pvcs = await listWorkspacePvcs()
    expect(pvcs).toHaveLength(1)
    expect(pvcs[0].metadata?.name).toBe('pvc-abc123')
    expect(mockListNamespacedPVC).toHaveBeenCalledWith({
      namespace: 'workspacekit',
      labelSelector: 'managed-by=workspacekit',
    })
  })

  test('returns empty array when no PVCs', async () => {
    mockListNamespacedPVC.mockResolvedValueOnce({ items: [] })
    const pvcs = await listWorkspacePvcs()
    expect(pvcs).toHaveLength(0)
  })
})

describe('listAllPvcs', () => {
  beforeEach(() => {
    mockListNamespacedPVC.mockClear()
  })

  test('lists all PVCs without label filter', async () => {
    await listAllPvcs()
    expect(mockListNamespacedPVC).toHaveBeenCalledWith({
      namespace: 'workspacekit',
    })
  })
})

describe('getPvc', () => {
  beforeEach(() => {
    mockReadNamespacedPVC.mockClear()
  })

  test('returns PVC when found', async () => {
    const pvc = await getPvc('pvc-abc123')
    expect(pvc).not.toBeNull()
    expect(pvc!.metadata?.name).toBe('pvc-abc123')
  })

  test('returns null on 404', async () => {
    mockReadNamespacedPVC.mockRejectedValueOnce({ code: 404 })
    const pvc = await getPvc('nonexistent')
    expect(pvc).toBeNull()
  })

  test('throws on non-404 errors', async () => {
    mockReadNamespacedPVC.mockRejectedValueOnce({ code: 500 })
    await expect(getPvc('pvc-abc123')).rejects.toEqual({ code: 500 })
  })
})

describe('createPvc', () => {
  beforeEach(() => {
    mockCreateNamespacedPVC.mockClear()
  })

  test('creates and returns a PVC', async () => {
    const spec = { metadata: { name: 'pvc-new' } } as k8s.V1PersistentVolumeClaim
    const created = await createPvc(spec)
    expect(created.metadata?.name).toBe('pvc-new')
    expect(mockCreateNamespacedPVC).toHaveBeenCalledTimes(1)
  })
})

describe('deletePvc', () => {
  beforeEach(() => {
    mockDeleteNamespacedPVC.mockClear()
  })

  test('deletes a PVC', async () => {
    await deletePvc('pvc-abc123')
    expect(mockDeleteNamespacedPVC).toHaveBeenCalledWith({
      name: 'pvc-abc123',
      namespace: 'workspacekit',
    })
  })

  test('ignores 404 errors', async () => {
    mockDeleteNamespacedPVC.mockRejectedValueOnce({ code: 404 })
    await expect(deletePvc('nonexistent')).resolves.toBeUndefined()
  })

  test('throws on non-404 errors', async () => {
    mockDeleteNamespacedPVC.mockRejectedValueOnce({ code: 403 })
    await expect(deletePvc('pvc-abc123')).rejects.toEqual({ code: 403 })
  })
})

describe('buildPvcSpec', () => {
  test('builds a PVC spec with correct fields', () => {
    const pvc = buildPvcSpec('my-project', 'abc123', '10Gi', 'workspacekit')

    expect(pvc.metadata?.name).toBe('pvc-abc123')
    expect(pvc.metadata?.namespace).toBe('workspacekit')
    expect(pvc.metadata?.labels?.['managed-by']).toBe('workspacekit')
    expect(pvc.metadata?.labels?.['workspace-name']).toBe('my-project')
    expect(pvc.metadata?.labels?.['workspace-uid']).toBe('abc123')
    expect(pvc.spec?.accessModes).toEqual(['ReadWriteOnce'])
    expect(pvc.spec?.resources?.requests?.storage).toBe('10Gi')
  })

  test('uses default namespace', () => {
    const pvc = buildPvcSpec('proj', 'uid1', '5Gi')
    expect(pvc.metadata?.namespace).toBe('workspacekit')
  })
})
