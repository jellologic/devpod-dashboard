import { describe, test, expect, mock, beforeEach, afterEach } from 'bun:test'
import type { Schedule } from '@workspacekit/types'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockGetSchedules = mock(() => Promise.resolve([] as Schedule[]))
const mockGetPod = mock(() => Promise.resolve(null))
const mockDeletePod = mock(() => Promise.resolve())
const mockCreatePod = mock(() => Promise.resolve({}))
const mockSavePodSpec = mock(() => Promise.resolve())
const mockGetSavedPodSpec = mock(() => Promise.resolve(null))
const mockGetWorkspaceMeta = mock(() => Promise.resolve(null))
const mockListWorkspacePods = mock(() => Promise.resolve([]))
const mockGetWorkspaceName = mock((pod: unknown) => '')
const mockGetWorkspaceUid = mock((pod: unknown) => '')

mock.module('@workspacekit/k8s', () => ({
  getSchedules: mockGetSchedules,
  getPod: mockGetPod,
  deletePod: mockDeletePod,
  createPod: mockCreatePod,
  savePodSpec: mockSavePodSpec,
  getSavedPodSpec: mockGetSavedPodSpec,
  getWorkspaceMeta: mockGetWorkspaceMeta,
  listWorkspacePods: mockListWorkspacePods,
  getWorkspaceName: mockGetWorkspaceName,
  getWorkspaceUid: mockGetWorkspaceUid,
}))

const { checkSchedules, _resetDedupMap } = await import('../src/scheduler')

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Creates a UTC date at the given day/hour/minute.
 * dayOfWeek: 0=Sun, 1=Mon, ..., 6=Sat
 */
function makeDateForUTC(dayOfWeek: number, hour: number, minute: number): Date {
  // Start from a known Sunday: Jan 5, 2025 is a Sunday
  const baseSunday = new Date(Date.UTC(2025, 0, 5, hour, minute, 0, 0))
  baseSunday.setUTCDate(baseSunday.getUTCDate() + dayOfWeek)
  return baseSunday
}

function dayName(dayOfWeek: number): string {
  const names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  return names[dayOfWeek]
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('scheduler - checkSchedules', () => {
  let realDate: typeof Date

  beforeEach(() => {
    realDate = globalThis.Date
    mockGetSchedules.mockReset()
    mockGetPod.mockReset()
    mockDeletePod.mockReset()
    mockCreatePod.mockReset()
    mockSavePodSpec.mockReset()
    mockGetSavedPodSpec.mockReset()
    mockGetWorkspaceMeta.mockReset()
    mockListWorkspacePods.mockReset()
    mockGetWorkspaceName.mockReset()
    mockGetWorkspaceUid.mockReset()
    _resetDedupMap()
  })

  afterEach(() => {
    globalThis.Date = realDate
  })

  function freezeTime(date: Date): void {
    const OriginalDate = realDate
    const frozenTime = date.getTime()
    globalThis.Date = class extends OriginalDate {
      constructor(...args: unknown[]) {
        if (args.length === 0) {
          super(frozenTime)
        } else {
          // @ts-expect-error - spread of unknown[] into Date constructor
          super(...args)
        }
      }
      static now(): number {
        return frozenTime
      }
    } as typeof Date
  }

  test('fires stop action when schedule matches current time', async () => {
    const targetDay = 1 // Monday
    const targetHour = 18
    const targetMinute = 30
    const fakeNow = makeDateForUTC(targetDay, targetHour, targetMinute)
    freezeTime(fakeNow)

    const schedule: Schedule = {
      workspace: 'my-workspace',
      pod_name: 'ws-abc123',
      action: 'stop',
      days: [dayName(targetDay)],
      hour: targetHour,
      minute: targetMinute,
    }

    mockGetSchedules.mockResolvedValueOnce([schedule])
    mockGetPod.mockResolvedValueOnce({
      metadata: {
        name: 'ws-abc123',
        labels: {
          'workspace-uid': 'abc123',
          'workspace-name': 'my-workspace',
        },
      },
    })
    mockGetWorkspaceUid.mockReturnValueOnce('abc123')
    mockGetWorkspaceName.mockReturnValueOnce('my-workspace')
    mockDeletePod.mockResolvedValueOnce(undefined)
    mockSavePodSpec.mockResolvedValueOnce(undefined)

    await checkSchedules()

    expect(mockGetPod).toHaveBeenCalledWith('ws-abc123')
    expect(mockSavePodSpec).toHaveBeenCalledTimes(1)
    expect(mockDeletePod).toHaveBeenCalledWith('ws-abc123')
  })

  test('fires start action when schedule matches and saved spec exists', async () => {
    const targetDay = 2 // Tuesday
    const targetHour = 8
    const targetMinute = 0
    const fakeNow = makeDateForUTC(targetDay, targetHour, targetMinute)
    freezeTime(fakeNow)

    const schedule: Schedule = {
      workspace: 'dev-env',
      pod_name: 'ws-def456',
      action: 'start',
      days: [dayName(targetDay)],
      hour: targetHour,
      minute: targetMinute,
    }

    mockGetSchedules.mockResolvedValueOnce([schedule])
    mockGetPod.mockResolvedValueOnce(null) // Pod doesn't exist yet
    mockGetSavedPodSpec.mockResolvedValueOnce({
      metadata: {
        name: 'ws-def456',
        resourceVersion: '12345',
        uid: 'old-uid',
        creationTimestamp: '2025-01-01T00:00:00Z',
      },
      spec: { containers: [{ name: 'dev', image: 'ubuntu:latest' }] },
    })
    mockCreatePod.mockResolvedValueOnce({})

    await checkSchedules()

    expect(mockGetPod).toHaveBeenCalledWith('ws-def456')
    expect(mockGetSavedPodSpec).toHaveBeenCalledWith('def456')
    expect(mockCreatePod).toHaveBeenCalledTimes(1)

    // Verify resourceVersion and uid are stripped from the recreated spec
    const createdSpec = mockCreatePod.mock.calls[0][0] as Record<string, unknown>
    const metadata = createdSpec.metadata as Record<string, unknown>
    expect(metadata.resourceVersion).toBeUndefined()
    expect(metadata.uid).toBeUndefined()
    expect(metadata.creationTimestamp).toBeUndefined()
  })

  test('does not fire when schedule day does not match', async () => {
    const targetDay = 3 // Wednesday
    const targetHour = 10
    const targetMinute = 0
    const fakeNow = makeDateForUTC(targetDay, targetHour, targetMinute)
    freezeTime(fakeNow)

    const schedule: Schedule = {
      workspace: 'my-ws',
      pod_name: 'ws-xyz',
      action: 'stop',
      days: ['Mon', 'Fri'], // Not Wednesday
      hour: targetHour,
      minute: targetMinute,
    }

    mockGetSchedules.mockResolvedValueOnce([schedule])

    await checkSchedules()

    expect(mockGetPod).not.toHaveBeenCalled()
    expect(mockDeletePod).not.toHaveBeenCalled()
  })

  test('does not fire when schedule hour does not match', async () => {
    const targetDay = 1 // Monday
    const fakeNow = makeDateForUTC(targetDay, 14, 30)
    freezeTime(fakeNow)

    const schedule: Schedule = {
      workspace: 'my-ws',
      pod_name: 'ws-xyz',
      action: 'stop',
      days: ['Mon'],
      hour: 18, // Different hour
      minute: 30,
    }

    mockGetSchedules.mockResolvedValueOnce([schedule])

    await checkSchedules()

    expect(mockGetPod).not.toHaveBeenCalled()
    expect(mockDeletePod).not.toHaveBeenCalled()
  })

  test('does not fire when schedule minute does not match', async () => {
    const targetDay = 1 // Monday
    const fakeNow = makeDateForUTC(targetDay, 18, 15)
    freezeTime(fakeNow)

    const schedule: Schedule = {
      workspace: 'my-ws',
      pod_name: 'ws-xyz',
      action: 'stop',
      days: ['Mon'],
      hour: 18,
      minute: 30, // Different minute
    }

    mockGetSchedules.mockResolvedValueOnce([schedule])

    await checkSchedules()

    expect(mockGetPod).not.toHaveBeenCalled()
    expect(mockDeletePod).not.toHaveBeenCalled()
  })

  test('deduplication prevents same schedule from firing twice in the same minute', async () => {
    const targetDay = 4 // Thursday
    const targetHour = 9
    const targetMinute = 0
    const fakeNow = makeDateForUTC(targetDay, targetHour, targetMinute)
    freezeTime(fakeNow)

    const schedule: Schedule = {
      workspace: 'dedup-test',
      pod_name: 'ws-dedup',
      action: 'stop',
      days: [dayName(targetDay)],
      hour: targetHour,
      minute: targetMinute,
    }

    const fakePod = {
      metadata: {
        name: 'ws-dedup',
        labels: { 'workspace-uid': 'dedup', 'workspace-name': 'dedup-test' },
      },
    }

    mockGetSchedules.mockResolvedValue([schedule])
    mockGetPod.mockResolvedValue(fakePod)
    mockGetWorkspaceUid.mockReturnValue('dedup')
    mockGetWorkspaceName.mockReturnValue('dedup-test')
    mockDeletePod.mockResolvedValue(undefined)
    mockSavePodSpec.mockResolvedValue(undefined)

    // First call should fire
    await checkSchedules()
    expect(mockDeletePod).toHaveBeenCalledTimes(1)

    // Second call at same time should be deduplicated
    await checkSchedules()
    expect(mockDeletePod).toHaveBeenCalledTimes(1)
  })

  test('does nothing when no schedules exist', async () => {
    const fakeNow = makeDateForUTC(1, 10, 0)
    freezeTime(fakeNow)

    mockGetSchedules.mockResolvedValueOnce([])

    await checkSchedules()

    expect(mockGetPod).not.toHaveBeenCalled()
    expect(mockDeletePod).not.toHaveBeenCalled()
    expect(mockCreatePod).not.toHaveBeenCalled()
  })

  test('skips start action when pod already exists', async () => {
    const targetDay = 5 // Friday
    const targetHour = 8
    const targetMinute = 0
    const fakeNow = makeDateForUTC(targetDay, targetHour, targetMinute)
    freezeTime(fakeNow)

    const schedule: Schedule = {
      workspace: 'running-ws',
      pod_name: 'ws-running',
      action: 'start',
      days: [dayName(targetDay)],
      hour: targetHour,
      minute: targetMinute,
    }

    mockGetSchedules.mockResolvedValueOnce([schedule])
    mockGetPod.mockResolvedValueOnce({
      metadata: { name: 'ws-running' },
    }) // Pod already exists

    await checkSchedules()

    expect(mockCreatePod).not.toHaveBeenCalled()
    expect(mockGetSavedPodSpec).not.toHaveBeenCalled()
  })

  test('day-of-week matching works for multiple days', async () => {
    // Wednesday
    const fakeNow = makeDateForUTC(3, 12, 0)
    freezeTime(fakeNow)

    const schedule: Schedule = {
      workspace: 'multi-day',
      pod_name: 'ws-multi',
      action: 'stop',
      days: ['Mon', 'Wed', 'Fri'], // Includes Wednesday
      hour: 12,
      minute: 0,
    }

    mockGetSchedules.mockResolvedValueOnce([schedule])
    mockGetPod.mockResolvedValueOnce({
      metadata: {
        name: 'ws-multi',
        labels: { 'workspace-uid': 'multi', 'workspace-name': 'multi-day' },
      },
    })
    mockGetWorkspaceUid.mockReturnValueOnce('multi')
    mockGetWorkspaceName.mockReturnValueOnce('multi-day')
    mockDeletePod.mockResolvedValueOnce(undefined)
    mockSavePodSpec.mockResolvedValueOnce(undefined)

    await checkSchedules()

    expect(mockDeletePod).toHaveBeenCalledWith('ws-multi')
  })

  test('handles getSchedules error gracefully', async () => {
    const fakeNow = makeDateForUTC(1, 10, 0)
    freezeTime(fakeNow)

    mockGetSchedules.mockRejectedValueOnce(new Error('API error'))

    // Should not throw
    await checkSchedules()

    expect(mockGetPod).not.toHaveBeenCalled()
  })
})
