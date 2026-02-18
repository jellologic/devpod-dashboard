import { describe, test, expect, mock, beforeEach } from 'bun:test'

// ---------------------------------------------------------------------------
// Mock functions
// ---------------------------------------------------------------------------

const mockReadNamespacedLimitRange = mock(() =>
  Promise.resolve({
    metadata: { name: 'workspacekit-limits' },
    spec: {
      limits: [
        {
          type: 'Container',
          max: { cpu: '4', memory: '8Gi' },
          default: { cpu: '4', memory: '8Gi' },
          defaultRequest: { cpu: '500m', memory: '1Gi' },
        },
      ],
    },
  }),
)

const mockCreateNamespacedLimitRange = mock(() => Promise.resolve({}))
const mockReplaceNamespacedLimitRange = mock(() => Promise.resolve({}))

const mockReadNamespacedResourceQuota = mock(() =>
  Promise.resolve({
    metadata: { name: 'workspacekit-quota' },
    spec: {
      hard: {
        'requests.cpu': '16',
        'requests.memory': '32Gi',
        pods: '20',
      },
    },
    status: {
      used: {
        'requests.cpu': '4',
        'requests.memory': '8Gi',
        pods: '3',
      },
    },
  }),
)

const mockCreateNamespacedResourceQuota = mock(() => Promise.resolve({}))
const mockReplaceNamespacedResourceQuota = mock(() => Promise.resolve({}))

// ---------------------------------------------------------------------------
// Mock the client module
// ---------------------------------------------------------------------------

mock.module('../src/client', () => ({
  coreV1: {
    readNamespacedLimitRange: mockReadNamespacedLimitRange,
    createNamespacedLimitRange: mockCreateNamespacedLimitRange,
    replaceNamespacedLimitRange: mockReplaceNamespacedLimitRange,
    readNamespacedResourceQuota: mockReadNamespacedResourceQuota,
    createNamespacedResourceQuota: mockCreateNamespacedResourceQuota,
    replaceNamespacedResourceQuota: mockReplaceNamespacedResourceQuota,
  },
  namespace: 'workspacekit',
}))

const {
  getLimitRange,
  saveLimitRange,
  getResourceQuota,
  saveResourceQuota,
} = await import('../src/resources')

// ---------------------------------------------------------------------------
// Tests - LimitRange
// ---------------------------------------------------------------------------

describe('getLimitRange', () => {
  beforeEach(() => {
    mockReadNamespacedLimitRange.mockClear()
  })

  test('returns parsed limit range', async () => {
    const lr = await getLimitRange()
    expect(lr).not.toBeNull()
    expect(lr!.max_cpu).toBe('4')
    expect(lr!.max_mem).toBe('8Gi')
    expect(lr!.def_cpu).toBe('4')
    expect(lr!.def_mem).toBe('8Gi')
    expect(lr!.def_req_cpu).toBe('500m')
    expect(lr!.def_req_mem).toBe('1Gi')
  })

  test('returns null on 404', async () => {
    mockReadNamespacedLimitRange.mockRejectedValueOnce({ code: 404 })
    const lr = await getLimitRange()
    expect(lr).toBeNull()
  })

  test('returns null when no Container limit type', async () => {
    mockReadNamespacedLimitRange.mockResolvedValueOnce({
      metadata: { name: 'workspacekit-limits' },
      spec: { limits: [{ type: 'Pod' }] },
    })
    const lr = await getLimitRange()
    expect(lr).toBeNull()
  })

  test('throws on non-404 errors', async () => {
    mockReadNamespacedLimitRange.mockRejectedValueOnce({ code: 500 })
    await expect(getLimitRange()).rejects.toEqual({ code: 500 })
  })
})

describe('saveLimitRange', () => {
  beforeEach(() => {
    mockCreateNamespacedLimitRange.mockClear()
    mockReplaceNamespacedLimitRange.mockClear()
  })

  test('creates a new limit range', async () => {
    await saveLimitRange('4', '8Gi', '500m', '1Gi')
    expect(mockCreateNamespacedLimitRange).toHaveBeenCalledTimes(1)
    expect(mockReplaceNamespacedLimitRange).not.toHaveBeenCalled()

    const callArg = mockCreateNamespacedLimitRange.mock.calls[0][0] as {
      body: { spec: { limits: Array<{ type: string; max: Record<string, string>; defaultRequest: Record<string, string> }> } }
    }
    const limit = callArg.body.spec.limits[0]
    expect(limit.type).toBe('Container')
    expect(limit.max.cpu).toBe('4')
    expect(limit.max.memory).toBe('8Gi')
    expect(limit.defaultRequest.cpu).toBe('500m')
    expect(limit.defaultRequest.memory).toBe('1Gi')
  })

  test('replaces on 409 conflict', async () => {
    mockCreateNamespacedLimitRange.mockRejectedValueOnce({ code: 409 })
    await saveLimitRange('4', '8Gi', '500m', '1Gi')
    expect(mockCreateNamespacedLimitRange).toHaveBeenCalledTimes(1)
    expect(mockReplaceNamespacedLimitRange).toHaveBeenCalledTimes(1)
  })

  test('throws on non-409 errors', async () => {
    mockCreateNamespacedLimitRange.mockRejectedValueOnce({ code: 403 })
    await expect(saveLimitRange('4', '8Gi', '500m', '1Gi')).rejects.toEqual({ code: 403 })
  })

  test('uses custom namespace', async () => {
    await saveLimitRange('4', '8Gi', '500m', '1Gi', 'custom-ns')
    const callArg = mockCreateNamespacedLimitRange.mock.calls[0][0] as {
      namespace: string
      body: { metadata: { namespace: string } }
    }
    expect(callArg.namespace).toBe('custom-ns')
    expect(callArg.body.metadata.namespace).toBe('custom-ns')
  })
})

// ---------------------------------------------------------------------------
// Tests - ResourceQuota
// ---------------------------------------------------------------------------

describe('getResourceQuota', () => {
  beforeEach(() => {
    mockReadNamespacedResourceQuota.mockClear()
  })

  test('returns parsed quota with usage', async () => {
    const q = await getResourceQuota()
    expect(q).not.toBeNull()
    expect(q!.req_cpu).toBe('16')
    expect(q!.req_mem).toBe('32Gi')
    expect(q!.pods).toBe('20')
    expect(q!.used_req_cpu).toBe('4')
    expect(q!.used_req_mem).toBe('8Gi')
    expect(q!.used_pods).toBe('3')
  })

  test('returns null on 404', async () => {
    mockReadNamespacedResourceQuota.mockRejectedValueOnce({ code: 404 })
    const q = await getResourceQuota()
    expect(q).toBeNull()
  })

  test('throws on non-404 errors', async () => {
    mockReadNamespacedResourceQuota.mockRejectedValueOnce({ code: 500 })
    await expect(getResourceQuota()).rejects.toEqual({ code: 500 })
  })
})

describe('saveResourceQuota', () => {
  beforeEach(() => {
    mockCreateNamespacedResourceQuota.mockClear()
    mockReplaceNamespacedResourceQuota.mockClear()
  })

  test('creates a new resource quota', async () => {
    await saveResourceQuota('16', '32Gi', '20')
    expect(mockCreateNamespacedResourceQuota).toHaveBeenCalledTimes(1)
    expect(mockReplaceNamespacedResourceQuota).not.toHaveBeenCalled()

    const callArg = mockCreateNamespacedResourceQuota.mock.calls[0][0] as {
      body: { spec: { hard: Record<string, string> } }
    }
    expect(callArg.body.spec.hard['requests.cpu']).toBe('16')
    expect(callArg.body.spec.hard['requests.memory']).toBe('32Gi')
    expect(callArg.body.spec.hard['pods']).toBe('20')
  })

  test('replaces on 409 conflict', async () => {
    mockCreateNamespacedResourceQuota.mockRejectedValueOnce({ code: 409 })
    await saveResourceQuota('16', '32Gi', '20')
    expect(mockCreateNamespacedResourceQuota).toHaveBeenCalledTimes(1)
    expect(mockReplaceNamespacedResourceQuota).toHaveBeenCalledTimes(1)
  })

  test('throws on non-409 errors', async () => {
    mockCreateNamespacedResourceQuota.mockRejectedValueOnce({ code: 403 })
    await expect(saveResourceQuota('16', '32Gi', '20')).rejects.toEqual({ code: 403 })
  })

  test('uses custom namespace', async () => {
    await saveResourceQuota('8', '16Gi', '10', 'staging')
    const callArg = mockCreateNamespacedResourceQuota.mock.calls[0][0] as {
      namespace: string
    }
    expect(callArg.namespace).toBe('staging')
  })
})
