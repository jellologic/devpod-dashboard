import { describe, test, expect, mock, beforeEach } from 'bun:test'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockGetExpiryDays = mock(() => Promise.resolve(0))
const mockListWorkspacePods = mock(() => Promise.resolve([]))
const mockDeletePod = mock(() => Promise.resolve())
const mockPatchPodAnnotations = mock(() => Promise.resolve({}))
const mockDeletePvc = mock(() => Promise.resolve())
const mockDeleteService = mock(() => Promise.resolve())
const mockDeleteConfigMap = mock(() => Promise.resolve())
const mockGetWorkspaceName = mock((_pod: unknown) => '')
const mockGetWorkspaceUid = mock((_pod: unknown) => '')

mock.module('@workspacekit/k8s', () => ({
  getExpiryDays: mockGetExpiryDays,
  listWorkspacePods: mockListWorkspacePods,
  deletePod: mockDeletePod,
  patchPodAnnotations: mockPatchPodAnnotations,
  deletePvc: mockDeletePvc,
  deleteService: mockDeleteService,
  deleteConfigMap: mockDeleteConfigMap,
  getWorkspaceName: mockGetWorkspaceName,
  getWorkspaceUid: mockGetWorkspaceUid,
}))

const { checkExpiry } = await import('../src/expiry')

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const MS_PER_DAY = 86_400_000

function daysAgo(days: number): string {
  return new Date(Date.now() - days * MS_PER_DAY).toISOString()
}

function makePod(
  name: string,
  uid: string,
  workspaceName: string,
  options: {
    lastAccessed?: string
    creationTimestamp?: string
    expiryWarning?: string
  } = {},
) {
  const annotations: Record<string, string> = {}
  if (options.lastAccessed) {
    annotations['wsk/last-accessed'] = options.lastAccessed
  }
  if (options.expiryWarning) {
    annotations['wsk/expiry-warning'] = options.expiryWarning
  }

  return {
    metadata: {
      name,
      creationTimestamp: options.creationTimestamp ?? daysAgo(0),
      labels: {
        'managed-by': 'workspacekit',
        'workspace-name': workspaceName,
        'workspace-uid': uid,
      },
      annotations:
        Object.keys(annotations).length > 0 ? annotations : undefined,
    },
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('expiry - checkExpiry', () => {
  beforeEach(() => {
    mockGetExpiryDays.mockReset()
    mockListWorkspacePods.mockReset()
    mockDeletePod.mockReset()
    mockPatchPodAnnotations.mockReset()
    mockDeletePvc.mockReset()
    mockDeleteService.mockReset()
    mockDeleteConfigMap.mockReset()
    mockGetWorkspaceName.mockReset()
    mockGetWorkspaceUid.mockReset()
  })

  test('does nothing when expiry_days is 0 (disabled)', async () => {
    mockGetExpiryDays.mockResolvedValueOnce(0)

    await checkExpiry()

    expect(mockListWorkspacePods).not.toHaveBeenCalled()
    expect(mockDeletePod).not.toHaveBeenCalled()
  })

  test('deletes expired workspace when idle time exceeds expiry_days', async () => {
    mockGetExpiryDays.mockResolvedValueOnce(7)

    const pod = makePod('ws-expired', 'expired-uid', 'old-workspace', {
      lastAccessed: daysAgo(10), // 10 days ago, expiry is 7
    })

    mockListWorkspacePods.mockResolvedValueOnce([pod])
    mockGetWorkspaceName.mockReturnValue('old-workspace')
    mockGetWorkspaceUid.mockReturnValue('expired-uid')

    await checkExpiry()

    expect(mockDeletePod).toHaveBeenCalledWith('ws-expired')
    expect(mockDeletePvc).toHaveBeenCalledWith('pvc-expired-uid')
    expect(mockDeleteService).toHaveBeenCalledWith('svc-expired-uid')
    expect(mockDeleteConfigMap).toHaveBeenCalledWith('meta-old-workspace')
    expect(mockDeleteConfigMap).toHaveBeenCalledWith('saved-expired-uid')
  })

  test('adds warning annotation when workspace approaches expiry', async () => {
    mockGetExpiryDays.mockResolvedValueOnce(7)

    // Idle for 6.5 days (within the last-day warning window: > 6 but < 7)
    const pod = makePod('ws-warning', 'warning-uid', 'warn-workspace', {
      lastAccessed: daysAgo(6.5),
    })

    mockListWorkspacePods.mockResolvedValueOnce([pod])
    mockGetWorkspaceName.mockReturnValue('warn-workspace')
    mockGetWorkspaceUid.mockReturnValue('warning-uid')

    await checkExpiry()

    expect(mockDeletePod).not.toHaveBeenCalled()
    expect(mockPatchPodAnnotations).toHaveBeenCalledTimes(1)
    expect(mockPatchPodAnnotations).toHaveBeenCalledWith(
      'ws-warning',
      expect.objectContaining({
        'wsk/expiry-warning': expect.any(String),
      }),
    )
  })

  test('does not add duplicate warning annotation', async () => {
    mockGetExpiryDays.mockResolvedValueOnce(7)

    // Idle for 6.5 days, but already has warning
    const pod = makePod('ws-warned', 'warned-uid', 'warned-workspace', {
      lastAccessed: daysAgo(6.5),
      expiryWarning: daysAgo(0.5), // Already warned
    })

    mockListWorkspacePods.mockResolvedValueOnce([pod])
    mockGetWorkspaceName.mockReturnValue('warned-workspace')
    mockGetWorkspaceUid.mockReturnValue('warned-uid')

    await checkExpiry()

    expect(mockDeletePod).not.toHaveBeenCalled()
    expect(mockPatchPodAnnotations).not.toHaveBeenCalled()
  })

  test('does not touch workspaces that are not expired', async () => {
    mockGetExpiryDays.mockResolvedValueOnce(14)

    const pod = makePod('ws-active', 'active-uid', 'active-workspace', {
      lastAccessed: daysAgo(3), // Only 3 days idle, expiry is 14
    })

    mockListWorkspacePods.mockResolvedValueOnce([pod])
    mockGetWorkspaceName.mockReturnValue('active-workspace')
    mockGetWorkspaceUid.mockReturnValue('active-uid')

    await checkExpiry()

    expect(mockDeletePod).not.toHaveBeenCalled()
    expect(mockPatchPodAnnotations).not.toHaveBeenCalled()
  })

  test('falls back to creation timestamp when last-accessed annotation is missing', async () => {
    mockGetExpiryDays.mockResolvedValueOnce(5)

    // No last-accessed annotation, creation was 8 days ago
    const pod = makePod('ws-no-access', 'no-access-uid', 'no-access-ws', {
      creationTimestamp: daysAgo(8),
    })

    mockListWorkspacePods.mockResolvedValueOnce([pod])
    mockGetWorkspaceName.mockReturnValue('no-access-ws')
    mockGetWorkspaceUid.mockReturnValue('no-access-uid')

    await checkExpiry()

    expect(mockDeletePod).toHaveBeenCalledWith('ws-no-access')
  })

  test('handles getExpiryDays error gracefully', async () => {
    mockGetExpiryDays.mockRejectedValueOnce(new Error('ConfigMap error'))

    // Should not throw
    await checkExpiry()

    expect(mockListWorkspacePods).not.toHaveBeenCalled()
  })

  test('handles listWorkspacePods error gracefully', async () => {
    mockGetExpiryDays.mockResolvedValueOnce(7)
    mockListWorkspacePods.mockRejectedValueOnce(new Error('API error'))

    // Should not throw
    await checkExpiry()

    expect(mockDeletePod).not.toHaveBeenCalled()
  })

  test('handles multiple pods with mixed expiry states', async () => {
    mockGetExpiryDays.mockResolvedValueOnce(7)

    const expiredPod = makePod('ws-old', 'old-uid', 'old-ws', {
      lastAccessed: daysAgo(10),
    })
    const warningPod = makePod('ws-warn', 'warn-uid', 'warn-ws', {
      lastAccessed: daysAgo(6.5),
    })
    const activePod = makePod('ws-new', 'new-uid', 'new-ws', {
      lastAccessed: daysAgo(1),
    })

    mockListWorkspacePods.mockResolvedValueOnce([
      expiredPod,
      warningPod,
      activePod,
    ])

    mockGetWorkspaceName.mockImplementation((pod: unknown) => {
      const p = pod as { metadata?: { labels?: Record<string, string> } }
      return p.metadata?.labels?.['workspace-name'] ?? ''
    })
    mockGetWorkspaceUid.mockImplementation((pod: unknown) => {
      const p = pod as { metadata?: { labels?: Record<string, string> } }
      return p.metadata?.labels?.['workspace-uid'] ?? ''
    })

    await checkExpiry()

    // Expired pod should be deleted
    expect(mockDeletePod).toHaveBeenCalledWith('ws-old')
    expect(mockDeletePod).toHaveBeenCalledTimes(1)

    // Warning pod should get annotation
    expect(mockPatchPodAnnotations).toHaveBeenCalledWith(
      'ws-warn',
      expect.objectContaining({
        'wsk/expiry-warning': expect.any(String),
      }),
    )
    expect(mockPatchPodAnnotations).toHaveBeenCalledTimes(1)
  })
})
