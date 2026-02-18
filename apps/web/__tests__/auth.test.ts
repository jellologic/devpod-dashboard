import { describe, test, expect, mock, beforeEach } from 'bun:test'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

// Mock @tanstack/react-start so importing auth.ts does not fail
mock.module('@tanstack/react-start', () => ({
  createMiddleware: () => ({
    server: () => ({}),
  }),
}))

// Default config values used by the auth module
const testConfig = {
  port: 3000,
  namespace: 'workspacekit',
  defaultImage: 'mcr.microsoft.com/devcontainers/base:ubuntu',
  openvscodePath: '/opt/openvscode-server',
  diskSize: '50Gi',
  usersFile: '',
  authUser: 'admin',
  authPass: 'secret123',
  sessionSecret: 'test-secret-for-signing',
}

mock.module('~/lib/config', () => ({
  config: testConfig,
}))

// Mock fs so we can control user file loading
const mockReadFileSync = mock((_path: string, _enc: string): string => '[]')

mock.module('node:fs', () => ({
  default: {
    readFileSync: mockReadFileSync,
  },
  readFileSync: mockReadFileSync,
}))

// Import after mocking
const {
  validateLogin,
  createSession,
  getSession,
  buildSetCookieHeader,
  buildClearCookieHeader,
  requireAuth,
} = await import('../app/server/auth')

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('validateLogin', () => {
  beforeEach(() => {
    mockReadFileSync.mockClear()
    // Reset usersFile to empty so fallback admin user is used
    testConfig.usersFile = ''
  })

  test('returns user record for correct credentials', () => {
    const result = validateLogin('admin', 'secret123')
    expect(result).not.toBeNull()
    expect(result!.username).toBe('admin')
    expect(result!.role).toBe('admin')
  })

  test('returns null for wrong username', () => {
    const result = validateLogin('wronguser', 'secret123')
    expect(result).toBeNull()
  })

  test('returns null for wrong password', () => {
    const result = validateLogin('admin', 'wrongpass')
    expect(result).toBeNull()
  })

  test('returns null for empty credentials', () => {
    const result = validateLogin('', '')
    expect(result).toBeNull()
  })

  test('loads users from JSON file when usersFile is set', () => {
    testConfig.usersFile = '/etc/workspacekit/users.json'
    mockReadFileSync.mockReturnValue(
      JSON.stringify([
        { username: 'alice', password: 'alice-pass', role: 'admin' },
        { username: 'bob', password: 'bob-pass', role: 'user' },
      ]),
    )

    const result = validateLogin('alice', 'alice-pass')
    expect(result).not.toBeNull()
    expect(result!.username).toBe('alice')
    expect(result!.role).toBe('admin')
    expect(mockReadFileSync).toHaveBeenCalledWith('/etc/workspacekit/users.json', 'utf-8')
  })

  test('multi-user: can validate different users from file', () => {
    testConfig.usersFile = '/etc/workspacekit/users.json'
    mockReadFileSync.mockReturnValue(
      JSON.stringify([
        { username: 'alice', password: 'alice-pass', role: 'admin' },
        { username: 'bob', password: 'bob-pass', role: 'user' },
      ]),
    )

    const alice = validateLogin('alice', 'alice-pass')
    expect(alice).not.toBeNull()
    expect(alice!.role).toBe('admin')

    const bob = validateLogin('bob', 'bob-pass')
    expect(bob).not.toBeNull()
    expect(bob!.role).toBe('user')
  })

  test('falls back to env var user when usersFile read fails', () => {
    testConfig.usersFile = '/nonexistent/users.json'
    mockReadFileSync.mockImplementation(() => {
      throw new Error('ENOENT: no such file or directory')
    })

    const result = validateLogin('admin', 'secret123')
    expect(result).not.toBeNull()
    expect(result!.username).toBe('admin')
  })

  test('falls back to env var user when usersFile contains invalid JSON', () => {
    testConfig.usersFile = '/etc/workspacekit/users.json'
    mockReadFileSync.mockReturnValue('not valid json{{{')

    const result = validateLogin('admin', 'secret123')
    expect(result).not.toBeNull()
    expect(result!.username).toBe('admin')
  })
})

describe('createSession / getSession roundtrip', () => {
  test('creates a session cookie and parses it back', () => {
    const user = { username: 'admin', password: 'secret123', role: 'admin' as const }
    const cookie = createSession(user)

    // The cookie value should be a non-empty string with a dot separator
    expect(cookie).toContain('.')
    expect(cookie.length).toBeGreaterThan(10)

    // Build a full Cookie header and parse the session
    const header = `wsk_session=${cookie}`
    const session = getSession(header)
    expect(session).not.toBeNull()
    expect(session!.user).toBe('admin')
    expect(session!.role).toBe('admin')
  })

  test('preserves user role in roundtrip', () => {
    const user = { username: 'bob', password: 'pass', role: 'user' as const }
    const cookie = createSession(user)
    const header = `wsk_session=${cookie}`
    const session = getSession(header)
    expect(session).not.toBeNull()
    expect(session!.user).toBe('bob')
    expect(session!.role).toBe('user')
  })
})

describe('getSession - edge cases', () => {
  test('returns null for null cookie header', () => {
    const session = getSession(null)
    expect(session).toBeNull()
  })

  test('returns null for empty cookie header', () => {
    const session = getSession('')
    expect(session).toBeNull()
  })

  test('returns null when session cookie is missing from header', () => {
    const session = getSession('other_cookie=value123')
    expect(session).toBeNull()
  })

  test('returns null for tampered cookie value', () => {
    const user = { username: 'admin', password: 'secret123', role: 'admin' as const }
    const cookie = createSession(user)

    // Tamper with the payload by flipping a character
    const tampered = 'X' + cookie.slice(1)
    const header = `wsk_session=${tampered}`
    const session = getSession(header)
    expect(session).toBeNull()
  })

  test('returns null for cookie with no dot separator', () => {
    const header = 'wsk_session=nodothere'
    const session = getSession(header)
    expect(session).toBeNull()
  })

  test('returns null for cookie with invalid base64 payload', () => {
    const header = 'wsk_session=!!!invalid!!!.fakesig'
    const session = getSession(header)
    expect(session).toBeNull()
  })

  test('handles cookie header with multiple cookies', () => {
    const user = { username: 'admin', password: 'secret123', role: 'admin' as const }
    const cookie = createSession(user)
    const header = `other=abc; wsk_session=${cookie}; another=xyz`
    const session = getSession(header)
    expect(session).not.toBeNull()
    expect(session!.user).toBe('admin')
  })
})

describe('buildSetCookieHeader', () => {
  test('builds a valid Set-Cookie string', () => {
    const header = buildSetCookieHeader('test-value')
    expect(header).toContain('wsk_session=test-value')
    expect(header).toContain('Path=/')
    expect(header).toContain('HttpOnly')
    expect(header).toContain('SameSite=Lax')
    expect(header).toContain('Max-Age=86400')
  })
})

describe('buildClearCookieHeader', () => {
  test('builds a clear cookie header with Max-Age=0', () => {
    const header = buildClearCookieHeader()
    expect(header).toContain('wsk_session=')
    expect(header).toContain('Max-Age=0')
    expect(header).toContain('HttpOnly')
  })
})

describe('requireAuth', () => {
  test('returns session payload for valid request', () => {
    const user = { username: 'admin', password: 'secret123', role: 'admin' as const }
    const cookie = createSession(user)
    const request = new Request('http://localhost:3000/api/test', {
      headers: { cookie: `wsk_session=${cookie}` },
    })

    const session = requireAuth(request)
    expect(session.user).toBe('admin')
    expect(session.role).toBe('admin')
  })

  test('throws 401 Response for request without cookie', () => {
    const request = new Request('http://localhost:3000/api/test')

    try {
      requireAuth(request)
      // Should not reach here
      expect(true).toBe(false)
    } catch (err) {
      expect(err).toBeInstanceOf(Response)
      expect((err as Response).status).toBe(401)
    }
  })

  test('throws 401 Response for request with invalid cookie', () => {
    const request = new Request('http://localhost:3000/api/test', {
      headers: { cookie: 'wsk_session=tampered.invalid' },
    })

    try {
      requireAuth(request)
      expect(true).toBe(false)
    } catch (err) {
      expect(err).toBeInstanceOf(Response)
      expect((err as Response).status).toBe(401)
    }
  })
})
