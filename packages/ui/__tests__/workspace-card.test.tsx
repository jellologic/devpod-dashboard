import { describe, test, expect } from 'bun:test'
import React from 'react'
import { renderToString } from 'react-dom/server'
import { WorkspaceCard } from '../src/workspace-card'
import type { Workspace } from '@workspacekit/types'

// ---------------------------------------------------------------------------
// Mock data
// ---------------------------------------------------------------------------

const baseWorkspace: Workspace = {
  name: 'test-app',
  status: 'Running',
  port: 30100,
  pod: 'ws-test-app',
  uid: 'abc123',
  running: true,
  creating: false,
  shutdown_at: '',
  shutdown_hours: '',
  resources: {
    req_cpu: '250m',
    req_mem: '512Mi',
    lim_cpu: '1',
    lim_mem: '1Gi',
  },
  repo: 'https://github.com/acme/test-app',
  branch: 'main',
  dirty: false,
  last_commit: 'a1b2c3d',
  usage: { cpu: '120m', memory: '256Mi' },
  owner: 'alice',
  last_accessed: '2 hours ago',
  expiry_warning: '',
}

const noop = () => {}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('WorkspaceCard', () => {
  test('renders without crashing', () => {
    const html = renderToString(
      <WorkspaceCard workspace={baseWorkspace} hostIp="192.168.1.1" onAction={noop} />,
    )
    expect(html).toContain('test-app')
    expect(html).toContain('Running')
  })

  test('shows port link when running', () => {
    const html = renderToString(
      <WorkspaceCard workspace={baseWorkspace} hostIp="192.168.1.1" onAction={noop} />,
    )
    expect(html).toContain('30100')
    expect(html).toContain('http://192.168.1.1:30100')
  })

  test('shows stopped state correctly', () => {
    const stopped: Workspace = {
      ...baseWorkspace,
      running: false,
      status: 'Stopped',
      port: 0,
    }
    const html = renderToString(
      <WorkspaceCard workspace={stopped} hostIp="192.168.1.1" onAction={noop} />,
    )
    expect(html).toContain('Stopped')
    // Port link should not appear when stopped.
    expect(html).not.toContain('http://192.168.1.1:')
  })

  test('shows creating state', () => {
    const creating: Workspace = {
      ...baseWorkspace,
      running: false,
      creating: true,
      status: 'Creating',
      port: 0,
    }
    const html = renderToString(
      <WorkspaceCard workspace={creating} hostIp="10.0.0.1" onAction={noop} />,
    )
    expect(html).toContain('Creating')
  })

  test('renders owner badge', () => {
    const html = renderToString(
      <WorkspaceCard workspace={baseWorkspace} hostIp="192.168.1.1" onAction={noop} />,
    )
    expect(html).toContain('alice')
  })

  test('renders resource info', () => {
    const html = renderToString(
      <WorkspaceCard workspace={baseWorkspace} hostIp="192.168.1.1" onAction={noop} />,
    )
    expect(html).toContain('1Gi')
  })

  test('renders repo and branch', () => {
    const html = renderToString(
      <WorkspaceCard workspace={baseWorkspace} hostIp="192.168.1.1" onAction={noop} />,
    )
    expect(html).toContain('acme/test-app')
    expect(html).toContain('main')
  })

  test('shows dirty indicator', () => {
    const dirty: Workspace = { ...baseWorkspace, dirty: true }
    const html = renderToString(
      <WorkspaceCard workspace={dirty} hostIp="192.168.1.1" onAction={noop} />,
    )
    expect(html).toContain('dirty')
  })

  test('shows Start button when stopped', () => {
    const stopped: Workspace = {
      ...baseWorkspace,
      running: false,
      creating: false,
      status: 'Stopped',
      port: 0,
    }
    const html = renderToString(
      <WorkspaceCard workspace={stopped} hostIp="192.168.1.1" onAction={noop} />,
    )
    expect(html).toContain('Start')
    expect(html).not.toContain('Stop')
    expect(html).not.toContain('Terminal')
  })

  test('shows Stop and Terminal buttons when running', () => {
    const html = renderToString(
      <WorkspaceCard workspace={baseWorkspace} hostIp="192.168.1.1" onAction={noop} />,
    )
    expect(html).toContain('Stop')
    expect(html).toContain('Terminal')
    expect(html).not.toContain('>Start<')
  })

  test('always shows Delete and Rebuild buttons', () => {
    const html = renderToString(
      <WorkspaceCard workspace={baseWorkspace} hostIp="192.168.1.1" onAction={noop} />,
    )
    expect(html).toContain('Delete')
    expect(html).toContain('Rebuild')
  })

  test('shows expiry warning when set', () => {
    const expiring: Workspace = {
      ...baseWorkspace,
      expiry_warning: 'Expires in 2 hours',
    }
    const html = renderToString(
      <WorkspaceCard workspace={expiring} hostIp="192.168.1.1" onAction={noop} />,
    )
    expect(html).toContain('Expires in 2 hours')
  })

  test('shows shutdown timer when set', () => {
    const timed: Workspace = {
      ...baseWorkspace,
      shutdown_at: '2026-02-17T18:00:00Z',
    }
    const html = renderToString(
      <WorkspaceCard workspace={timed} hostIp="192.168.1.1" onAction={noop} />,
    )
    expect(html).toContain('2026-02-17T18:00:00Z')
  })
})
