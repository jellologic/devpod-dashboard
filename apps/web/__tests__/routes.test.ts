import { describe, test, expect, mock, beforeEach } from 'bun:test'

// ---------------------------------------------------------------------------
// Direct imports for pure utility functions (no mocking needed)
// ---------------------------------------------------------------------------

import {
  humanBytes,
  formatAge,
  sanitizeName,
  generateUid,
  repoToName,
} from '../app/lib/utils'

// ---------------------------------------------------------------------------
// Mock @workspacekit/k8s for the stats module (it imports from @workspacekit/k8s)
// ---------------------------------------------------------------------------

mock.module('@workspacekit/k8s', () => ({
  getPodMetrics: mock(() => Promise.resolve(new Map())),
  parseCpuValue: mock((v: string) => {
    if (v.endsWith('m')) return parseInt(v)
    return parseInt(v) * 1000
  }),
  parseMemValue: mock((v: string) => {
    if (v.endsWith('Mi')) return parseInt(v) * 1024 * 1024
    if (v.endsWith('Gi')) return parseInt(v) * 1024 * 1024 * 1024
    return parseInt(v)
  }),
  listWorkspacePods: mock(() => Promise.resolve([])),
  getContainerResources: mock(() => ({
    req_cpu: '',
    req_mem: '',
    lim_cpu: '',
    lim_mem: '',
  })),
}))

// Import stats and logs after mocking
const { getStats, getUsageHistory } = await import('../app/server/stats')
const { appendCreationLog, getCreationLog, clearCreationLog, hasCreationLog } =
  await import('../app/server/logs')

// ---------------------------------------------------------------------------
// Utility function tests
// ---------------------------------------------------------------------------

describe('humanBytes', () => {
  test('formats bytes below 1Ki', () => {
    expect(humanBytes(0)).toBe('0B')
    expect(humanBytes(500)).toBe('500B')
    expect(humanBytes(1023)).toBe('1023B')
  })

  test('formats kilobytes', () => {
    expect(humanBytes(1024)).toBe('1Ki')
    expect(humanBytes(2048)).toBe('2Ki')
    expect(humanBytes(512 * 1024)).toBe('512Ki')
  })

  test('formats megabytes', () => {
    expect(humanBytes(1024 * 1024)).toBe('1Mi')
    expect(humanBytes(256 * 1024 * 1024)).toBe('256Mi')
    expect(humanBytes(999 * 1024 * 1024)).toBe('999Mi')
  })

  test('formats gigabytes with one decimal', () => {
    expect(humanBytes(1024 ** 3)).toBe('1.0Gi')
    expect(humanBytes(2.5 * 1024 ** 3)).toBe('2.5Gi')
    expect(humanBytes(10 * 1024 ** 3)).toBe('10.0Gi')
  })

  test('formats fractional gigabytes', () => {
    // 1.5 Gi
    const bytes = 1.5 * 1024 ** 3
    expect(humanBytes(bytes)).toBe('1.5Gi')
  })
})

describe('formatAge', () => {
  test('formats timestamps less than an hour old as minutes', () => {
    const thirtyMinAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString()
    expect(formatAge(thirtyMinAgo)).toBe('30m')
  })

  test('formats timestamps less than a day old as hours + minutes', () => {
    const twoHoursAgo = new Date(Date.now() - 2 * 3600 * 1000 - 15 * 60 * 1000).toISOString()
    expect(formatAge(twoHoursAgo)).toBe('2h 15m')
  })

  test('formats timestamps more than a day old as days + hours', () => {
    const threeDaysAgo = new Date(Date.now() - 3 * 86400 * 1000 - 5 * 3600 * 1000).toISOString()
    expect(formatAge(threeDaysAgo)).toBe('3d 5h')
  })

  test('returns "0m" for future timestamps', () => {
    const future = new Date(Date.now() + 100000).toISOString()
    expect(formatAge(future)).toBe('0m')
  })

  test('returns NaNm for invalid date strings (no exception thrown)', () => {
    // new Date('not-a-date').getTime() returns NaN, which flows through
    // the arithmetic without throwing, producing 'NaNm'
    expect(formatAge('not-a-date')).toBe('NaNm')
  })

  test('handles just now (0 minutes)', () => {
    const now = new Date().toISOString()
    const result = formatAge(now)
    expect(result).toBe('0m')
  })
})

describe('sanitizeName', () => {
  test('lowercases the input', () => {
    expect(sanitizeName('MyProject')).toBe('myproject')
  })

  test('replaces special characters with hyphens', () => {
    expect(sanitizeName('my_project@v2')).toBe('my-project-v2')
  })

  test('removes leading and trailing hyphens', () => {
    expect(sanitizeName('--my-project--')).toBe('my-project')
  })

  test('truncates to 50 characters', () => {
    const long = 'a'.repeat(100)
    const result = sanitizeName(long)
    expect(result.length).toBeLessThanOrEqual(50)
  })

  test('handles empty string', () => {
    expect(sanitizeName('')).toBe('')
  })

  test('handles string with only special characters', () => {
    expect(sanitizeName('!!!@@@###')).toBe('')
  })

  test('preserves already-valid names', () => {
    expect(sanitizeName('my-valid-name')).toBe('my-valid-name')
  })

  test('handles dots and slashes', () => {
    expect(sanitizeName('org/repo.git')).toBe('org-repo-git')
  })
})

describe('generateUid', () => {
  test('returns an 8-character string', () => {
    const uid = generateUid()
    expect(uid.length).toBe(8)
  })

  test('returns alphanumeric characters', () => {
    const uid = generateUid()
    expect(uid).toMatch(/^[a-z0-9]+$/)
  })

  test('generates unique values across calls', () => {
    const uids = new Set<string>()
    for (let i = 0; i < 50; i++) {
      uids.add(generateUid())
    }
    // With 50 calls, we should get at least 40 unique values
    // (collisions are astronomically unlikely but we add some tolerance)
    expect(uids.size).toBeGreaterThan(40)
  })
})

describe('repoToName', () => {
  test('extracts name from HTTPS GitHub URL', () => {
    expect(repoToName('https://github.com/org/my-repo.git')).toBe('my-repo')
  })

  test('extracts name from HTTPS URL without .git suffix', () => {
    expect(repoToName('https://github.com/org/my-repo')).toBe('my-repo')
  })

  test('extracts name from URL with trailing slash', () => {
    expect(repoToName('https://github.com/org/my-repo/')).toBe('my-repo')
  })

  test('extracts name from SSH URL', () => {
    expect(repoToName('git@github.com:org/my-repo.git')).toBe('my-repo')
  })

  test('extracts name from GitLab URL with nested groups', () => {
    expect(
      repoToName('https://gitlab.com/group/subgroup/project-name.git'),
    ).toBe('project-name')
  })

  test('sanitizes the extracted name', () => {
    expect(
      repoToName('https://github.com/org/My_Weird.Repo.git'),
    ).toBe('my-weird-repo')
  })

  test('returns empty string for empty input', () => {
    expect(repoToName('')).toBe('')
  })

  test('handles simple path-like repo URL', () => {
    expect(repoToName('/home/user/my-project')).toBe('my-project')
  })
})

// ---------------------------------------------------------------------------
// Stats module tests
// ---------------------------------------------------------------------------

describe('getStats', () => {
  test('returns stats object with expected shape', () => {
    const stats = getStats()
    expect(stats).toBeDefined()
    expect(stats).toHaveProperty('cpu')
    expect(stats).toHaveProperty('ncpu')
    expect(stats).toHaveProperty('mem')
    expect(stats).toHaveProperty('swap')
    expect(stats).toHaveProperty('load')
    expect(stats).toHaveProperty('tasks')
    expect(stats).toHaveProperty('uptime')
    expect(stats).toHaveProperty('disk')
    expect(stats).toHaveProperty('procs')
  })

  test('returns empty CPU map when cache is not populated', () => {
    const stats = getStats()
    expect(Object.keys(stats.cpu).length).toBe(0)
  })

  test('ncpu reflects the number of CPUs on the system', () => {
    const stats = getStats()
    expect(stats.ncpu).toBeGreaterThan(0)
    expect(typeof stats.ncpu).toBe('number')
  })

  test('load is a tuple of three numbers', () => {
    const stats = getStats()
    expect(stats.load).toHaveLength(3)
    expect(typeof stats.load[0]).toBe('number')
    expect(typeof stats.load[1]).toBe('number')
    expect(typeof stats.load[2]).toBe('number')
  })
})

describe('getUsageHistory', () => {
  test('returns empty array for unknown pod', () => {
    const history = getUsageHistory('nonexistent-pod')
    expect(history).toEqual([])
  })

  test('returns empty array for empty string pod name', () => {
    const history = getUsageHistory('')
    expect(history).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// Logs module tests
// ---------------------------------------------------------------------------

describe('appendCreationLog / getCreationLog', () => {
  beforeEach(() => {
    // Clear any previous logs from other test runs
    clearCreationLog('test-ws')
    clearCreationLog('test-ws-2')
    clearCreationLog('overflow-ws')
  })

  test('stores and retrieves a single log line', () => {
    appendCreationLog('test-ws', 'Cloning repository...')
    const lines = getCreationLog('test-ws')
    expect(lines).toEqual(['Cloning repository...'])
  })

  test('stores multiple log lines in order', () => {
    appendCreationLog('test-ws', 'Step 1: Cloning')
    appendCreationLog('test-ws', 'Step 2: Building')
    appendCreationLog('test-ws', 'Step 3: Done')

    const lines = getCreationLog('test-ws')
    expect(lines).toEqual([
      'Step 1: Cloning',
      'Step 2: Building',
      'Step 3: Done',
    ])
  })

  test('keeps separate logs per workspace', () => {
    appendCreationLog('test-ws', 'Log for ws1')
    appendCreationLog('test-ws-2', 'Log for ws2')

    expect(getCreationLog('test-ws')).toEqual(['Log for ws1'])
    expect(getCreationLog('test-ws-2')).toEqual(['Log for ws2'])
  })

  test('returns empty array for workspace with no logs', () => {
    expect(getCreationLog('nonexistent-ws')).toEqual([])
  })
})

describe('clearCreationLog', () => {
  test('removes all log lines for a workspace', () => {
    appendCreationLog('test-ws', 'Line 1')
    appendCreationLog('test-ws', 'Line 2')

    clearCreationLog('test-ws')
    expect(getCreationLog('test-ws')).toEqual([])
  })

  test('clearing a non-existent workspace does not throw', () => {
    expect(() => clearCreationLog('nonexistent-ws')).not.toThrow()
  })
})

describe('hasCreationLog', () => {
  beforeEach(() => {
    clearCreationLog('test-ws')
  })

  test('returns true when workspace has log lines', () => {
    appendCreationLog('test-ws', 'Some log')
    expect(hasCreationLog('test-ws')).toBe(true)
  })

  test('returns false when workspace has no logs', () => {
    expect(hasCreationLog('test-ws')).toBe(false)
  })

  test('returns false for non-existent workspace', () => {
    expect(hasCreationLog('nonexistent-ws')).toBe(false)
  })

  test('returns false after clearing logs', () => {
    appendCreationLog('test-ws', 'Line')
    clearCreationLog('test-ws')
    expect(hasCreationLog('test-ws')).toBe(false)
  })
})

describe('creation log max line limit', () => {
  beforeEach(() => {
    clearCreationLog('overflow-ws')
  })

  test('trims to 500 lines when exceeded (FIFO)', () => {
    // Add 510 lines
    for (let i = 0; i < 510; i++) {
      appendCreationLog('overflow-ws', `Line ${i}`)
    }

    const lines = getCreationLog('overflow-ws')
    expect(lines.length).toBe(500)

    // The first 10 lines should have been trimmed (FIFO from the front)
    expect(lines[0]).toBe('Line 10')
    expect(lines[499]).toBe('Line 509')
  })

  test('does not trim at exactly 500 lines', () => {
    for (let i = 0; i < 500; i++) {
      appendCreationLog('overflow-ws', `Line ${i}`)
    }

    const lines = getCreationLog('overflow-ws')
    expect(lines.length).toBe(500)
    expect(lines[0]).toBe('Line 0')
    expect(lines[499]).toBe('Line 499')
  })
})
