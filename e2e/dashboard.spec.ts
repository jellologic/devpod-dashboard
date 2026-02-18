import { test, expect } from '@playwright/test'

const TEST_USER = process.env.TEST_USERNAME || 'admin'
const TEST_PASS = process.env.TEST_PASSWORD || 'changeme'

/** Navigate to login, wait for JS hydration, then authenticate */
async function login(page: import('@playwright/test').Page) {
  await page.goto('/login', { waitUntil: 'networkidle' })
  await page.waitForFunction(
    () => Object.keys(document).some((k) => k.startsWith('__react')),
    { timeout: 10000 },
  )
  await page.fill('#login-username', TEST_USER)
  await page.fill('#login-password', TEST_PASS)
  await page.click('button[type="submit"]')
  // TanStack Router does SPA navigation; wait for the URL to change
  await page.waitForURL(/\/$/, { timeout: 10000 })
}

test.describe('Login page', () => {
  test('loads the login page with sign-in form', async ({ page }) => {
    await page.goto('/login')
    await expect(page).toHaveTitle('WorkspaceKit')
    await expect(page.locator('h1')).toContainText('Sign In')
    await expect(page.locator('#login-username')).toBeVisible()
    await expect(page.locator('#login-password')).toBeVisible()
    await expect(
      page.getByRole('button', { name: 'Sign In' }),
    ).toBeVisible()
  })

  test('shows error on invalid credentials', async ({ page }) => {
    await page.goto('/login', { waitUntil: 'networkidle' })
    await page.waitForFunction(
      () => Object.keys(document).some((k) => k.startsWith('__react')),
      { timeout: 10000 },
    )
    await page.fill('#login-username', 'invalid-user')
    await page.fill('#login-password', 'invalid-pass')
    await page.click('button[type="submit"]')

    await expect(
      page.getByText('Invalid credentials'),
    ).toBeVisible({ timeout: 5000 })
  })

  test('logs in successfully with default credentials', async ({ page }) => {
    await login(page)
    await expect(page.getByText('Workspaces').first()).toBeVisible()
  })
})

test.describe('Dashboard (authenticated)', () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
  })

  test('shows navigation bar with branding', async ({ page }) => {
    await expect(page.locator('nav')).toBeVisible()
    await expect(
      page.locator('nav').getByText('WorkspaceKit'),
    ).toBeVisible()
  })

  test('shows workspaces heading', async ({ page }) => {
    await expect(
      page.locator('h1', { hasText: 'Workspaces' }),
    ).toBeVisible()
  })

  test('shows + New Workspace button', async ({ page }) => {
    await expect(
      page.getByRole('button', { name: '+ New Workspace' }),
    ).toBeVisible()
  })

  test('shows stats panel', async ({ page }) => {
    // Stats panel has "System Stats" heading and shows pod counts
    await expect(page.getByText('System Stats')).toBeVisible({ timeout: 5000 })
    await expect(page.getByText('Pods')).toBeVisible()
  })

  test('can open create workspace form', async ({ page }) => {
    await page.click('button:has-text("+ New Workspace")')

    // The form heading is a div, use first() to disambiguate from submit button
    await expect(
      page.getByText('Create Workspace').first(),
    ).toBeVisible()
    await expect(page.getByText('Workspace Name')).toBeVisible()
    await expect(page.getByText('Repository URL')).toBeVisible()
    await expect(page.getByText('Branch')).toBeVisible()
    await expect(page.getByText('CPU Request')).toBeVisible()
    await expect(page.getByText('Memory Limit')).toBeVisible()

    await page.click('button:has-text("Cancel")')
    // After cancel, the form heading should be gone
    await expect(
      page.getByText('Create Workspace').first(),
    ).not.toBeVisible()
  })

  test('shows existing workspace pods', async ({ page }) => {
    // The dashboard shows workspace cards with action buttons
    // Check for any workspace card by looking for workspace action buttons
    const workspaceCards = page.getByText('Stop').or(page.getByText('No workspaces found'))
    await expect(workspaceCards.first()).toBeVisible({ timeout: 5000 })
  })
})

test.describe('Navigation', () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
  })

  test('navbar Workspaces link navigates to home', async ({ page }) => {
    await page.locator('nav').getByText('Workspaces').click()
    await expect(page).toHaveURL(/\/$/)
  })
})

test.describe('API endpoints', () => {
  test('GET /login returns 200', async ({ request }) => {
    const response = await request.get('/login')
    expect(response.status()).toBe(200)
  })

  test('POST /api/login with valid creds returns 200', async ({ page }) => {
    // Navigate to the app first so we can make same-origin requests
    await page.goto('/login')
    const result = await page.evaluate(
      async ({ user, pass }) => {
        const res = await fetch('/api/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username: user, password: pass }),
        })
        return { status: res.status, body: await res.json() }
      },
      { user: TEST_USER, pass: TEST_PASS },
    )
    expect(result.status).toBe(200)
    expect(result.body.ok).toBe(true)
  })

  test('POST /api/login with invalid creds returns 401', async ({ request }) => {
    const response = await request.post('/api/login', {
      data: { username: 'bad', password: 'bad' },
    })
    expect(response.status()).toBe(401)
  })
})
