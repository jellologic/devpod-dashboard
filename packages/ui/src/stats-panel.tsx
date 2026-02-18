import React from 'react'
import type { SystemStats } from '@workspacekit/types'
import { theme } from './theme'

export interface StatsPanelProps {
  stats: SystemStats | null
  workspaceCount: number
  runningCount: number
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function pct(used: number, total: number): number {
  if (total <= 0) return 0
  return Math.min(100, Math.round((used / total) * 100))
}

function formatBytes(bytes: number): string {
  if (bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(1024))
  const value = bytes / Math.pow(1024, i)
  return `${value.toFixed(1)} ${units[i]}`
}

function barColor(percent: number): string {
  if (percent >= 90) return theme.colors.danger
  if (percent >= 70) return theme.colors.warning
  return theme.colors.success
}

// ---------------------------------------------------------------------------
// Gauge (progress bar)
// ---------------------------------------------------------------------------

interface GaugeProps {
  label: string
  percent: number
  detail?: string
}

const Gauge: React.FC<GaugeProps> = ({ label, percent, detail }) => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: theme.spacing.xs }}>
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        fontSize: theme.fontSize.sm,
      }}
    >
      <span style={{ color: theme.colors.text, fontWeight: 500 }}>{label}</span>
      <span style={{ color: theme.colors.textSecondary }}>
        {percent}%{detail ? ` (${detail})` : ''}
      </span>
    </div>
    <div
      style={{
        height: 8,
        borderRadius: theme.radius.sm,
        background: theme.colors.border,
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          height: '100%',
          width: `${percent}%`,
          borderRadius: theme.radius.sm,
          background: barColor(percent),
          transition: 'width 400ms ease',
        }}
      />
    </div>
  </div>
)

// ---------------------------------------------------------------------------
// Stat value (inline label + value)
// ---------------------------------------------------------------------------

interface StatValueProps {
  label: string
  value: string
}

const StatValue: React.FC<StatValueProps> = ({ label, value }) => (
  <div
    style={{
      display: 'flex',
      justifyContent: 'space-between',
      fontSize: theme.fontSize.sm,
      padding: `${theme.spacing.xs} 0`,
    }}
  >
    <span style={{ color: theme.colors.textSecondary }}>{label}</span>
    <span style={{ color: theme.colors.text, fontWeight: 500 }}>{value}</span>
  </div>
)

// ---------------------------------------------------------------------------
// StatsPanel
// ---------------------------------------------------------------------------

export const StatsPanel: React.FC<StatsPanelProps> = ({
  stats,
  workspaceCount,
  runningCount,
}) => {
  if (!stats) {
    return (
      <div
        style={{
          background: theme.colors.surface,
          border: `1px solid ${theme.colors.border}`,
          borderRadius: theme.radius.md,
          padding: theme.spacing.md,
          color: theme.colors.textSecondary,
          fontSize: theme.fontSize.sm,
        }}
      >
        Loading system stats...
      </div>
    )
  }

  const cpuPercent = Math.round(stats.cpu['cpu'] ?? 0)
  const memPercent = pct(stats.mem.used, stats.mem.total)
  const diskPercent = pct(stats.disk.used, stats.disk.total)

  const memDetail = `${formatBytes(stats.mem.used)} / ${formatBytes(stats.mem.total)}`
  const diskDetail = `${formatBytes(stats.disk.used)} / ${formatBytes(stats.disk.total)}`

  const [load1, load5, load15] = stats.load

  return (
    <div
      style={{
        background: theme.colors.surface,
        border: `1px solid ${theme.colors.border}`,
        borderRadius: theme.radius.md,
        padding: theme.spacing.md,
        display: 'flex',
        flexDirection: 'column',
        gap: theme.spacing.md,
      }}
    >
      {/* Title */}
      <div
        style={{
          fontSize: theme.fontSize.lg,
          fontWeight: 600,
          color: theme.colors.text,
          borderBottom: `1px solid ${theme.colors.border}`,
          paddingBottom: theme.spacing.sm,
        }}
      >
        System Stats
      </div>

      {/* Gauges */}
      <Gauge label="CPU" percent={cpuPercent} />
      <Gauge label="Memory" percent={memPercent} detail={memDetail} />
      <Gauge label="Disk" percent={diskPercent} detail={diskDetail} />

      {/* Divider */}
      <div style={{ borderTop: `1px solid ${theme.colors.border}` }} />

      {/* Info rows */}
      <StatValue
        label="Pods"
        value={`${runningCount} running / ${workspaceCount} total`}
      />
      <StatValue
        label="Load Average"
        value={`${load1.toFixed(2)}  ${load5.toFixed(2)}  ${load15.toFixed(2)}`}
      />
      <StatValue label="Uptime" value={stats.uptime} />
      <StatValue label="Tasks" value={stats.tasks} />
      <StatValue label="CPUs" value={String(stats.ncpu)} />

      {/* Swap (show only if non-zero) */}
      {stats.swap.total > 0 && (
        <StatValue
          label="Swap"
          value={`${formatBytes(stats.swap.used)} / ${formatBytes(stats.swap.total)}`}
        />
      )}
    </div>
  )
}
