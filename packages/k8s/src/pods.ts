import * as k8s from '@kubernetes/client-node'
import type { Resources } from '@workspacekit/types'
import { coreV1, exec, kubeConfig, namespace } from './client.js'
import type { Writable, Readable } from 'node:stream'

const MANAGED_BY_LABEL = 'managed-by=workspacekit'

// ---------------------------------------------------------------------------
// Shell escape helper (Fix 1)
// ---------------------------------------------------------------------------

/**
 * Escapes a string for safe use in a POSIX shell single-quoted context.
 * Wraps in single quotes with internal quote escaping.
 */
function shellEscape(str: string): string {
  return "'" + str.replace(/'/g, "'\\''") + "'"
}

/**
 * Validates that a repo URL starts with a safe protocol.
 * Rejects anything that isn't https:// or git@.
 */
function validateRepoUrl(url: string): void {
  if (!url.startsWith('https://') && !url.startsWith('git@')) {
    throw new Error(`Invalid repo URL protocol: URL must start with https:// or git@`)
  }
}

/**
 * Lists all pods with the managed-by=workspacekit label.
 */
export async function listWorkspacePods(): Promise<k8s.V1Pod[]> {
  const response = await coreV1.listNamespacedPod({
    namespace,
    labelSelector: MANAGED_BY_LABEL,
  })
  return response.items
}

/**
 * Gets a single pod by name. Returns null if not found.
 */
export async function getPod(name: string): Promise<k8s.V1Pod | null> {
  try {
    return await coreV1.readNamespacedPod({ name, namespace })
  } catch (err: unknown) {
    if (isHttpError(err) && err.code === 404) {
      return null
    }
    throw err
  }
}

/**
 * Creates a pod from the given spec.
 */
export async function createPod(spec: k8s.V1Pod): Promise<k8s.V1Pod> {
  return await coreV1.createNamespacedPod({
    namespace,
    body: spec,
  })
}

/**
 * Deletes a pod by name with an optional grace period (default 30s).
 */
export async function deletePod(name: string, gracePeriod = 30): Promise<void> {
  try {
    await coreV1.deleteNamespacedPod({
      name,
      namespace,
      gracePeriodSeconds: gracePeriod,
    })
  } catch (err: unknown) {
    if (isHttpError(err) && err.code === 404) {
      return
    }
    throw err
  }
}

/**
 * Patches pod annotations using a merge patch via raw k8s API call.
 * The high-level client defaults to application/json-patch+json which
 * expects an array of operations. We need application/merge-patch+json.
 */
export async function patchPodAnnotations(
  name: string,
  annotations: Record<string, string>,
): Promise<k8s.V1Pod> {
  return await mergePatchPod(name, { metadata: { annotations } })
}

/**
 * Removes annotations from a pod by setting them to null in a merge patch.
 */
export async function removePodAnnotations(
  name: string,
  annotationKeys: string[],
): Promise<k8s.V1Pod> {
  const annotations: Record<string, string | null> = {}
  for (const key of annotationKeys) {
    annotations[key] = null
  }
  return await mergePatchPod(name, { metadata: { annotations } })
}

/**
 * Performs a merge-patch on a pod using the raw k8s API.
 * This bypasses the client-node's default content-type of json-patch+json.
 */
async function mergePatchPod(name: string, body: object): Promise<k8s.V1Pod> {
  const cluster = kubeConfig.getCurrentCluster()
  if (!cluster) throw new Error('No active cluster')

  const url = `${cluster.server}/api/v1/namespaces/${namespace}/pods/${name}`
  const opts: Record<string, unknown> = {}
  await kubeConfig.applyToFetchOptions(opts)

  const headers = (opts.headers ?? {}) as Record<string, string>
  headers['Content-Type'] = 'application/merge-patch+json'
  headers['Accept'] = 'application/json'

  const response = await fetch(url, {
    method: 'PATCH',
    headers,
    body: JSON.stringify(body),
    ...(opts.agent ? { agent: opts.agent } : {}),
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`PATCH ${name} failed (${response.status}): ${text}`)
  }

  return await response.json() as k8s.V1Pod
}

/**
 * Extracts resource requests and limits from the first container in a pod.
 */
export function getContainerResources(pod: k8s.V1Pod): Resources {
  const container = pod.spec?.containers?.[0]
  return {
    req_cpu: container?.resources?.requests?.['cpu'] ?? '',
    req_mem: container?.resources?.requests?.['memory'] ?? '',
    lim_cpu: container?.resources?.limits?.['cpu'] ?? '',
    lim_mem: container?.resources?.limits?.['memory'] ?? '',
  }
}

/**
 * Returns true if the pod is managed by workspacekit.
 */
export function isDirectWorkspace(pod: k8s.V1Pod): boolean {
  return pod.metadata?.labels?.['managed-by'] === 'workspacekit'
}

/**
 * Gets the workspace name from pod labels or parses it from volume mounts.
 */
export function getWorkspaceName(pod: k8s.V1Pod): string {
  const labelName = pod.metadata?.labels?.['workspace-name']
  if (labelName) {
    return labelName
  }

  // Fallback: parse from volume mounts
  const mounts = pod.spec?.containers?.[0]?.volumeMounts ?? []
  for (const mount of mounts) {
    if (mount.mountPath?.startsWith('/workspace/')) {
      return mount.mountPath.replace('/workspace/', '')
    }
  }

  return pod.metadata?.name ?? ''
}

/**
 * Gets the workspace UID from pod labels.
 */
export function getWorkspaceUid(pod: k8s.V1Pod): string {
  return pod.metadata?.labels?.['workspace-uid'] ?? ''
}

/**
 * Returns true if the pod is Running and at least one container is ready.
 */
export function isPodReady(pod: k8s.V1Pod): boolean {
  if (pod.status?.phase !== 'Running') {
    return false
  }
  const statuses = pod.status?.containerStatuses ?? []
  return statuses.some((s) => s.ready === true)
}

export interface DevcontainerFeature {
  /** OCI repo path, e.g. "devcontainers/features/node" */
  repo: string
  /** OCI tag, e.g. "1" */
  tag: string
  /** Feature options as uppercase env vars, e.g. { VERSION: "latest" } */
  options: Record<string, string>
}

export interface BuildPodSpecOptions {
  name: string
  uid: string
  repoUrl: string
  image: string
  resources: Resources
  postCreateCmd?: string
  features?: DevcontainerFeature[]
  openvscodePath?: string
  namespace?: string
}

/**
 * Shell helper function that fetches and installs a devcontainer feature
 * from ghcr.io using the OCI registry API.
 */
const FEATURE_INSTALL_FN = `
install_feature() {
  REPO="$1"; TAG="$2"; shift 2
  echo "==> Installing devcontainer feature: $REPO:$TAG"
  TOKEN=$(curl -sSL "https://ghcr.io/token?scope=repository:\${REPO}:pull&service=ghcr.io" | python3 -c "import sys,json;print(json.load(sys.stdin)['token'])")
  DIGEST=$(curl -sSL -H "Authorization: Bearer $TOKEN" -H "Accept: application/vnd.oci.image.manifest.v1+json" "https://ghcr.io/v2/\${REPO}/manifests/\${TAG}" | python3 -c "import sys,json;m=json.load(sys.stdin);print(m['layers'][0]['digest'])")
  mkdir -p /tmp/dcf
  curl -sSL -H "Authorization: Bearer $TOKEN" "https://ghcr.io/v2/\${REPO}/blobs/$DIGEST" | tar xf - -C /tmp/dcf
  while [ $# -gt 0 ]; do export "$1"; shift; done
  chmod +x /tmp/dcf/install.sh
  cd /tmp/dcf && ./install.sh
  cd / && rm -rf /tmp/dcf
  echo "==> Done: $REPO:$TAG"
}
`.trim()

/**
 * Generates the shell startup script for the dev container.
 * Installs devcontainer features, runs postCreateCommand, then starts openvscode-server.
 */
function buildStartupScript(opts: {
  features: DevcontainerFeature[]
  postCreateCmd?: string
  openvscodePath: string
  uid: string
}): string {
  const lines: string[] = ['set -e']

  if (opts.features.length > 0) {
    // Only include the install function if there are features to install
    // Use a marker file to skip reinstalls on container restart
    lines.push('if [ ! -f /tmp/.dcf-installed ]; then')
    // Set standard devcontainer feature env vars
    lines.push('export USERNAME=root')
    lines.push('export _REMOTE_USER=root')
    lines.push('export _REMOTE_USER_HOME=/root')
    lines.push('export _CONTAINER_USER=root')
    lines.push('export _CONTAINER_USER_HOME=/root')
    lines.push(FEATURE_INSTALL_FN)

    for (const f of opts.features) {
      const optArgs = Object.entries(f.options)
        .map(([k, v]) => `${k}=${shellEscape(v)}`)
        .join(' ')
      lines.push(`install_feature ${shellEscape(f.repo)} ${shellEscape(f.tag)}${optArgs ? ' ' + optArgs : ''}`)
    }

    lines.push('touch /tmp/.dcf-installed')
    lines.push('fi')
    // Source shell profiles so feature-installed tools (bun, node, nvm, etc.) are on PATH
    lines.push('. /etc/bash.bashrc 2>/dev/null || true')
    lines.push('. /etc/profile 2>/dev/null || true')
    lines.push('. ~/.bashrc 2>/dev/null || true')
  }

  if (opts.postCreateCmd) {
    lines.push('if [ ! -f /tmp/.postcreate-done ]; then')
    lines.push(opts.postCreateCmd)
    lines.push('touch /tmp/.postcreate-done')
    lines.push('fi')
  }

  lines.push(`exec ${opts.openvscodePath}/bin/openvscode-server --host 0.0.0.0 --port 10800 --connection-token ${opts.uid}`)

  return lines.join('\n')
}

/**
 * Builds a V1Pod spec for a workspacekit workspace.
 */
export function buildPodSpec(options: BuildPodSpecOptions): k8s.V1Pod {
  const {
    name,
    uid,
    repoUrl,
    image,
    resources,
    postCreateCmd,
    features = [],
    openvscodePath = '/opt/openvscode',
    namespace: ns = namespace,
  } = options

  // Validate repo URL protocol (Fix 1)
  if (repoUrl) {
    validateRepoUrl(repoUrl)
  }

  // Shell-escape the repo URL to prevent command injection (Fix 1)
  const safeRepoUrl = shellEscape(repoUrl)

  // Build container startup command
  const startupCmd = buildStartupScript({
    features,
    postCreateCmd,
    openvscodePath,
    uid,
  })

  const pod: k8s.V1Pod = {
    apiVersion: 'v1',
    kind: 'Pod',
    metadata: {
      name: `ws-${uid}`,
      namespace: ns,
      labels: {
        'managed-by': 'workspacekit',
        'workspace-name': name,
        'workspace-uid': uid,
      },
    },
    spec: {
      initContainers: [
        {
          name: 'git-clone',
          image: 'alpine/git',
          command: ['sh', '-c'],
          args: [
            [
              // If GH_TOKEN is set, configure git to use it for github.com HTTPS URLs
              'if [ -n "$GH_TOKEN" ]; then git config --global url."https://x-access-token:${GH_TOKEN}@github.com/".insteadOf "https://github.com/"; fi',
              `if [ ! -d /workspace/${name}/.git ]; then git clone ${safeRepoUrl} /workspace/${name}; fi`,
            ].join(' && '),
          ],
          envFrom: [
            {
              secretRef: {
                name: 'gh-credentials',
                optional: true,
              },
            },
          ],
          volumeMounts: [
            {
              name: 'workspace',
              mountPath: '/workspace',
            },
          ],
        },
      ],
      containers: [
        {
          name: 'dev',
          image,
          command: ['bash', '-c'],
          args: [startupCmd],
          ports: [
            {
              containerPort: 10800,
              name: 'openvscode',
            },
          ],
          resources: {
            requests: {
              cpu: resources.req_cpu,
              memory: resources.req_mem,
            },
            limits: {
              cpu: resources.lim_cpu,
              memory: resources.lim_mem,
            },
          },
          volumeMounts: [
            {
              name: 'workspace',
              mountPath: '/workspace',
            },
            {
              name: 'openvscode',
              mountPath: openvscodePath,
              readOnly: true, // Fix 16: read-only hostPath mount
            },
          ],
          envFrom: [
            {
              secretRef: {
                name: 'gh-credentials',
                optional: true,
              },
            },
          ],
          workingDir: `/workspace/${name}`,
        },
      ],
      volumes: [
        {
          name: 'workspace',
          persistentVolumeClaim: {
            claimName: `pvc-${uid}`,
          },
        },
        {
          name: 'openvscode',
          hostPath: {
            path: openvscodePath,
            type: 'Directory',
          },
        },
      ],
      restartPolicy: 'Never',
    },
  }

  // postCreateCmd runs in the main container startup script (after feature installation)
  // so it has access to tools installed by devcontainer features (e.g. bun, node)

  return pod
}

/**
 * Executes a command in a running pod's container.
 */
export async function execInPod(
  podName: string,
  command: string[],
  stdin: Readable | null,
  stdout: Writable,
  stderr: Writable,
  container = 'dev',
): Promise<any> {
  return exec.exec(
    namespace,
    podName,
    container,
    command,
    stdout,
    stderr,
    stdin,
    false, // tty
  )
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isHttpError(err: unknown): err is { code: number } {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    typeof (err as Record<string, unknown>).code === 'number'
  )
}
