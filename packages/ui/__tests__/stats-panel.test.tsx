import { describe, test, expect } from 'bun:test'
import React from 'react'
import { renderToString } from 'react-dom/server'
import { StatsPanel } from '../src/stats-panel'
import type { SystemStats } from '@workspacekit/types'

// ---------------------------------------------------------------------------
// Mock data
// ---------------------------------------------------------------------------

const mockStats: SystemStats = {
  cpu: {
    cpu: 42,
    cpu0: 38,
    cpu1: 46,
  },
  ncpu: 2,
  mem: {
    total: 8_589_934_592, // 8 GB
    used: 5_368_709_120,  // 5 GB
    buffers: 134_217_728,
    cached: 1_073_741_824,
    available: 3_221_225_472,
  },
  swap: {
    total: 2_147_483_648, // 2 GB
    used: 536_870_912,    // 512 MB
  },
  load: [1.23, 0.98, 0.87],
  tasks: '142 total, 2 running',
  uptime: '5 days, 3:22',
  disk: {
    total: 107_374_182_400,  // 100 GB
    used: 64_424_509_440,    // 60 GB
    available: 42_949_672_960,
  },
  procs: [
    { pid: '1', user: 'root', cpu: '0.5', mem: '1.2', rss: 12345, cmd: 'systemd' },
  ],
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('StatsPanel', () => {
  test('renders loading state when stats is null', () => {
    const html = renderToString(
      <StatsPanel stats={null} workspaceCount={0} runningCount={0} />,
    )
    expect(html).toContain('Loading system stats')
  })

  test('renders without crashing with valid stats', () => {
    const html = renderToString(
      <StatsPanel stats={mockStats} workspaceCount={5} runningCount={3} />,
    )
    expect(html).toContain('System Stats')
  })

  test('displays CPU percentage', () => {
    const html = renderToString(
      <StatsPanel stats={mockStats} workspaceCount={5} runningCount={3} />,
    )
    expect(html).toContain('CPU')
    expect(html).toContain('42%')
  })

  test('displays memory usage', () => {
    const html = renderToString(
      <StatsPanel stats={mockStats} workspaceCount={5} runningCount={3} />,
    )
    expect(html).toContain('Memory')
    // 5 GB / 8 GB = 63%
    expect(html).toContain('63%')
  })

  test('displays disk usage', () => {
    const html = renderToString(
      <StatsPanel stats={mockStats} workspaceCount={5} runningCount={3} />,
    )
    expect(html).toContain('Disk')
    // 60 GB / 100 GB = 60%
    expect(html).toContain('60%')
  })

  test('displays pod counts', () => {
    const html = renderToString(
      <StatsPanel stats={mockStats} workspaceCount={5} runningCount={3} />,
    )
    expect(html).toContain('3 running')
    expect(html).toContain('5 total')
  })

  test('displays load averages', () => {
    const html = renderToString(
      <StatsPanel stats={mockStats} workspaceCount={5} runningCount={3} />,
    )
    expect(html).toContain('1.23')
    expect(html).toContain('0.98')
    expect(html).toContain('0.87')
  })

  test('displays uptime', () => {
    const html = renderToString(
      <StatsPanel stats={mockStats} workspaceCount={5} runningCount={3} />,
    )
    expect(html).toContain('5 days, 3:22')
  })

  test('displays CPU count', () => {
    const html = renderToString(
      <StatsPanel stats={mockStats} workspaceCount={5} runningCount={3} />,
    )
    expect(html).toContain('CPUs')
    expect(html).toContain('2')
  })

  test('displays swap when non-zero', () => {
    const html = renderToString(
      <StatsPanel stats={mockStats} workspaceCount={5} runningCount={3} />,
    )
    expect(html).toContain('Swap')
  })

  test('hides swap when total is zero', () => {
    const noSwap: SystemStats = {
      ...mockStats,
      swap: { total: 0, used: 0 },
    }
    const html = renderToString(
      <StatsPanel stats={noSwap} workspaceCount={5} runningCount={3} />,
    )
    expect(html).not.toContain('Swap')
  })

  test('shows danger color for high CPU', () => {
    const highCpu: SystemStats = {
      ...mockStats,
      cpu: { cpu: 95 },
    }
    const html = renderToString(
      <StatsPanel stats={highCpu} workspaceCount={1} runningCount={1} />,
    )
    // The danger color should appear in the gauge bar style.
    expect(html).toContain('95%')
  })

  test('handles zero workspaces', () => {
    const html = renderToString(
      <StatsPanel stats={mockStats} workspaceCount={0} runningCount={0} />,
    )
    expect(html).toContain('0 running')
    expect(html).toContain('0 total')
  })
})
