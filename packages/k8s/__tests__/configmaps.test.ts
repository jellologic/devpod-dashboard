import { describe, test, expect, mock, beforeEach } from 'bun:test'

// ---------------------------------------------------------------------------
// Mock functions
// ---------------------------------------------------------------------------

const mockReadNamespacedConfigMap = mock(() =>
  Promise.resolve({
    metadata: { name: 'test-cm' },
    data: { key: 'value' },
  }),
)

const mockCreateNamespacedConfigMap = mock((params: { body: unknown }) =>
  Promise.resolve(params.body),
)

const mockReplaceNamespacedConfigMap = mock((params: { body: unknown }) =>
  Promise.resolve(params.body),
)

const mockDeleteNamespacedConfigMap = mock(() => Promise.resolve({}))

const mockListNamespacedConfigMap = mock(() =>
  Promise.resolve({
    items: [
      { metadata: { name: 'cm-1' }, data: { foo: 'bar' } },
      { metadata: { name: 'cm-2' }, data: { baz: 'qux' } },
    ],
  }),
)

// ---------------------------------------------------------------------------
// Mock the client module
// ---------------------------------------------------------------------------

mock.module('../src/client', () => ({
  coreV1: {
    readNamespacedConfigMap: mockReadNamespacedConfigMap,
    createNamespacedConfigMap: mockCreateNamespacedConfigMap,
    replaceNamespacedConfigMap: mockReplaceNamespacedConfigMap,
    deleteNamespacedConfigMap: mockDeleteNamespacedConfigMap,
    listNamespacedConfigMap: mockListNamespacedConfigMap,
  },
  namespace: 'workspacekit',
}))

const {
  SCHEDULES_CM,
  EXPIRY_CM,
  TEMPLATES_CM,
  DEFAULTS_CM,
  getConfigMap,
  upsertConfigMap,
  deleteConfigMap,
  listConfigMaps,
  getSchedules,
  saveSchedules,
  getExpiryDays,
  setExpiryDays,
  getPresets,
  savePresets,
  getWorkspaceDefaults,
  saveWorkspaceDefaults,
  saveWorkspaceMeta,
  getWorkspaceMeta,
  savePodSpec,
  getSavedPodSpec,
} = await import('../src/configmaps')

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('constants', () => {
  test('ConfigMap names are defined', () => {
    expect(SCHEDULES_CM).toBe('workspacekit-schedules')
    expect(EXPIRY_CM).toBe('workspacekit-expiry')
    expect(TEMPLATES_CM).toBe('workspacekit-templates')
    expect(DEFAULTS_CM).toBe('workspacekit-defaults')
  })
})

describe('getConfigMap', () => {
  beforeEach(() => {
    mockReadNamespacedConfigMap.mockClear()
  })

  test('returns configmap when found', async () => {
    const cm = await getConfigMap('test-cm')
    expect(cm).not.toBeNull()
    expect(cm!.metadata?.name).toBe('test-cm')
  })

  test('returns null on 404', async () => {
    mockReadNamespacedConfigMap.mockRejectedValueOnce({ code: 404 })
    const cm = await getConfigMap('nonexistent')
    expect(cm).toBeNull()
  })

  test('throws on non-404 errors', async () => {
    mockReadNamespacedConfigMap.mockRejectedValueOnce({ code: 500 })
    await expect(getConfigMap('test-cm')).rejects.toEqual({ code: 500 })
  })
})

describe('upsertConfigMap', () => {
  beforeEach(() => {
    mockCreateNamespacedConfigMap.mockClear()
    mockReplaceNamespacedConfigMap.mockClear()
  })

  test('creates configmap on first try', async () => {
    const result = await upsertConfigMap('new-cm', 'workspacekit', { key: 'value' })
    expect(mockCreateNamespacedConfigMap).toHaveBeenCalledTimes(1)
    expect(mockReplaceNamespacedConfigMap).not.toHaveBeenCalled()
  })

  test('replaces on 409 conflict', async () => {
    mockCreateNamespacedConfigMap.mockRejectedValueOnce({ code: 409 })
    mockReplaceNamespacedConfigMap.mockResolvedValueOnce({
      metadata: { name: 'existing-cm' },
      data: { key: 'updated' },
    })

    await upsertConfigMap('existing-cm', 'workspacekit', { key: 'updated' })
    expect(mockCreateNamespacedConfigMap).toHaveBeenCalledTimes(1)
    expect(mockReplaceNamespacedConfigMap).toHaveBeenCalledTimes(1)
  })

  test('throws on non-409 errors during create', async () => {
    mockCreateNamespacedConfigMap.mockRejectedValueOnce({ code: 403 })
    await expect(upsertConfigMap('cm', 'workspacekit', {})).rejects.toEqual({ code: 403 })
  })

  test('passes labels to configmap', async () => {
    await upsertConfigMap('labeled-cm', 'workspacekit', { k: 'v' }, { app: 'test' })
    const callArg = mockCreateNamespacedConfigMap.mock.calls[0][0] as {
      body: { metadata: { labels: Record<string, string> } }
    }
    expect(callArg.body.metadata.labels).toEqual({ app: 'test' })
  })
})

describe('deleteConfigMap', () => {
  beforeEach(() => {
    mockDeleteNamespacedConfigMap.mockClear()
  })

  test('deletes a configmap', async () => {
    await deleteConfigMap('test-cm')
    expect(mockDeleteNamespacedConfigMap).toHaveBeenCalledWith({
      name: 'test-cm',
      namespace: 'workspacekit',
    })
  })

  test('ignores 404 errors', async () => {
    mockDeleteNamespacedConfigMap.mockRejectedValueOnce({ code: 404 })
    await expect(deleteConfigMap('nonexistent')).resolves.toBeUndefined()
  })

  test('throws on non-404 errors', async () => {
    mockDeleteNamespacedConfigMap.mockRejectedValueOnce({ code: 500 })
    await expect(deleteConfigMap('test-cm')).rejects.toEqual({ code: 500 })
  })
})

describe('listConfigMaps', () => {
  beforeEach(() => {
    mockListNamespacedConfigMap.mockClear()
  })

  test('lists configmaps by label selector', async () => {
    const cms = await listConfigMaps('component=workspace-meta')
    expect(cms).toHaveLength(2)
    expect(mockListNamespacedConfigMap).toHaveBeenCalledWith({
      namespace: 'workspacekit',
      labelSelector: 'component=workspace-meta',
    })
  })
})

describe('getSchedules', () => {
  beforeEach(() => {
    mockReadNamespacedConfigMap.mockClear()
  })

  test('parses schedules from configmap', async () => {
    const schedules = [
      { workspace: 'ws1', pod_name: 'ws-1', action: 'start', days: ['mon'], hour: 9, minute: 0 },
    ]
    mockReadNamespacedConfigMap.mockResolvedValueOnce({
      metadata: { name: SCHEDULES_CM },
      data: { schedules: JSON.stringify(schedules) },
    })

    const result = await getSchedules()
    expect(result).toHaveLength(1)
    expect(result[0].workspace).toBe('ws1')
    expect(result[0].action).toBe('start')
  })

  test('returns empty array when configmap not found', async () => {
    mockReadNamespacedConfigMap.mockRejectedValueOnce({ code: 404 })
    const result = await getSchedules()
    expect(result).toEqual([])
  })

  test('returns empty array when data is empty', async () => {
    mockReadNamespacedConfigMap.mockResolvedValueOnce({
      metadata: { name: SCHEDULES_CM },
      data: {},
    })
    const result = await getSchedules()
    expect(result).toEqual([])
  })

  test('returns empty array on invalid JSON', async () => {
    mockReadNamespacedConfigMap.mockResolvedValueOnce({
      metadata: { name: SCHEDULES_CM },
      data: { schedules: 'not-json' },
    })
    const result = await getSchedules()
    expect(result).toEqual([])
  })
})

describe('saveSchedules', () => {
  beforeEach(() => {
    mockCreateNamespacedConfigMap.mockClear()
  })

  test('saves schedules to configmap', async () => {
    const schedules = [
      { workspace: 'ws1', pod_name: 'ws-1', action: 'stop' as const, days: ['fri'], hour: 18, minute: 0 },
    ]
    await saveSchedules(schedules)
    expect(mockCreateNamespacedConfigMap).toHaveBeenCalledTimes(1)
  })
})

describe('getExpiryDays', () => {
  beforeEach(() => {
    mockReadNamespacedConfigMap.mockClear()
  })

  test('returns expiry days from configmap', async () => {
    mockReadNamespacedConfigMap.mockResolvedValueOnce({
      metadata: { name: EXPIRY_CM },
      data: { days: '30' },
    })
    const days = await getExpiryDays()
    expect(days).toBe(30)
  })

  test('returns 0 when not set', async () => {
    mockReadNamespacedConfigMap.mockRejectedValueOnce({ code: 404 })
    const days = await getExpiryDays()
    expect(days).toBe(0)
  })

  test('returns 0 for invalid value', async () => {
    mockReadNamespacedConfigMap.mockResolvedValueOnce({
      metadata: { name: EXPIRY_CM },
      data: { days: 'not-a-number' },
    })
    const days = await getExpiryDays()
    expect(days).toBe(0)
  })
})

describe('setExpiryDays', () => {
  beforeEach(() => {
    mockCreateNamespacedConfigMap.mockClear()
  })

  test('writes expiry days', async () => {
    await setExpiryDays(14)
    expect(mockCreateNamespacedConfigMap).toHaveBeenCalledTimes(1)
  })
})

describe('getPresets', () => {
  beforeEach(() => {
    mockReadNamespacedConfigMap.mockClear()
  })

  test('parses presets from configmap', async () => {
    const presets = [
      {
        id: 'p1',
        name: 'Small',
        description: 'A small workspace',
        repo_url: 'https://github.com/repo',
        req_cpu: '500m',
        req_mem: '1Gi',
        lim_cpu: '1',
        lim_mem: '2Gi',
      },
    ]
    mockReadNamespacedConfigMap.mockResolvedValueOnce({
      metadata: { name: TEMPLATES_CM },
      data: { templates: JSON.stringify(presets) },
    })

    const result = await getPresets()
    expect(result).toHaveLength(1)
    expect(result[0].name).toBe('Small')
  })

  test('returns empty array when not found', async () => {
    mockReadNamespacedConfigMap.mockRejectedValueOnce({ code: 404 })
    const result = await getPresets()
    expect(result).toEqual([])
  })
})

describe('savePresets', () => {
  beforeEach(() => {
    mockCreateNamespacedConfigMap.mockClear()
  })

  test('saves presets to configmap', async () => {
    await savePresets([
      {
        id: 'p1',
        name: 'Large',
        description: 'A large workspace',
        repo_url: '',
        req_cpu: '2',
        req_mem: '4Gi',
        lim_cpu: '4',
        lim_mem: '8Gi',
      },
    ])
    expect(mockCreateNamespacedConfigMap).toHaveBeenCalledTimes(1)
  })
})

describe('getWorkspaceDefaults', () => {
  beforeEach(() => {
    mockReadNamespacedConfigMap.mockClear()
  })

  test('returns defaults from configmap', async () => {
    mockReadNamespacedConfigMap.mockResolvedValueOnce({
      metadata: { name: DEFAULTS_CM },
      data: { req_cpu: '250m', req_mem: '512Mi', lim_cpu: '1', lim_mem: '2Gi' },
    })

    const defaults = await getWorkspaceDefaults()
    expect(defaults.req_cpu).toBe('250m')
    expect(defaults.lim_mem).toBe('2Gi')
  })

  test('returns empty strings when configmap not found', async () => {
    mockReadNamespacedConfigMap.mockRejectedValueOnce({ code: 404 })
    const defaults = await getWorkspaceDefaults()
    expect(defaults.req_cpu).toBe('')
    expect(defaults.req_mem).toBe('')
    expect(defaults.lim_cpu).toBe('')
    expect(defaults.lim_mem).toBe('')
  })
})

describe('saveWorkspaceDefaults', () => {
  beforeEach(() => {
    mockCreateNamespacedConfigMap.mockClear()
  })

  test('writes defaults to configmap', async () => {
    await saveWorkspaceDefaults({
      req_cpu: '500m',
      req_mem: '1Gi',
      lim_cpu: '2',
      lim_mem: '4Gi',
    })
    expect(mockCreateNamespacedConfigMap).toHaveBeenCalledTimes(1)
  })
})

describe('saveWorkspaceMeta', () => {
  beforeEach(() => {
    mockCreateNamespacedConfigMap.mockClear()
  })

  test('creates meta configmap with correct labels', async () => {
    await saveWorkspaceMeta('my-project', 'abc123', 'https://github.com/repo', 'node:20', 'npm install')
    expect(mockCreateNamespacedConfigMap).toHaveBeenCalledTimes(1)

    const callArg = mockCreateNamespacedConfigMap.mock.calls[0][0] as {
      body: {
        metadata: { name: string; labels: Record<string, string> }
        data: Record<string, string>
      }
    }
    expect(callArg.body.metadata.name).toBe('meta-my-project')
    expect(callArg.body.metadata.labels['managed-by']).toBe('workspacekit')
    expect(callArg.body.metadata.labels['component']).toBe('workspace-meta')
    expect(callArg.body.metadata.labels['workspace-name']).toBe('my-project')
    expect(callArg.body.metadata.labels['workspace-uid']).toBe('abc123')
    expect(callArg.body.data.repo_url).toBe('https://github.com/repo')
    expect(callArg.body.data.image).toBe('node:20')
    expect(callArg.body.data.post_create_cmd).toBe('npm install')
  })
})

describe('getWorkspaceMeta', () => {
  beforeEach(() => {
    mockReadNamespacedConfigMap.mockClear()
  })

  test('returns meta configmap', async () => {
    mockReadNamespacedConfigMap.mockResolvedValueOnce({
      metadata: { name: 'meta-my-project' },
      data: { repo_url: 'https://github.com/repo', image: 'node:20' },
    })

    const cm = await getWorkspaceMeta('my-project')
    expect(cm).not.toBeNull()
    expect(cm!.data?.repo_url).toBe('https://github.com/repo')
  })

  test('returns null when not found', async () => {
    mockReadNamespacedConfigMap.mockRejectedValueOnce({ code: 404 })
    const cm = await getWorkspaceMeta('nonexistent')
    expect(cm).toBeNull()
  })
})

describe('savePodSpec', () => {
  beforeEach(() => {
    mockCreateNamespacedConfigMap.mockClear()
  })

  test('saves pod spec as JSON in configmap', async () => {
    const podSpec = { metadata: { name: 'ws-abc123' }, spec: { containers: [] } }
    await savePodSpec('abc123', 'my-project', podSpec as any)
    expect(mockCreateNamespacedConfigMap).toHaveBeenCalledTimes(1)

    const callArg = mockCreateNamespacedConfigMap.mock.calls[0][0] as {
      body: {
        metadata: { name: string; labels: Record<string, string> }
        data: Record<string, string>
      }
    }
    expect(callArg.body.metadata.name).toBe('saved-abc123')
    expect(callArg.body.metadata.labels['workspace-uid']).toBe('abc123')
    expect(callArg.body.metadata.labels['workspace-name']).toBe('my-project')

    const parsed = JSON.parse(callArg.body.data.spec)
    expect(parsed.metadata.name).toBe('ws-abc123')
  })
})

describe('getSavedPodSpec', () => {
  beforeEach(() => {
    mockReadNamespacedConfigMap.mockClear()
  })

  test('returns parsed pod spec', async () => {
    const podSpec = { metadata: { name: 'ws-abc123' }, spec: { containers: [] } }
    mockReadNamespacedConfigMap.mockResolvedValueOnce({
      metadata: { name: 'saved-abc123' },
      data: { spec: JSON.stringify(podSpec) },
    })

    const result = await getSavedPodSpec('abc123')
    expect(result).not.toBeNull()
    expect(result!.metadata?.name).toBe('ws-abc123')
  })

  test('returns null when not found', async () => {
    mockReadNamespacedConfigMap.mockRejectedValueOnce({ code: 404 })
    const result = await getSavedPodSpec('nonexistent')
    expect(result).toBeNull()
  })

  test('returns null on invalid JSON', async () => {
    mockReadNamespacedConfigMap.mockResolvedValueOnce({
      metadata: { name: 'saved-bad' },
      data: { spec: 'not-json' },
    })
    const result = await getSavedPodSpec('bad')
    expect(result).toBeNull()
  })

  test('returns null when spec field missing', async () => {
    mockReadNamespacedConfigMap.mockResolvedValueOnce({
      metadata: { name: 'saved-empty' },
      data: {},
    })
    const result = await getSavedPodSpec('empty')
    expect(result).toBeNull()
  })
})
