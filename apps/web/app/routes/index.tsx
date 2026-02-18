import { createFileRoute, Link } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { useState, useCallback } from 'react'
import type { Workspace, SystemStats, Settings } from '@workspacekit/types'
import { humanBytes } from '~/lib/utils'
import { cn } from '~/lib/cn'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '~/components/ui/card'
import { Button } from '~/components/ui/button'
import { Badge } from '~/components/ui/badge'
import { Input } from '~/components/ui/input'
import { Label } from '~/components/ui/label'
import { Progress } from '~/components/ui/progress'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '~/components/ui/dialog'
import {
  Box,
  Cpu,
  HardDrive,
  MemoryStick,
  Play,
  Plus,
  Square,
  Trash2,
  Terminal,
  RotateCcw,
  GitBranch,
  User,
  X,
  ExternalLink,
} from 'lucide-react'

// ---------------------------------------------------------------------------
// Server functions
// ---------------------------------------------------------------------------

const fetchWorkspaces = createServerFn({ method: 'GET' }).handler(
  async (): Promise<Workspace[]> => {
    const { requireServerFnAuth } = await import('~/server/auth')
    await requireServerFnAuth()
    const { getWorkspaces } = await import('~/server/workspaces')
    return getWorkspaces()
  },
)

const fetchStats = createServerFn({ method: 'GET' }).handler(
  async (): Promise<SystemStats | null> => {
    const { requireServerFnAuth } = await import('~/server/auth')
    await requireServerFnAuth()
    const { getStats } = await import('~/server/stats')
    return getStats()
  },
)

const fetchSettings = createServerFn({ method: 'GET' }).handler(
  async (): Promise<Settings | null> => {
    const { requireServerFnAuth } = await import('~/server/auth')
    await requireServerFnAuth()
    const { getWorkspaceDefaults, getLimitRange, getResourceQuota } =
      await import('@workspacekit/k8s')
    const [defaults, limitrange, quota] = await Promise.all([
      getWorkspaceDefaults(),
      getLimitRange(),
      getResourceQuota(),
    ])
    return { provider: defaults, limitrange, quota }
  },
)

// ---------------------------------------------------------------------------
// Route
// ---------------------------------------------------------------------------

export const Route = createFileRoute('/')({
  loader: async () => {
    const [workspaces, stats, settings] = await Promise.all([
      fetchWorkspaces(),
      fetchStats(),
      fetchSettings(),
    ])
    return { workspaces, stats, settings }
  },
  component: DashboardPage,
})

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function statusColor(ws: Workspace) {
  if (ws.creating) return 'warning'
  if (ws.running) return 'default'
  if (ws.status === 'Failed' || ws.status === 'Error') return 'destructive'
  return 'secondary'
}

function statusLabel(ws: Workspace) {
  if (ws.creating) return 'Creating'
  if (ws.running) return 'Running'
  if (ws.status === 'Failed' || ws.status === 'Error') return ws.status
  return 'Stopped'
}

function formatResource(value: string | undefined) {
  if (!value || value === '0') return '-'
  return value
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

function DashboardPage() {
  const { workspaces, stats } = Route.useLoaderData()

  // --- Create form state ---
  const [formName, setFormName] = useState('')
  const [formRepo, setFormRepo] = useState('')
  const [formBranch, setFormBranch] = useState('main')
  const [formImage, setFormImage] = useState('')
  const [formReqCpu, setFormReqCpu] = useState('')
  const [formReqMem, setFormReqMem] = useState('')
  const [formLimCpu, setFormLimCpu] = useState('')
  const [formLimMem, setFormLimMem] = useState('')
  const [creating, setCreating] = useState(false)
  const [formError, setFormError] = useState('')
  const [dialogOpen, setDialogOpen] = useState(false)

  // --- Bulk selection ---
  const [selected, setSelected] = useState<Set<string>>(new Set())

  const toggleSelect = useCallback((name: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }, [])

  // --- Helpers ---
  const runningCount = workspaces.filter((w) => w.running).length

  // CPU & Memory stats
  const cpuPercent = stats?.cpu?.['system'] ?? 0
  const memPercent = stats && stats.mem.total > 0
    ? Math.round(((stats.mem.total - stats.mem.available) / stats.mem.total) * 100)
    : 0

  // --- Create workspace ---
  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    setFormError('')
    setCreating(true)
    try {
      const body: Record<string, string> = { repo: formRepo }
      if (formName) body.name = formName
      if (formImage) body.image = formImage
      if (formBranch) body.branch = formBranch
      if (formReqCpu) body.req_cpu = formReqCpu
      if (formReqMem) body.req_mem = formReqMem
      if (formLimCpu) body.lim_cpu = formLimCpu
      if (formLimMem) body.lim_mem = formLimMem

      const res = await fetch('/api/workspaces', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'workspacekit',
        },
        body: JSON.stringify({ action: 'create', ...body }),
      })
      if (!res.ok) {
        const data = await res
          .json()
          .catch(() => ({ message: 'Create failed' }))
        throw new Error(data.message || 'Create failed')
      }
      window.location.reload()
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setCreating(false)
    }
  }

  // --- Workspace card action handler ---
  const handleAction = useCallback(
    async (action: string, data: Record<string, string>) => {
      if (action === 'terminal') {
        window.location.href = `/workspace/${data.name}`
        return
      }
      if (action === 'delete') {
        if (
          !confirm(`Delete workspace "${data.name}"? This cannot be undone.`)
        ) {
          return
        }
      }
      try {
        await fetch('/api/workspaces', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Requested-With': 'workspacekit',
          },
          body: JSON.stringify({ action, ...data }),
        })
        window.location.reload()
      } catch {
        // Silently fail; user can retry
      }
    },
    [],
  )

  // --- Bulk actions ---
  const handleBulkAction = async (action: 'start' | 'stop' | 'delete') => {
    if (selected.size === 0) return
    if (action === 'delete') {
      if (
        !confirm(
          `Delete ${selected.size} workspace(s)? This cannot be undone.`,
        )
      ) {
        return
      }
    }

    const targets = workspaces
      .filter((w) => selected.has(w.name))
      .map((w) => ({ name: w.name, pod: w.pod, uid: w.uid }))

    try {
      await fetch('/api/bulk', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'workspacekit',
        },
        body: JSON.stringify({ action, workspaces: targets }),
      })
      setSelected(new Set())
      window.location.reload()
    } catch {
      // Silently fail
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Page heading */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-foreground">Workspaces</h1>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="h-4 w-4" />
              New Workspace
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>Create Workspace</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleCreate} className="flex flex-col gap-4">
              {formError && (
                <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                  {formError}
                </div>
              )}

              <div className="grid grid-cols-2 gap-4">
                <div className="flex flex-col gap-2">
                  <Label>Workspace Name</Label>
                  <Input
                    value={formName}
                    onChange={(e) => setFormName(e.target.value)}
                    placeholder="my-workspace"
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <Label>Repository URL</Label>
                  <Input
                    value={formRepo}
                    onChange={(e) => setFormRepo(e.target.value)}
                    placeholder="https://github.com/org/repo.git"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="flex flex-col gap-2">
                  <Label>Branch</Label>
                  <Input
                    value={formBranch}
                    onChange={(e) => setFormBranch(e.target.value)}
                    placeholder="main"
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <Label>Image (optional)</Label>
                  <Input
                    value={formImage}
                    onChange={(e) => setFormImage(e.target.value)}
                    placeholder="mcr.microsoft.com/devcontainers/base:ubuntu"
                  />
                </div>
              </div>

              <div className="grid grid-cols-4 gap-3">
                <div className="flex flex-col gap-2">
                  <Label className="text-xs">CPU Request</Label>
                  <Input
                    value={formReqCpu}
                    onChange={(e) => setFormReqCpu(e.target.value)}
                    placeholder="500m"
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <Label className="text-xs">CPU Limit</Label>
                  <Input
                    value={formLimCpu}
                    onChange={(e) => setFormLimCpu(e.target.value)}
                    placeholder="2000m"
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <Label className="text-xs">Mem Request</Label>
                  <Input
                    value={formReqMem}
                    onChange={(e) => setFormReqMem(e.target.value)}
                    placeholder="512Mi"
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <Label className="text-xs">Mem Limit</Label>
                  <Input
                    value={formLimMem}
                    onChange={(e) => setFormLimMem(e.target.value)}
                    placeholder="4Gi"
                  />
                </div>
              </div>

              <div className="flex justify-end">
                <Button type="submit" disabled={creating}>
                  {creating ? 'Creating...' : 'Create Workspace'}
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {/* Stats cards row */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Card className="border-black/[0.06] bg-white/72 shadow-[var(--shadow-card)] backdrop-blur-xl">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Workspaces
            </CardTitle>
            <Box className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{workspaces.length}</div>
            <p className="mt-1 text-xs text-muted-foreground">
              Total workspaces
            </p>
          </CardContent>
        </Card>

        <Card className="border-black/[0.06] bg-white/72 shadow-[var(--shadow-card)] backdrop-blur-xl">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Running
            </CardTitle>
            <Play className="h-4 w-4 text-success" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-success">
              {runningCount}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Active workspaces
            </p>
          </CardContent>
        </Card>

        <Card className="border-black/[0.06] bg-white/72 shadow-[var(--shadow-card)] backdrop-blur-xl">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              CPU
            </CardTitle>
            <Cpu className="h-4 w-4 text-primary" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">
              {Math.round(cpuPercent)}%
            </div>
            <Progress
              value={cpuPercent}
              className="mt-2 h-1.5"
            />
            {stats && (
              <p className="mt-1 text-xs text-muted-foreground">
                {stats.ncpu} cores
              </p>
            )}
          </CardContent>
        </Card>

        <Card className="border-black/[0.06] bg-white/72 shadow-[var(--shadow-card)] backdrop-blur-xl">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Memory
            </CardTitle>
            <MemoryStick className="h-4 w-4 text-warning" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{memPercent}%</div>
            <Progress
              value={memPercent}
              className="mt-2 h-1.5"
            />
            {stats && (
              <p className="mt-1 text-xs text-muted-foreground">
                {humanBytes(stats.mem.total - stats.mem.available)} /{' '}
                {humanBytes(stats.mem.total)}
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Bulk action bar */}
      {selected.size > 0 && (
        <div className="flex items-center gap-3 rounded-xl border border-black/[0.06] bg-white/72 px-4 py-3 backdrop-blur-xl">
          <span className="text-sm text-muted-foreground">
            {selected.size} selected
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => handleBulkAction('start')}
            className="text-success border-success/30 hover:bg-success/10"
          >
            <Play className="h-3 w-3" />
            Start All
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => handleBulkAction('stop')}
            className="text-warning border-warning/30 hover:bg-warning/10"
          >
            <Square className="h-3 w-3" />
            Stop All
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => handleBulkAction('delete')}
            className="text-destructive border-destructive/30 hover:bg-destructive/10"
          >
            <Trash2 className="h-3 w-3" />
            Delete Selected
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setSelected(new Set())}
          >
            <X className="h-3 w-3" />
            Clear
          </Button>
        </div>
      )}

      {/* Workspace list */}
      {workspaces.length === 0 ? (
        <Card className="border-black/[0.06] bg-white/72 shadow-[var(--shadow-card)] backdrop-blur-xl">
          <CardContent className="py-12 text-center">
            <Box className="mx-auto mb-3 h-10 w-10 text-muted-foreground/40" />
            <p className="text-muted-foreground">
              No workspaces found. Click "New Workspace" to create one.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          {workspaces.map((ws) => (
            <Card
              key={ws.name}
              className={cn(
                'relative border-black/[0.06] bg-white/72 shadow-[var(--shadow-card)] backdrop-blur-xl transition-shadow hover:shadow-[var(--shadow-glass)]',
                selected.has(ws.name) && 'ring-2 ring-primary/30',
              )}
            >
              {/* Selection checkbox */}
              <label className="absolute right-4 top-4 z-10 cursor-pointer">
                <input
                  type="checkbox"
                  checked={selected.has(ws.name)}
                  onChange={() => toggleSelect(ws.name)}
                  className="h-4 w-4 rounded border-border accent-primary"
                />
              </label>

              <CardHeader className="pb-3">
                <div className="flex items-center gap-3">
                  <Link
                    to="/workspace/$name"
                    params={{ name: ws.name }}
                    className="text-base font-semibold text-foreground hover:text-primary hover:no-underline"
                  >
                    {ws.name}
                  </Link>
                  <Badge variant={statusColor(ws) as 'default' | 'secondary' | 'destructive'}>
                    {statusLabel(ws)}
                  </Badge>
                </div>
              </CardHeader>

              <CardContent className="flex flex-col gap-3">
                {/* Meta info row */}
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                  {ws.repo && (
                    <span className="flex items-center gap-1">
                      <GitBranch className="h-3 w-3" />
                      {ws.repo.replace(/^https?:\/\/(github\.com\/)?/, '').replace(/\.git$/, '')}
                      {ws.branch && (
                        <span className="text-foreground/60">:{ws.branch}</span>
                      )}
                      {ws.dirty && (
                        <span className="text-warning">(dirty)</span>
                      )}
                    </span>
                  )}
                  {ws.owner && (
                    <span className="flex items-center gap-1">
                      <User className="h-3 w-3" />
                      {ws.owner}
                    </span>
                  )}
                </div>

                {/* Resource usage row */}
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                  {ws.resources && (
                    <>
                      <span>
                        CPU: {formatResource(ws.resources.req_cpu)}/
                        {formatResource(ws.resources.lim_cpu)}
                      </span>
                      <span>
                        Mem: {formatResource(ws.resources.req_mem)}/
                        {formatResource(ws.resources.lim_mem)}
                      </span>
                    </>
                  )}
                  {ws.usage && (
                    <>
                      <span className="text-foreground/60">|</span>
                      <span>
                        Usage: {ws.usage.cpu} CPU, {ws.usage.memory} Mem
                      </span>
                    </>
                  )}
                  {ws.port > 0 && <span>Port: {ws.port}</span>}
                </div>

                {/* Warning rows */}
                {ws.expiry_warning && (
                  <p className="text-xs text-warning">{ws.expiry_warning}</p>
                )}

                {/* Action buttons */}
                <div className="flex flex-wrap gap-2 pt-1">
                  {ws.running && ws.port > 0 && (
                    <Button
                      size="xs"
                      onClick={() =>
                        window.open(
                          `http://${window.location.hostname}:${ws.port}/?tkn=${ws.uid}&folder=/workspace/${ws.name}`,
                          '_blank',
                        )
                      }
                    >
                      <ExternalLink className="h-3 w-3" />
                      Open
                    </Button>
                  )}
                  {!ws.running && !ws.creating && (
                    <Button
                      variant="outline"
                      size="xs"
                      onClick={() =>
                        handleAction('start', {
                          name: ws.name,
                          pod: ws.pod,
                        })
                      }
                      className="text-success border-success/30 hover:bg-success/10"
                    >
                      <Play className="h-3 w-3" />
                      Start
                    </Button>
                  )}
                  {ws.running && (
                    <Button
                      variant="outline"
                      size="xs"
                      onClick={() =>
                        handleAction('stop', {
                          name: ws.name,
                          pod: ws.pod,
                        })
                      }
                      className="text-warning border-warning/30 hover:bg-warning/10"
                    >
                      <Square className="h-3 w-3" />
                      Stop
                    </Button>
                  )}
                  <Button
                    variant="outline"
                    size="xs"
                    onClick={() =>
                      handleAction('terminal', { name: ws.name })
                    }
                  >
                    <Terminal className="h-3 w-3" />
                    Details
                  </Button>
                  <Button
                    variant="outline"
                    size="xs"
                    onClick={() =>
                      handleAction('rebuild', {
                        name: ws.name,
                        pod: ws.pod,
                        uid: ws.uid,
                        repo: ws.repo,
                        owner: ws.owner,
                      })
                    }
                  >
                    <RotateCcw className="h-3 w-3" />
                    Rebuild
                  </Button>
                  <Button
                    variant="outline"
                    size="xs"
                    onClick={() =>
                      handleAction('delete', {
                        name: ws.name,
                        pod: ws.pod,
                        uid: ws.uid,
                      })
                    }
                    className="text-destructive border-destructive/30 hover:bg-destructive/10"
                  >
                    <Trash2 className="h-3 w-3" />
                    Delete
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
