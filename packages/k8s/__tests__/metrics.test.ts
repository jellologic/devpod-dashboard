import { describe, test, expect, mock, beforeEach } from 'bun:test'

// ---------------------------------------------------------------------------
// Mock functions
// ---------------------------------------------------------------------------

const mockGetPodMetrics = mock(() =>
  Promise.resolve({
    items: [
      {
        metadata: { name: 'ws-abc123' },
        containers: [
          { name: 'dev', usage: { cpu: '250m', memory: '512Mi' } },
        ],
      },
      {
        metadata: { name: 'ws-def456' },
        containers: [
          { name: 'dev', usage: { cpu: '1500m', memory: '2048Mi' } },
        ],
      },
    ],
  }),
)

// ---------------------------------------------------------------------------
// Mock the client module
// ---------------------------------------------------------------------------

mock.module('../src/client', () => ({
  metricsClient: {
    getPodMetrics: mockGetPodMetrics,
  },
  namespace: 'workspacekit',
}))

const { getPodMetrics, parseCpuValue, parseMemValue } = await import('../src/metrics')

// ---------------------------------------------------------------------------
// Tests - getPodMetrics
// ---------------------------------------------------------------------------

describe('getPodMetrics', () => {
  beforeEach(() => {
    mockGetPodMetrics.mockClear()
  })

  test('returns metrics map for all pods', async () => {
    const metrics = await getPodMetrics()
    expect(metrics.size).toBe(2)

    const pod1 = metrics.get('ws-abc123')
    expect(pod1).toBeDefined()
    expect(pod1!.cpu).toBe('250m')
    expect(pod1!.memory).toBe('512Mi')

    const pod2 = metrics.get('ws-def456')
    expect(pod2).toBeDefined()
    expect(pod2!.cpu).toBe('1500m')
    expect(pod2!.memory).toBe('2048Mi')
  })

  test('returns empty map when metrics API fails', async () => {
    mockGetPodMetrics.mockRejectedValueOnce(new Error('metrics unavailable'))
    const metrics = await getPodMetrics()
    expect(metrics.size).toBe(0)
  })

  test('returns empty map when no pods', async () => {
    mockGetPodMetrics.mockResolvedValueOnce({ items: [] })
    const metrics = await getPodMetrics()
    expect(metrics.size).toBe(0)
  })

  test('aggregates container metrics', async () => {
    mockGetPodMetrics.mockResolvedValueOnce({
      items: [
        {
          metadata: { name: 'multi-container' },
          containers: [
            { name: 'dev', usage: { cpu: '100m', memory: '256Mi' } },
            { name: 'sidecar', usage: { cpu: '50m', memory: '128Mi' } },
          ],
        },
      ],
    })

    const metrics = await getPodMetrics()
    const pod = metrics.get('multi-container')
    expect(pod).toBeDefined()
    expect(pod!.cpu).toBe('150m')
    expect(pod!.memory).toBe('384Mi')
  })
})

// ---------------------------------------------------------------------------
// Tests - parseCpuValue
// ---------------------------------------------------------------------------

describe('parseCpuValue', () => {
  test('parses millicores', () => {
    expect(parseCpuValue('250m')).toBe(250)
    expect(parseCpuValue('1000m')).toBe(1000)
    expect(parseCpuValue('0m')).toBe(0)
  })

  test('parses whole cores', () => {
    expect(parseCpuValue('2')).toBe(2000)
    expect(parseCpuValue('1')).toBe(1000)
  })

  test('parses fractional cores', () => {
    expect(parseCpuValue('0.5')).toBe(500)
    expect(parseCpuValue('1.5')).toBe(1500)
  })

  test('parses nanocores', () => {
    expect(parseCpuValue('250000000n')).toBe(250)
    expect(parseCpuValue('1000000000n')).toBe(1000)
  })

  test('parses microcores', () => {
    expect(parseCpuValue('250000u')).toBe(250)
    expect(parseCpuValue('1000000u')).toBe(1000)
  })

  test('returns 0 for empty string', () => {
    expect(parseCpuValue('')).toBe(0)
  })

  test('returns 0 for invalid input', () => {
    expect(parseCpuValue('invalid')).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// Tests - parseMemValue
// ---------------------------------------------------------------------------

describe('parseMemValue', () => {
  test('parses Mi values', () => {
    expect(parseMemValue('512Mi')).toBe(512 * 1024 * 1024)
    expect(parseMemValue('1024Mi')).toBe(1024 * 1024 * 1024)
  })

  test('parses Gi values', () => {
    expect(parseMemValue('1Gi')).toBe(1024 * 1024 * 1024)
    expect(parseMemValue('2Gi')).toBe(2 * 1024 * 1024 * 1024)
  })

  test('parses Ki values', () => {
    expect(parseMemValue('1024Ki')).toBe(1024 * 1024)
  })

  test('parses plain bytes', () => {
    expect(parseMemValue('128974848')).toBe(128974848)
  })

  test('parses SI units', () => {
    expect(parseMemValue('1G')).toBe(1000000000)
    expect(parseMemValue('500M')).toBe(500000000)
  })

  test('returns 0 for empty string', () => {
    expect(parseMemValue('')).toBe(0)
  })

  test('returns 0 for invalid input', () => {
    expect(parseMemValue('invalid')).toBe(0)
  })
})
