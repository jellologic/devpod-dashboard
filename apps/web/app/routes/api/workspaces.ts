import { createAPIFileRoute } from '@tanstack/react-start/api'
import { z } from 'zod'
import {
  CreateWorkspaceInputSchema,
  StopWorkspaceInputSchema,
  StartWorkspaceInputSchema,
  DeleteWorkspaceInputSchema,
  RebuildWorkspaceInputSchema,
  ResizeWorkspaceInputSchema,
  DuplicateWorkspaceInputSchema,
  SetTimerInputSchema,
} from '@workspacekit/types'
import {
  createPod,
  deletePod,
  getPod,
  getSavedPodSpec,
  savePodSpec,
  saveWorkspaceMeta,
  patchPodAnnotations,
  buildPodSpec,
  buildPvcSpec,
  buildServiceSpec,
  createPvc,
  createService,
  deletePvc,
  deleteService,
  getWorkspaceDefaults,
  getWorkspaceMeta,
  namespace,
} from '@workspacekit/k8s'
import { config } from '~/lib/config'
import { generateUid, repoToName, sanitizeName } from '~/lib/utils'
import { requireAuth, requireCsrf, requireRole, sanitizeError } from '~/server/auth'
import { appendCreationLog } from '~/server/logs'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function ok(message: string): Response {
  return json({ ok: true, message })
}

function fail(message: string, status = 400): Response {
  return json({ ok: false, message }, status)
}

// ---------------------------------------------------------------------------
// Action dispatcher schema
// ---------------------------------------------------------------------------

const ActionSchema = z.object({
  action: z.enum([
    'create',
    'stop',
    'start',
    'delete',
    'rebuild',
    'resize',
    'duplicate',
    'set-timer',
  ]),
})

// ---------------------------------------------------------------------------
// Route
// ---------------------------------------------------------------------------

export const APIRoute = createAPIFileRoute('/api/workspaces')({
  POST: async ({ request }) => {
    try {
      const session = requireAuth(request)
      requireCsrf(request)

      let body: unknown
      try {
        body = await request.json()
      } catch {
        return fail('Invalid JSON body')
      }
      const { action } = ActionSchema.parse(body)

      // RBAC: mutations require admin, read ops allow admin+user
      const adminOnly = ['create', 'delete', 'rebuild', 'resize', 'duplicate']
      if (adminOnly.includes(action)) {
        requireRole(session, 'admin')
      } else {
        requireRole(session, 'admin', 'user')
      }

      switch (action) {
        case 'create':
          return await handleCreate(body)
        case 'stop':
          return await handleStop(body)
        case 'start':
          return await handleStart(body)
        case 'delete':
          return await handleDelete(body)
        case 'rebuild':
          return await handleRebuild(body)
        case 'resize':
          return await handleResize(body)
        case 'duplicate':
          return await handleDuplicate(body)
        case 'set-timer':
          return await handleSetTimer(body)
        default:
          return fail(`Unknown action: ${action}`)
      }
    } catch (err) {
      if (err instanceof Response) throw err
      if (err instanceof z.ZodError) {
        return fail(`Validation error: ${err.errors.map((e) => e.message).join(', ')}`)
      }
      const message = err instanceof Error ? err.message : 'Internal server error'
      console.error('[api/workspaces] Error:', err)
      return fail(sanitizeError(message), 500)
    }
  },
})

// ---------------------------------------------------------------------------
// Action handlers
// ---------------------------------------------------------------------------

async function handleCreate(body: unknown): Promise<Response> {
  const input = CreateWorkspaceInputSchema.parse(body)

  const uid = generateUid()
  const name = input.name
    ? sanitizeName(input.name)
    : repoToName(input.repo)
  const owner = input.owner ?? ''

  // Fetch workspace defaults for resource requests/limits
  const defaults = await getWorkspaceDefaults()
  const resources = {
    req_cpu: input.req_cpu || defaults.req_cpu || '500m',
    req_mem: input.req_mem || defaults.req_mem || '512Mi',
    lim_cpu: input.lim_cpu || defaults.lim_cpu || '2',
    lim_mem: input.lim_mem || defaults.lim_mem || '2Gi',
  }
  const image = input.image || config.defaultImage

  // Create PVC
  const pvcSpec = buildPvcSpec(name, uid, config.diskSize)
  await createPvc(pvcSpec)

  // Build and create pod
  const podSpec = buildPodSpec({
    name,
    uid,
    repoUrl: input.repo,
    image,
    resources,
    openvscodePath: config.openvscodePath,
  })

  // Add owner annotation
  if (owner) {
    podSpec.metadata = podSpec.metadata ?? {}
    podSpec.metadata.annotations = {
      ...podSpec.metadata.annotations,
      'wsk/owner': owner,
    }
  }

  appendCreationLog(name, `Creating workspace "${name}" (uid: ${uid})`)
  appendCreationLog(name, `Repo: ${input.repo}`)

  await createPod(podSpec)

  // Create NodePort service
  const svcSpec = buildServiceSpec(name, uid)
  await createService(svcSpec)

  // Save pod spec and metadata for rebuilds
  await savePodSpec(uid, name, podSpec)
  await saveWorkspaceMeta(name, uid, input.repo, image, '')

  appendCreationLog(name, 'Workspace creation complete')

  return ok(`Workspace "${name}" created successfully`)
}

async function handleStop(body: unknown): Promise<Response> {
  const input = StopWorkspaceInputSchema.parse(body)

  const pod = await getPod(input.pod)
  if (!pod) {
    return fail(`Pod "${input.pod}" not found`, 404)
  }

  await deletePod(input.pod, 30)

  return ok(`Workspace pod "${input.pod}" stopped`)
}

async function handleStart(body: unknown): Promise<Response> {
  const input = StartWorkspaceInputSchema.parse(body)

  // Look up the saved pod spec via the pod name to find the UID
  // The pod name is in the format ws-{uid}
  const uid = input.pod.replace(/^ws-/, '')
  const savedSpec = await getSavedPodSpec(uid)

  if (!savedSpec) {
    return fail(
      `No saved spec found for pod "${input.pod}". Cannot restart.`,
      404,
    )
  }

  // Re-create the pod from the saved spec
  await createPod(savedSpec)

  return ok(`Workspace pod "${input.pod}" started`)
}

async function handleDelete(body: unknown): Promise<Response> {
  const input = DeleteWorkspaceInputSchema.parse(body)

  // Delete pod (ignore if already gone)
  await deletePod(input.pod, 0)

  // Delete service
  await deleteService(`svc-${input.uid}`)

  // Delete PVC
  await deletePvc(`pvc-${input.uid}`)

  return ok(`Workspace "${input.name}" deleted`)
}

async function handleRebuild(body: unknown): Promise<Response> {
  const input = RebuildWorkspaceInputSchema.parse(body)

  // Delete the existing pod
  await deletePod(input.pod, 0)

  // Fetch defaults
  const defaults = await getWorkspaceDefaults()
  const resources = {
    req_cpu: defaults.req_cpu || '500m',
    req_mem: defaults.req_mem || '512Mi',
    lim_cpu: defaults.lim_cpu || '2',
    lim_mem: defaults.lim_mem || '2Gi',
  }

  // Get existing metadata for image / post-create command
  const meta = await getWorkspaceMeta(input.name)
  const image = meta?.data?.image || config.defaultImage
  const postCreateCmd = meta?.data?.post_create_cmd || ''

  // Build and create a new pod
  const podSpec = buildPodSpec({
    name: input.name,
    uid: input.uid,
    repoUrl: input.repo,
    image,
    resources,
    postCreateCmd,
    openvscodePath: config.openvscodePath,
  })

  if (input.owner) {
    podSpec.metadata = podSpec.metadata ?? {}
    podSpec.metadata.annotations = {
      ...podSpec.metadata.annotations,
      'wsk/owner': input.owner,
    }
  }

  appendCreationLog(input.name, `Rebuilding workspace "${input.name}"`)
  await createPod(podSpec)
  await savePodSpec(input.uid, input.name, podSpec)
  appendCreationLog(input.name, 'Rebuild complete')

  return ok(`Workspace "${input.name}" rebuilt`)
}

async function handleResize(body: unknown): Promise<Response> {
  const input = ResizeWorkspaceInputSchema.parse(body)

  // Update the saved pod spec with new resource values
  const savedSpec = await getSavedPodSpec(input.uid)
  if (!savedSpec) {
    return fail(`No saved spec for uid "${input.uid}"`, 404)
  }

  const container = savedSpec.spec?.containers?.[0]
  if (container) {
    container.resources = {
      requests: {
        cpu: input.req_cpu,
        memory: input.req_mem,
      },
      limits: {
        cpu: input.lim_cpu,
        memory: input.lim_mem,
      },
    }
  }

  const workspaceName =
    savedSpec.metadata?.labels?.['workspace-name'] ?? ''
  await savePodSpec(input.uid, workspaceName, savedSpec)

  // Annotate the running pod so the UI reflects the pending resize
  await patchPodAnnotations(input.pod, {
    'wsk/resize-pending': 'true',
    'wsk/req-cpu': input.req_cpu,
    'wsk/req-mem': input.req_mem,
    'wsk/lim-cpu': input.lim_cpu,
    'wsk/lim-mem': input.lim_mem,
  })

  return ok(
    `Resize saved for "${input.pod}". Restart the workspace to apply.`,
  )
}

async function handleDuplicate(body: unknown): Promise<Response> {
  const input = DuplicateWorkspaceInputSchema.parse(body)

  const uid = generateUid()
  const name = sanitizeName(input.new_name)

  // Get source workspace metadata
  const meta = await getWorkspaceMeta(input.source_name)
  const image = meta?.data?.image || config.defaultImage
  const postCreateCmd = meta?.data?.post_create_cmd || ''

  const defaults = await getWorkspaceDefaults()
  const resources = {
    req_cpu: defaults.req_cpu || '500m',
    req_mem: defaults.req_mem || '512Mi',
    lim_cpu: defaults.lim_cpu || '2',
    lim_mem: defaults.lim_mem || '2Gi',
  }

  // Create PVC for the new workspace
  const pvcSpec = buildPvcSpec(name, uid, config.diskSize)
  await createPvc(pvcSpec)

  // Build and create pod
  const podSpec = buildPodSpec({
    name,
    uid,
    repoUrl: input.repo,
    image,
    resources,
    postCreateCmd,
    openvscodePath: config.openvscodePath,
  })

  appendCreationLog(name, `Duplicating "${input.source_name}" as "${name}"`)
  await createPod(podSpec)

  // Create service
  const svcSpec = buildServiceSpec(name, uid)
  await createService(svcSpec)

  // Save metadata
  await savePodSpec(uid, name, podSpec)
  await saveWorkspaceMeta(name, uid, input.repo, image, postCreateCmd)
  appendCreationLog(name, 'Duplication complete')

  return ok(`Workspace "${name}" created from "${input.source_name}"`)
}

async function handleSetTimer(body: unknown): Promise<Response> {
  const input = SetTimerInputSchema.parse(body)

  if (input.hours <= 0) {
    // Clear the shutdown timer
    await patchPodAnnotations(input.pod, {
      'wsk/shutdown-at': '',
      'wsk/shutdown-hours': '0',
    })
    return ok(`Shutdown timer cleared for "${input.pod}"`)
  }

  const shutdownAt = new Date(
    Date.now() + input.hours * 3600 * 1000,
  ).toISOString()

  await patchPodAnnotations(input.pod, {
    'wsk/shutdown-at': shutdownAt,
    'wsk/shutdown-hours': String(input.hours),
  })

  return ok(
    `Shutdown timer set for "${input.pod}" in ${input.hours} hour(s)`,
  )
}
