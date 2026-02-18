/**
 * Environment configuration for the WorkspaceKit web server.
 *
 * All values can be overridden via environment variables. Sensible defaults
 * are provided so the dashboard can start without any extra config during
 * development.
 */

import crypto from 'node:crypto'

const DEFAULT_SECRET = 'workspacekit-secret-change-me'

function resolveSessionSecret(): string {
  const envSecret = process.env.SESSION_SECRET
  if (envSecret) {
    return envSecret
  }
  console.warn(
    '[config] WARNING: SESSION_SECRET is not set. ' +
    'Using default secret. Set SESSION_SECRET in your environment for production use.',
  )
  return DEFAULT_SECRET
}

export const config = {
  /** Port the dashboard listens on. */
  port: Number(process.env.DASHBOARD_PORT || '3000'),

  /** Kubernetes namespace where workspace resources are created. */
  namespace: process.env.DASHBOARD_NAMESPACE || 'workspacekit',

  /** Default container image for new workspaces when devcontainer.json is absent. */
  defaultImage:
    process.env.DASHBOARD_DEFAULT_IMAGE ||
    'mcr.microsoft.com/devcontainers/base:ubuntu',

  /** Path to OpenVSCode Server inside the container image. */
  openvscodePath: process.env.OPENVSCODE_PATH || '/opt/openvscode-server',

  /** Default PVC size for new workspaces. */
  diskSize: process.env.DASHBOARD_DISK_SIZE || '50Gi',

  /** Path to a JSON file with user credentials. Empty = fall back to env vars. */
  usersFile: process.env.DASHBOARD_USERS_FILE || '',

  /** Default admin username (used when usersFile is not set). */
  authUser: process.env.DASHBOARD_USER || 'admin',

  /** Default admin password (used when usersFile is not set). */
  authPass: process.env.DASHBOARD_PASS || 'changeme',

  /** Secret used to sign session cookies. Auto-generated if not configured. */
  sessionSecret: resolveSessionSecret(),
} as const
