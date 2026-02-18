import React, { useState, useCallback } from 'react'
import type { Workspace } from '@workspacekit/types'
import { theme } from './theme'

export interface WorkspaceCardProps {
  workspace: Workspace
  hostIp: string
  onAction: (action: string, data: Record<string, string>) => void
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function statusColor(ws: Workspace): string {
  if (ws.running) return theme.colors.success
  if (ws.creating) return theme.colors.warning
  if (ws.status === 'Failed' || ws.status === 'Error') return theme.colors.danger
  return theme.colors.textSecondary
}

function statusLabel(ws: Workspace): string {
  if (ws.creating) return 'Creating'
  if (ws.running) return 'Running'
  if (ws.status) return ws.status
  return 'Stopped'
}

function formatResource(value: string): string {
  if (!value || value === '0') return '-'
  return value
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

const StatusDot: React.FC<{ color: string }> = ({ color }) => (
  <span
    style={{
      display: 'inline-block',
      width: 10,
      height: 10,
      borderRadius: '50%',
      backgroundColor: color,
      flexShrink: 0,
      boxShadow: `0 0 6px ${color}80`,
    }}
  />
)

interface ActionButtonProps {
  label: string
  color?: string
  onClick: () => void
}

const ActionButton: React.FC<ActionButtonProps> = ({
  label,
  color = theme.colors.primary,
  onClick,
}) => {
  const [hovered, setHovered] = useState(false)

  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        padding: `${theme.spacing.xs} ${theme.spacing.sm}`,
        fontSize: theme.fontSize.sm,
        fontWeight: 500,
        color: hovered ? theme.colors.bg : color,
        background: hovered ? color : 'transparent',
        border: `1px solid ${color}`,
        borderRadius: theme.radius.sm,
        cursor: 'pointer',
        transition: 'all 150ms ease',
        whiteSpace: 'nowrap',
      }}
    >
      {label}
    </button>
  )
}

// ---------------------------------------------------------------------------
// WorkspaceCard
// ---------------------------------------------------------------------------

export const WorkspaceCard: React.FC<WorkspaceCardProps> = ({
  workspace: ws,
  hostIp,
  onAction,
}) => {
  const [hovered, setHovered] = useState(false)

  const fire = useCallback(
    (action: string) => {
      onAction(action, {
        name: ws.name,
        pod: ws.pod,
        uid: ws.uid,
        repo: ws.repo,
        owner: ws.owner,
      })
    },
    [onAction, ws],
  )

  const portUrl =
    ws.running && ws.port ? `http://${hostIp}:${ws.port}` : null

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        background: theme.colors.surface,
        border: `1px solid ${hovered ? theme.colors.primary : theme.colors.border}`,
        borderRadius: theme.radius.md,
        padding: theme.spacing.md,
        transition: 'border-color 200ms ease, box-shadow 200ms ease',
        boxShadow: hovered ? `0 0 0 1px ${theme.colors.primary}40` : 'none',
        display: 'flex',
        flexDirection: 'column',
        gap: theme.spacing.sm,
      }}
    >
      {/* Header row */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: theme.spacing.sm,
        }}
      >
        <StatusDot color={statusColor(ws)} />

        <a
          href={`/workspace/${ws.name}`}
          style={{
            color: theme.colors.text,
            fontWeight: 600,
            fontSize: theme.fontSize.lg,
            textDecoration: 'none',
          }}
        >
          {ws.name}
        </a>

        <span
          style={{
            marginLeft: 'auto',
            fontSize: theme.fontSize.sm,
            color: statusColor(ws),
            fontWeight: 500,
          }}
        >
          {statusLabel(ws)}
        </span>
      </div>

      {/* Meta info */}
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: `${theme.spacing.xs} ${theme.spacing.md}`,
          fontSize: theme.fontSize.sm,
          color: theme.colors.textSecondary,
        }}
      >
        {ws.repo && (
          <span title={ws.repo}>
            <span style={{ color: theme.colors.text }}>Repo:</span>{' '}
            {ws.repo.replace(/^https?:\/\/(github\.com\/)?/, '')}
          </span>
        )}

        {ws.branch && (
          <span>
            <span style={{ color: theme.colors.text }}>Branch:</span>{' '}
            {ws.branch}
            {ws.dirty && (
              <span style={{ color: theme.colors.warning, marginLeft: 4 }}>
                (dirty)
              </span>
            )}
          </span>
        )}

        {ws.resources && (
          <span>
            <span style={{ color: theme.colors.text }}>CPU:</span>{' '}
            {formatResource(ws.resources.lim_cpu)}{' '}
            <span style={{ color: theme.colors.text }}>Mem:</span>{' '}
            {formatResource(ws.resources.lim_mem)}
          </span>
        )}

        {portUrl && (
          <span>
            <span style={{ color: theme.colors.text }}>Port:</span>{' '}
            <a
              href={portUrl}
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: theme.colors.primary }}
            >
              {ws.port}
            </a>
          </span>
        )}
      </div>

      {/* Additional info row */}
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: `${theme.spacing.xs} ${theme.spacing.md}`,
          fontSize: theme.fontSize.sm,
          color: theme.colors.textSecondary,
        }}
      >
        {ws.owner && (
          <span
            style={{
              background: `${theme.colors.primary}20`,
              color: theme.colors.primary,
              padding: `2px ${theme.spacing.sm}`,
              borderRadius: theme.radius.sm,
              fontSize: theme.fontSize.xs,
              fontWeight: 500,
            }}
          >
            {ws.owner}
          </span>
        )}

        {ws.shutdown_at && (
          <span>
            <span style={{ color: theme.colors.text }}>Timer:</span>{' '}
            {ws.shutdown_at}
          </span>
        )}

        {ws.last_accessed && (
          <span>
            <span style={{ color: theme.colors.text }}>Last accessed:</span>{' '}
            {ws.last_accessed}
          </span>
        )}

        {ws.expiry_warning && (
          <span style={{ color: theme.colors.warning }}>
            {ws.expiry_warning}
          </span>
        )}
      </div>

      {/* Actions */}
      <div
        style={{
          display: 'flex',
          gap: theme.spacing.sm,
          marginTop: theme.spacing.xs,
          flexWrap: 'wrap',
        }}
      >
        {!ws.running && !ws.creating && (
          <ActionButton
            label="Start"
            color={theme.colors.success}
            onClick={() => fire('start')}
          />
        )}

        {ws.running && (
          <>
            <ActionButton
              label="Stop"
              color={theme.colors.warning}
              onClick={() => fire('stop')}
            />
            <ActionButton
              label="Terminal"
              color={theme.colors.primary}
              onClick={() => fire('terminal')}
            />
          </>
        )}

        <ActionButton
          label="Rebuild"
          color={theme.colors.primary}
          onClick={() => fire('rebuild')}
        />

        <ActionButton
          label="Delete"
          color={theme.colors.danger}
          onClick={() => fire('delete')}
        />
      </div>
    </div>
  )
}
