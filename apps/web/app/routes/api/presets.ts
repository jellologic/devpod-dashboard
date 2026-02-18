import { createAPIFileRoute } from '@tanstack/react-start/api'
import { z } from 'zod'
import {
  SavePresetInputSchema,
  DeletePresetInputSchema,
  CreateFromPresetInputSchema,
} from '@workspacekit/types'
import type { Preset } from '@workspacekit/types'
import {
  getPresets,
  savePresets,
  getWorkspaceDefaults,
  buildPodSpec,
  buildPvcSpec,
  buildServiceSpec,
  createPod,
  createPvc,
  createService,
  savePodSpec,
  saveWorkspaceMeta,
} from '@workspacekit/k8s'
import { config } from '~/lib/config'
import { generateUid, sanitizeName } from '~/lib/utils'
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
// POST action schema
// ---------------------------------------------------------------------------

const PresetActionSchema = z.object({
  action: z.enum(['save', 'delete', 'create-from-preset']),
})

// ---------------------------------------------------------------------------
// Route
// ---------------------------------------------------------------------------

export const APIRoute = createAPIFileRoute('/api/presets')({
  GET: async ({ request }) => {
    try {
      requireAuth(request)
      const presets = await getPresets()
      return json(presets)
    } catch (err) {
      if (err instanceof Response) throw err
      const message =
        err instanceof Error ? err.message : 'Internal server error'
      console.error('[api/presets] GET error:', err)
      return fail(sanitizeError(message), 500)
    }
  },

  POST: async ({ request }) => {
    try {
      const session = requireAuth(request)
      requireCsrf(request)
      requireRole(session, 'admin')

      let body: unknown
      try {
        body = await request.json()
      } catch {
        return fail('Invalid JSON body')
      }
      const { action } = PresetActionSchema.parse(body)

      switch (action) {
        case 'save':
          return await handleSavePreset(body)
        case 'delete':
          return await handleDeletePreset(body)
        case 'create-from-preset':
          return await handleCreateFromPreset(body)
        default:
          return fail(`Unknown action: ${action}`)
      }
    } catch (err) {
      if (err instanceof Response) throw err
      if (err instanceof z.ZodError) {
        return fail(
          `Validation error: ${err.errors.map((e) => e.message).join(', ')}`,
        )
      }
      const message =
        err instanceof Error ? err.message : 'Internal server error'
      console.error('[api/presets] POST error:', err)
      return fail(sanitizeError(message), 500)
    }
  },
})

// ---------------------------------------------------------------------------
// Action handlers
// ---------------------------------------------------------------------------

async function handleSavePreset(body: unknown): Promise<Response> {
  const input = SavePresetInputSchema.parse(body)
  const presets = await getPresets()

  const newPreset: Preset = {
    id: generateUid(),
    name: input.name,
    description: input.description,
    repo_url: input.repo_url,
    req_cpu: input.req_cpu,
    req_mem: input.req_mem,
    lim_cpu: input.lim_cpu,
    lim_mem: input.lim_mem,
  }

  presets.push(newPreset)
  await savePresets(presets)

  return ok(`Preset "${input.name}" saved`)
}

async function handleDeletePreset(body: unknown): Promise<Response> {
  const input = DeletePresetInputSchema.parse(body)
  const presets = await getPresets()

  const filtered = presets.filter((p) => p.id !== input.id)
  if (filtered.length === presets.length) {
    return fail(`Preset "${input.id}" not found`, 404)
  }

  await savePresets(filtered)

  return ok(`Preset "${input.id}" deleted`)
}

async function handleCreateFromPreset(body: unknown): Promise<Response> {
  const input = CreateFromPresetInputSchema.parse(body)
  const presets = await getPresets()

  const preset = presets.find((p) => p.id === input.preset_id)
  if (!preset) {
    return fail(`Preset "${input.preset_id}" not found`, 404)
  }

  const uid = generateUid()
  const name = input.name
    ? sanitizeName(input.name)
    : sanitizeName(preset.name)

  const resources = {
    req_cpu: preset.req_cpu,
    req_mem: preset.req_mem,
    lim_cpu: preset.lim_cpu,
    lim_mem: preset.lim_mem,
  }

  // Create PVC
  const pvcSpec = buildPvcSpec(name, uid, config.diskSize)
  await createPvc(pvcSpec)

  // Build and create pod
  const podSpec = buildPodSpec({
    name,
    uid,
    repoUrl: preset.repo_url,
    image: config.defaultImage,
    resources,
    openvscodePath: config.openvscodePath,
  })

  appendCreationLog(name, `Creating workspace "${name}" from preset "${preset.name}"`)
  await createPod(podSpec)

  // Create service
  const svcSpec = buildServiceSpec(name, uid)
  await createService(svcSpec)

  // Save metadata
  await savePodSpec(uid, name, podSpec)
  await saveWorkspaceMeta(name, uid, preset.repo_url, config.defaultImage, '')
  appendCreationLog(name, 'Workspace creation from preset complete')

  return ok(`Workspace "${name}" created from preset "${preset.name}"`)
}
