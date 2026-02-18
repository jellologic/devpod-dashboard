import { describe, test, expect, mock, beforeEach } from 'bun:test'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockListWorkspacePods = mock(() => Promise.resolve([]))
const mockIsPodReady = mock((_pod: unknown) => false)
const mockPatchPodAnnotations = mock(() => Promise.resolve({}))

mock.module('@workspacekit/k8s', () => ({
  listWorkspacePods: mockListWorkspacePods,
  isPodReady: mockIsPodReady,
  patchPodAnnotations: mockPatchPodAnnotations,
}))

const { checkCreatingPods } = await import('../src/creation')

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function minutesAgo(minutes: number): string {
  return new Date(Date.now() - minutes * 60 * 1000).toISOString()
}

function makePod(
  name: string,
  options: {
    creationTimestamp?: string
    ready?: boolean
    stuckAnnotation?: string
    containerWaitingReason?: string
    phase?: string
  } = {},
) {
  const annotations: Record<string, string> = {}
  if (options.stuckAnnotation) {
    annotations['wsk/creation-stuck'] = options.stuckAnnotation
  }

  const containerStatuses = options.containerWaitingReason
    ? [
        {
          state: {
            waiting: { reason: options.containerWaitingReason },
          },
        },
      ]
    : []

  return {
    metadata: {
      name,
      creationTimestamp: options.creationTimestamp ?? minutesAgo(1),
      labels: {
        'managed-by': 'workspacekit',
      },
      annotations:
        Object.keys(annotations).length > 0 ? annotations : undefined,
    },
    status: {
      phase: options.phase ?? 'Pending',
      containerStatuses,
    },
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('creation - checkCreatingPods', () => {
  beforeEach(() => {
    mockListWorkspacePods.mockReset()
    mockIsPodReady.mockReset()
    mockPatchPodAnnotations.mockReset()
  })

  test('detects pods stuck creating for more than 10 minutes', async () => {
    const stuckPod = makePod('ws-stuck', {
      creationTimestamp: minutesAgo(15), // 15 minutes ago
      containerWaitingReason: 'ImagePullBackOff',
    })

    mockListWorkspacePods.mockResolvedValueOnce([stuckPod])
    mockIsPodReady.mockReturnValue(false)

    await checkCreatingPods()

    expect(mockPatchPodAnnotations).toHaveBeenCalledTimes(1)
    expect(mockPatchPodAnnotations).toHaveBeenCalledWith(
      'ws-stuck',
      expect.objectContaining({
        'wsk/creation-stuck': expect.any(String),
        'wsk/creation-stuck-reason': expect.stringContaining(
          'ImagePullBackOff',
        ),
      }),
    )
  })

  test('does not flag pods that are not yet past the threshold', async () => {
    const newPod = makePod('ws-new', {
      creationTimestamp: minutesAgo(5), // Only 5 minutes, threshold is 10
    })

    mockListWorkspacePods.mockResolvedValueOnce([newPod])
    mockIsPodReady.mockReturnValue(false)

    await checkCreatingPods()

    expect(mockPatchPodAnnotations).not.toHaveBeenCalled()
  })

  test('skips pods that are already ready', async () => {
    const readyPod = makePod('ws-ready', {
      creationTimestamp: minutesAgo(15),
    })

    mockListWorkspacePods.mockResolvedValueOnce([readyPod])
    mockIsPodReady.mockReturnValue(true)

    await checkCreatingPods()

    expect(mockPatchPodAnnotations).not.toHaveBeenCalled()
  })

  test('skips pods already annotated as stuck', async () => {
    const alreadyStuckPod = makePod('ws-already-stuck', {
      creationTimestamp: minutesAgo(20),
      stuckAnnotation: minutesAgo(5),
    })

    mockListWorkspacePods.mockResolvedValueOnce([alreadyStuckPod])
    mockIsPodReady.mockReturnValue(false)

    await checkCreatingPods()

    expect(mockPatchPodAnnotations).not.toHaveBeenCalled()
  })

  test('detects CrashLoopBackOff as stuck reason', async () => {
    const crashPod = makePod('ws-crash', {
      creationTimestamp: minutesAgo(12),
      containerWaitingReason: 'CrashLoopBackOff',
    })

    mockListWorkspacePods.mockResolvedValueOnce([crashPod])
    mockIsPodReady.mockReturnValue(false)

    await checkCreatingPods()

    expect(mockPatchPodAnnotations).toHaveBeenCalledWith(
      'ws-crash',
      expect.objectContaining({
        'wsk/creation-stuck-reason':
          expect.stringContaining('CrashLoopBackOff'),
      }),
    )
  })

  test('falls back to phase when no container status reason exists', async () => {
    const pendingPod = makePod('ws-pending', {
      creationTimestamp: minutesAgo(15),
      phase: 'Pending',
    })

    mockListWorkspacePods.mockResolvedValueOnce([pendingPod])
    mockIsPodReady.mockReturnValue(false)

    await checkCreatingPods()

    expect(mockPatchPodAnnotations).toHaveBeenCalledWith(
      'ws-pending',
      expect.objectContaining({
        'wsk/creation-stuck-reason': 'Pending',
      }),
    )
  })

  test('handles empty pod list gracefully', async () => {
    mockListWorkspacePods.mockResolvedValueOnce([])

    await checkCreatingPods()

    expect(mockPatchPodAnnotations).not.toHaveBeenCalled()
  })

  test('handles listWorkspacePods error gracefully', async () => {
    mockListWorkspacePods.mockRejectedValueOnce(new Error('API error'))

    // Should not throw
    await checkCreatingPods()

    expect(mockPatchPodAnnotations).not.toHaveBeenCalled()
  })

  test('processes multiple pods, only flagging stuck ones', async () => {
    const stuckPod = makePod('ws-stuck', {
      creationTimestamp: minutesAgo(15),
      containerWaitingReason: 'ErrImagePull',
    })
    const newPod = makePod('ws-new', {
      creationTimestamp: minutesAgo(2),
    })
    const readyPod = makePod('ws-ready', {
      creationTimestamp: minutesAgo(20),
    })

    mockListWorkspacePods.mockResolvedValueOnce([stuckPod, newPod, readyPod])
    mockIsPodReady.mockImplementation((pod: unknown) => {
      const p = pod as { metadata?: { name?: string } }
      return p.metadata?.name === 'ws-ready'
    })

    await checkCreatingPods()

    expect(mockPatchPodAnnotations).toHaveBeenCalledTimes(1)
    expect(mockPatchPodAnnotations).toHaveBeenCalledWith(
      'ws-stuck',
      expect.objectContaining({
        'wsk/creation-stuck': expect.any(String),
      }),
    )
  })
})
