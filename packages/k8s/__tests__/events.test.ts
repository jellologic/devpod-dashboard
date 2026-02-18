import { describe, test, expect, mock, beforeEach } from 'bun:test'

// ---------------------------------------------------------------------------
// Mock functions
// ---------------------------------------------------------------------------

const mockListNamespacedEvent = mock(() =>
  Promise.resolve({
    items: [
      {
        type: 'Normal',
        reason: 'Scheduled',
        message: 'Successfully assigned workspacekit/ws-abc123 to node1',
        lastTimestamp: new Date(Date.now() - 30_000), // 30 seconds ago
        metadata: { creationTimestamp: new Date(Date.now() - 60_000) },
      },
      {
        type: 'Normal',
        reason: 'Pulling',
        message: 'Pulling image "node:20"',
        lastTimestamp: new Date(Date.now() - 20_000), // 20 seconds ago
        metadata: {},
      },
      {
        type: 'Warning',
        reason: 'BackOff',
        message: 'Back-off restarting failed container',
        lastTimestamp: null,
        eventTime: new Date(Date.now() - 120_000), // 2 minutes ago
        metadata: {},
      },
    ],
  }),
)

// ---------------------------------------------------------------------------
// Mock the client module
// ---------------------------------------------------------------------------

mock.module('../src/client', () => ({
  coreV1: {
    listNamespacedEvent: mockListNamespacedEvent,
  },
  namespace: 'workspacekit',
}))

const { getPodEvents } = await import('../src/events')

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('getPodEvents', () => {
  beforeEach(() => {
    mockListNamespacedEvent.mockClear()
  })

  test('returns events for a pod', async () => {
    const events = await getPodEvents('ws-abc123')
    expect(events).toHaveLength(3)
    expect(mockListNamespacedEvent).toHaveBeenCalledWith({
      namespace: 'workspacekit',
      fieldSelector: 'involvedObject.name=ws-abc123',
    })
  })

  test('maps event fields correctly', async () => {
    const events = await getPodEvents('ws-abc123')

    expect(events[0].type).toBe('Normal')
    expect(events[0].reason).toBe('Scheduled')
    expect(events[0].message).toContain('Successfully assigned')
    expect(events[0].age).toMatch(/^\d+s$/)

    expect(events[1].type).toBe('Normal')
    expect(events[1].reason).toBe('Pulling')

    expect(events[2].type).toBe('Warning')
    expect(events[2].reason).toBe('BackOff')
    // Should use eventTime as fallback when lastTimestamp is null
    expect(events[2].age).toMatch(/^\d+[smhd]$/)
  })

  test('returns empty array on error', async () => {
    mockListNamespacedEvent.mockRejectedValueOnce(new Error('API error'))
    const events = await getPodEvents('ws-abc123')
    expect(events).toEqual([])
  })

  test('returns empty array when no events', async () => {
    mockListNamespacedEvent.mockResolvedValueOnce({ items: [] })
    const events = await getPodEvents('ws-abc123')
    expect(events).toEqual([])
  })

  test('handles events with missing fields', async () => {
    mockListNamespacedEvent.mockResolvedValueOnce({
      items: [
        {
          metadata: {},
          // All other fields missing
        },
      ],
    })

    const events = await getPodEvents('ws-abc123')
    expect(events).toHaveLength(1)
    expect(events[0].type).toBe('Normal')
    expect(events[0].reason).toBe('')
    expect(events[0].message).toBe('')
    expect(events[0].age).toBe('')
  })

  test('formats age for hours-old events', async () => {
    mockListNamespacedEvent.mockResolvedValueOnce({
      items: [
        {
          type: 'Normal',
          reason: 'Started',
          message: 'Started container',
          lastTimestamp: new Date(Date.now() - 3_600_000 * 5), // 5 hours ago
          metadata: {},
        },
      ],
    })

    const events = await getPodEvents('ws-abc123')
    expect(events[0].age).toBe('5h')
  })

  test('formats age for days-old events', async () => {
    mockListNamespacedEvent.mockResolvedValueOnce({
      items: [
        {
          type: 'Normal',
          reason: 'Created',
          message: 'Created container',
          lastTimestamp: new Date(Date.now() - 86_400_000 * 3), // 3 days ago
          metadata: {},
        },
      ],
    })

    const events = await getPodEvents('ws-abc123')
    expect(events[0].age).toBe('3d')
  })
})
