import { describe, test, expect, mock, beforeEach } from 'bun:test'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockListWorkspacePods = mock(() => Promise.resolve([]))
const mockListWorkspacePvcs = mock(() => Promise.resolve([]))
const mockListWorkspaceServices = mock(() => Promise.resolve([]))
const mockListConfigMaps = mock((_selector: string) => Promise.resolve([]))
const mockDeleteService = mock(() => Promise.resolve())
const mockDeleteConfigMap = mock(() => Promise.resolve())
const mockGetWorkspaceUid = mock((_pod: unknown) => '')

mock.module('@workspacekit/k8s', () => ({
  listWorkspacePods: mockListWorkspacePods,
  listWorkspacePvcs: mockListWorkspacePvcs,
  listWorkspaceServices: mockListWorkspaceServices,
  listConfigMaps: mockListConfigMaps,
  deleteService: mockDeleteService,
  deleteConfigMap: mockDeleteConfigMap,
  getWorkspaceUid: mockGetWorkspaceUid,
}))

const { cleanupOrphans } = await import('../src/cleanup')

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makePod(name: string, uid: string) {
  return {
    metadata: {
      name,
      labels: {
        'managed-by': 'workspacekit',
        'workspace-uid': uid,
        'workspace-name': name.replace('ws-', ''),
      },
    },
  }
}

function makePvc(name: string, uid: string, workspaceName: string) {
  return {
    metadata: {
      name,
      labels: {
        'managed-by': 'workspacekit',
        'workspace-uid': uid,
        'workspace-name': workspaceName,
      },
    },
  }
}

function makeService(name: string, uid: string) {
  return {
    metadata: {
      name,
      labels: {
        'managed-by': 'workspacekit',
        'workspace-uid': uid,
      },
    },
  }
}

function makeSavedSpecCm(uid: string, workspaceName: string) {
  return {
    metadata: {
      name: `saved-${uid}`,
      labels: {
        'managed-by': 'workspacekit',
        component: 'saved-spec',
        'workspace-uid': uid,
        'workspace-name': workspaceName,
      },
    },
  }
}

function makeMetaCm(workspaceName: string, uid: string) {
  return {
    metadata: {
      name: `meta-${workspaceName}`,
      labels: {
        'managed-by': 'workspacekit',
        component: 'workspace-meta',
        'workspace-name': workspaceName,
        'workspace-uid': uid,
      },
    },
  }
}

function makeCreatingCm(name: string, minutesAgo: number) {
  return {
    metadata: {
      name,
      creationTimestamp: new Date(
        Date.now() - minutesAgo * 60 * 1000,
      ).toISOString(),
      labels: {
        'managed-by': 'workspacekit',
        component: 'creating',
      },
    },
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('cleanup - cleanupOrphans', () => {
  beforeEach(() => {
    mockListWorkspacePods.mockReset()
    mockListWorkspacePvcs.mockReset()
    mockListWorkspaceServices.mockReset()
    mockListConfigMaps.mockReset()
    mockDeleteService.mockReset()
    mockDeleteConfigMap.mockReset()
    mockGetWorkspaceUid.mockReset()
  })

  test('detects orphaned PVC with no matching pod, saved spec, or meta', async () => {
    // PVC exists but no pod, no saved spec, no meta
    mockListWorkspacePods.mockResolvedValueOnce([])
    mockListWorkspacePvcs.mockResolvedValueOnce([
      makePvc('pvc-orphan', 'orphan-uid', 'orphan-ws'),
    ])
    mockListWorkspaceServices.mockResolvedValueOnce([])
    mockListConfigMaps.mockImplementation((selector: string) => {
      if (selector.includes('saved-spec')) return Promise.resolve([])
      if (selector.includes('workspace-meta')) return Promise.resolve([])
      if (selector.includes('creating')) return Promise.resolve([])
      return Promise.resolve([])
    })

    // Spy on console.warn to verify orphan detection
    const warnSpy = mock(() => {})
    const originalWarn = console.warn
    console.warn = warnSpy

    await cleanupOrphans()

    console.warn = originalWarn

    // Should have logged a warning about the orphaned PVC
    expect(warnSpy).toHaveBeenCalled()
    const warnMessage = warnSpy.mock.calls
      .map((c) => String(c[0]))
      .find((m) => m.includes('Orphaned PVC'))
    expect(warnMessage).toBeDefined()

    // Should NOT auto-delete PVCs
    // deleteService and deleteConfigMap may be called but not deletePvc
  })

  test('does not flag PVC as orphaned when matching pod exists', async () => {
    const pod = makePod('ws-active', 'active-uid')
    const pvc = makePvc('pvc-active', 'active-uid', 'active')

    mockListWorkspacePods.mockResolvedValueOnce([pod])
    mockListWorkspacePvcs.mockResolvedValueOnce([pvc])
    mockListWorkspaceServices.mockResolvedValueOnce([])
    mockListConfigMaps.mockImplementation((selector: string) => {
      if (selector.includes('creating')) return Promise.resolve([])
      return Promise.resolve([])
    })
    mockGetWorkspaceUid.mockReturnValue('active-uid')

    const warnSpy = mock(() => {})
    const originalWarn = console.warn
    console.warn = warnSpy

    await cleanupOrphans()

    console.warn = originalWarn

    const orphanWarning = warnSpy.mock.calls
      .map((c) => String(c[0]))
      .find((m) => m.includes('Orphaned PVC'))
    expect(orphanWarning).toBeUndefined()
  })

  test('does not flag PVC as orphaned when saved spec exists', async () => {
    // Pod is stopped but saved spec exists (workspace is stopped, not orphaned)
    const pvc = makePvc('pvc-stopped', 'stopped-uid', 'stopped-ws')
    const savedSpec = makeSavedSpecCm('stopped-uid', 'stopped-ws')

    mockListWorkspacePods.mockResolvedValueOnce([])
    mockListWorkspacePvcs.mockResolvedValueOnce([pvc])
    mockListWorkspaceServices.mockResolvedValueOnce([])
    mockListConfigMaps.mockImplementation((selector: string) => {
      if (selector.includes('saved-spec'))
        return Promise.resolve([savedSpec])
      if (selector.includes('creating')) return Promise.resolve([])
      return Promise.resolve([])
    })

    const warnSpy = mock(() => {})
    const originalWarn = console.warn
    console.warn = warnSpy

    await cleanupOrphans()

    console.warn = originalWarn

    const orphanWarning = warnSpy.mock.calls
      .map((c) => String(c[0]))
      .find((m) => m.includes('Orphaned PVC'))
    expect(orphanWarning).toBeUndefined()
  })

  test('deletes orphaned service with no matching pod or saved spec', async () => {
    const svc = makeService('svc-orphan', 'orphan-uid')

    mockListWorkspacePods.mockResolvedValueOnce([])
    mockListWorkspacePvcs.mockResolvedValueOnce([])
    mockListWorkspaceServices.mockResolvedValueOnce([svc])
    mockListConfigMaps.mockImplementation((selector: string) => {
      if (selector.includes('saved-spec')) return Promise.resolve([])
      if (selector.includes('creating')) return Promise.resolve([])
      return Promise.resolve([])
    })

    await cleanupOrphans()

    expect(mockDeleteService).toHaveBeenCalledWith('svc-orphan')
  })

  test('does not delete service when workspace is stopped (has saved spec)', async () => {
    const svc = makeService('svc-stopped', 'stopped-uid')
    const savedSpec = makeSavedSpecCm('stopped-uid', 'stopped-ws')

    mockListWorkspacePods.mockResolvedValueOnce([])
    mockListWorkspacePvcs.mockResolvedValueOnce([])
    mockListWorkspaceServices.mockResolvedValueOnce([svc])
    mockListConfigMaps.mockImplementation((selector: string) => {
      if (selector.includes('saved-spec'))
        return Promise.resolve([savedSpec])
      if (selector.includes('creating')) return Promise.resolve([])
      return Promise.resolve([])
    })

    await cleanupOrphans()

    expect(mockDeleteService).not.toHaveBeenCalled()
  })

  test('does not delete service when matching pod exists', async () => {
    const pod = makePod('ws-running', 'running-uid')
    const svc = makeService('svc-running', 'running-uid')

    mockListWorkspacePods.mockResolvedValueOnce([pod])
    mockListWorkspacePvcs.mockResolvedValueOnce([])
    mockListWorkspaceServices.mockResolvedValueOnce([svc])
    mockListConfigMaps.mockImplementation((selector: string) => {
      if (selector.includes('creating')) return Promise.resolve([])
      return Promise.resolve([])
    })
    mockGetWorkspaceUid.mockReturnValue('running-uid')

    await cleanupOrphans()

    expect(mockDeleteService).not.toHaveBeenCalled()
  })

  test('deletes stale creating ConfigMaps older than 1 hour', async () => {
    const staleCm = makeCreatingCm('creating-old-ws', 90) // 90 minutes ago
    const freshCm = makeCreatingCm('creating-new-ws', 10) // 10 minutes ago

    mockListWorkspacePods.mockResolvedValueOnce([])
    mockListWorkspacePvcs.mockResolvedValueOnce([])
    mockListWorkspaceServices.mockResolvedValueOnce([])
    mockListConfigMaps.mockImplementation((selector: string) => {
      if (selector.includes('creating'))
        return Promise.resolve([staleCm, freshCm])
      return Promise.resolve([])
    })

    await cleanupOrphans()

    // Only the stale one should be deleted
    expect(mockDeleteConfigMap).toHaveBeenCalledWith('creating-old-ws')
    expect(mockDeleteConfigMap).not.toHaveBeenCalledWith('creating-new-ws')
  })

  test('handles API errors gracefully', async () => {
    mockListWorkspacePods.mockRejectedValueOnce(new Error('API error'))

    // Should not throw
    await cleanupOrphans()

    expect(mockDeleteService).not.toHaveBeenCalled()
    expect(mockDeleteConfigMap).not.toHaveBeenCalled()
  })

  test('handles mixed resources correctly', async () => {
    // One running pod, one stopped workspace (saved spec), one orphan
    const runningPod = makePod('ws-running', 'running-uid')
    const runningPvc = makePvc('pvc-running', 'running-uid', 'running')
    const stoppedPvc = makePvc('pvc-stopped', 'stopped-uid', 'stopped')
    const orphanPvc = makePvc('pvc-orphan', 'orphan-uid', 'orphan')
    const runningSvc = makeService('svc-running', 'running-uid')
    const orphanSvc = makeService('svc-orphan', 'orphan-uid')
    const savedSpec = makeSavedSpecCm('stopped-uid', 'stopped')

    mockListWorkspacePods.mockResolvedValueOnce([runningPod])
    mockListWorkspacePvcs.mockResolvedValueOnce([
      runningPvc,
      stoppedPvc,
      orphanPvc,
    ])
    mockListWorkspaceServices.mockResolvedValueOnce([runningSvc, orphanSvc])
    mockListConfigMaps.mockImplementation((selector: string) => {
      if (selector.includes('saved-spec'))
        return Promise.resolve([savedSpec])
      if (selector.includes('creating')) return Promise.resolve([])
      return Promise.resolve([])
    })
    mockGetWorkspaceUid.mockReturnValue('running-uid')

    const warnSpy = mock(() => {})
    const originalWarn = console.warn
    console.warn = warnSpy

    await cleanupOrphans()

    console.warn = originalWarn

    // Orphan PVC should be logged
    const orphanWarning = warnSpy.mock.calls
      .map((c) => String(c[0]))
      .find((m) => m.includes('pvc-orphan'))
    expect(orphanWarning).toBeDefined()

    // Orphan service should be deleted
    expect(mockDeleteService).toHaveBeenCalledWith('svc-orphan')

    // Running service should NOT be deleted
    expect(mockDeleteService).not.toHaveBeenCalledWith('svc-running')

    // Only one service deletion total
    expect(mockDeleteService).toHaveBeenCalledTimes(1)
  })
})
