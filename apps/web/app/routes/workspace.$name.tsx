import { createFileRoute, Link } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { useState, useEffect, useRef, useCallback } from 'react'
import { Terminal as TerminalComponent } from '@workspacekit/ui'
import type { WorkspaceDetail, UsageEntry } from '@workspacekit/types'
import { cn } from '~/lib/cn'
import { Button } from '~/components/ui/button'
import { Badge } from '~/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '~/components/ui/card'
import { Input } from '~/components/ui/input'
import { Label } from '~/components/ui/label'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '~/components/ui/tabs'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '~/components/ui/table'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '~/components/ui/dialog'
import {
  Play,
  Square,
  RotateCcw,
  Trash2,
  Copy,
  Scaling,
  ChevronRight,
  Info,
  Container,
  HardDrive,
  CalendarClock,
  ScrollText,
  TerminalSquare,
  BarChart3,
  ExternalLink,
} from 'lucide-react'

// ---------------------------------------------------------------------------
// Server functions
// ---------------------------------------------------------------------------

const fetchWorkspaceDetail = createServerFn({ method: 'GET' })
  .validator((input: { name: string }) => input)
  .handler(async ({ data }): Promise<WorkspaceDetail | null> => {
    const { requireServerFnAuth } = await import('~/server/auth')
    await requireServerFnAuth()
    const { getWorkspaceDetail } = await import('~/server/workspaces')
    return getWorkspaceDetail({ data })
  })

const fetchUsageHistory = createServerFn({ method: 'GET' })
  .validator((input: { pod: string }) => input)
  .handler(async ({ data }): Promise<UsageEntry[]> => {
    const { requireServerFnAuth } = await import('~/server/auth')
    await requireServerFnAuth()
    const { getUsageHistory } = await import('~/server/stats')
    return getUsageHistory(data.pod)
  })

// ---------------------------------------------------------------------------
// Route
// ---------------------------------------------------------------------------

export const Route = createFileRoute('/workspace/$name')({
  loader: async ({ params }) => {
    const detail = await fetchWorkspaceDetail({
      data: { name: params.name },
    })
    const usageHistory = detail?.pod
      ? await fetchUsageHistory({ data: { pod: detail.pod } })
      : []
    return { detail, usageHistory }
  },
  component: WorkspaceDetailPage,
})

// ---------------------------------------------------------------------------
// StatusBadge helper
// ---------------------------------------------------------------------------

function StatusBadge({
  status,
  running,
  creating,
}: {
  status: string
  running: boolean
  creating: boolean
}) {
  if (creating) {
    return (
      <Badge variant="outline" className="border-warning/30 text-warning">
        <span className="mr-1.5 h-2 w-2 animate-pulse rounded-full bg-warning" />
        Creating
      </Badge>
    )
  }
  if (running) {
    return (
      <Badge variant="outline" className="border-success/30 text-success">
        <span className="mr-1.5 h-2 w-2 rounded-full bg-success shadow-[0_0_6px_rgba(52,199,89,0.5)]" />
        Running
      </Badge>
    )
  }
  if (status === 'Failed' || status === 'Error') {
    return (
      <Badge variant="destructive">
        <span className="mr-1.5 h-2 w-2 rounded-full bg-white" />
        {status}
      </Badge>
    )
  }
  return (
    <Badge variant="secondary">
      <span className="mr-1.5 h-2 w-2 rounded-full bg-muted-foreground" />
      Stopped
    </Badge>
  )
}

// ---------------------------------------------------------------------------
// LogViewer (SSE)
// ---------------------------------------------------------------------------

function LogViewer({ pod }: { pod: string }) {
  const [lines, setLines] = useState<string[]>([])
  const [streaming, setStreaming] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const eventSourceRef = useRef<EventSource | null>(null)

  const startStream = useCallback(() => {
    if (eventSourceRef.current) eventSourceRef.current.close()

    const es = new EventSource(
      `/api/logs/stream/${encodeURIComponent(pod)}`,
    )
    eventSourceRef.current = es
    setStreaming(true)

    es.onmessage = (event) => {
      setLines((prev) => [...prev, event.data])
      requestAnimationFrame(() => {
        if (containerRef.current) {
          containerRef.current.scrollTop = containerRef.current.scrollHeight
        }
      })
    }

    es.onerror = () => {
      setStreaming(false)
      es.close()
    }
  }, [pod])

  const stopStream = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close()
      eventSourceRef.current = null
    }
    setStreaming(false)
  }, [])

  useEffect(() => {
    return () => {
      if (eventSourceRef.current) eventSourceRef.current.close()
    }
  }, [])

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-foreground">Log Output</h3>
        <div className="flex gap-2">
          {!streaming ? (
            <Button variant="outline" size="xs" onClick={startStream} className="text-success">
              <Play className="h-3 w-3" />
              Stream
            </Button>
          ) : (
            <Button variant="outline" size="xs" onClick={stopStream} className="text-warning">
              <Square className="h-3 w-3" />
              Stop
            </Button>
          )}
          <Button
            variant="ghost"
            size="xs"
            onClick={() => setLines([])}
          >
            Clear
          </Button>
        </div>
      </div>
      <div
        ref={containerRef}
        className="max-h-[400px] overflow-auto rounded-lg bg-[#1a1a2e] p-4 font-mono text-xs leading-relaxed text-green-400/80"
      >
        {lines.length === 0 ? (
          <span className="text-muted-foreground">
            {streaming
              ? 'Waiting for log output...'
              : 'Click "Stream" to begin streaming.'}
          </span>
        ) : (
          lines.map((line, i) => (
            <div key={i} className="whitespace-pre-wrap break-all">
              {line}
            </div>
          ))
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// UsageChart
// ---------------------------------------------------------------------------

function UsageChart({ entries }: { entries: UsageEntry[] }) {
  if (entries.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No usage data available yet.
      </p>
    )
  }

  const maxCpu = Math.max(...entries.map((e) => e.cpu_mc), 1)
  const maxMem = Math.max(...entries.map((e) => e.mem_bytes), 1)

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-border">
            <th className="px-3 py-2 text-left font-medium text-muted-foreground">
              Time
            </th>
            <th className="px-3 py-2 text-left font-medium text-muted-foreground">
              CPU (millicores)
            </th>
            <th className="px-3 py-2 text-left font-medium text-muted-foreground">
              Memory
            </th>
          </tr>
        </thead>
        <tbody>
          {entries.slice(-20).map((entry, i) => {
            const time = new Date(entry.timestamp).toLocaleTimeString()
            const cpuPct = (entry.cpu_mc / maxCpu) * 100
            const memPct = (entry.mem_bytes / maxMem) * 100
            const memMb = (entry.mem_bytes / (1024 * 1024)).toFixed(0)

            return (
              <tr key={i} className="border-b border-border/50">
                <td className="px-3 py-1.5 text-muted-foreground">
                  {time}
                </td>
                <td className="px-3 py-1.5">
                  <div className="flex items-center gap-2">
                    <div className="h-1.5 w-40 rounded-full bg-secondary">
                      <div
                        className="h-1.5 rounded-full bg-primary transition-all"
                        style={{ width: `${cpuPct}%` }}
                      />
                    </div>
                    <span className="text-foreground">{entry.cpu_mc}m</span>
                  </div>
                </td>
                <td className="px-3 py-1.5">
                  <div className="flex items-center gap-2">
                    <div className="h-1.5 w-40 rounded-full bg-secondary">
                      <div
                        className="h-1.5 rounded-full bg-success transition-all"
                        style={{ width: `${memPct}%` }}
                      />
                    </div>
                    <span className="text-foreground">{memMb}Mi</span>
                  </div>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main page component
// ---------------------------------------------------------------------------

function WorkspaceDetailPage() {
  const { detail, usageHistory } = Route.useLoaderData()
  const params = Route.useParams()

  if (!detail) {
    return (
      <div className="flex flex-col items-center gap-4 py-16">
        <h2 className="text-xl font-semibold text-foreground">
          Workspace Not Found
        </h2>
        <p className="text-muted-foreground">
          No workspace named "{params.name}" was found.
        </p>
        <Button variant="outline" asChild>
          <Link to="/">Back to Dashboard</Link>
        </Button>
      </div>
    )
  }

  const hostIp =
    typeof window !== 'undefined' ? window.location.hostname : 'localhost'
  const wsProtocol =
    typeof window !== 'undefined' && window.location.protocol === 'https:'
      ? 'wss'
      : 'ws'
  const wsPort =
    typeof window !== 'undefined' ? window.location.port : '3000'
  const terminalWsUrl = `${wsProtocol}://${hostIp}${wsPort ? `:${wsPort}` : ''}/api/terminal/${encodeURIComponent(detail.pod ?? params.name)}`

  // --- Action handlers ---
  const fireAction = async (
    action: string,
    body: Record<string, unknown>,
  ) => {
    if (action === 'delete') {
      if (
        !confirm(
          `Delete workspace "${detail.name}"? This cannot be undone.`,
        )
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
        body: JSON.stringify({ action, ...body }),
      })

      if (action === 'delete') {
        window.location.href = '/'
      } else {
        window.location.reload()
      }
    } catch {
      // Silently fail; user can retry
    }
  }

  // --- Resize form state ---
  const [resizeReqCpu, setResizeReqCpu] = useState(
    detail.resources.req_cpu,
  )
  const [resizeReqMem, setResizeReqMem] = useState(
    detail.resources.req_mem,
  )
  const [resizeLimCpu, setResizeLimCpu] = useState(
    detail.resources.lim_cpu,
  )
  const [resizeLimMem, setResizeLimMem] = useState(
    detail.resources.lim_mem,
  )

  // --- Terminal visibility ---
  const [showTerminal, setShowTerminal] = useState(false)

  // --- Info rows helper ---
  const infoRows: Array<{ label: string; value: React.ReactNode }> = [
    { label: 'Name', value: detail.name },
    { label: 'Status', value: detail.status },
    { label: 'Phase', value: detail.phase },
    {
      label: 'Pod',
      value: (
        <code className="text-xs">{detail.pod || '-'}</code>
      ),
    },
    {
      label: 'Pod IP',
      value: (
        <code className="text-xs">{detail.pod_ip || '-'}</code>
      ),
    },
    { label: 'Node', value: detail.node || '-' },
    { label: 'Age', value: detail.age || '-' },
    { label: 'Owner', value: detail.owner || '-' },
    {
      label: 'Repository',
      value: detail.repo ? (
        <a
          href={detail.repo}
          target="_blank"
          rel="noopener noreferrer"
          className="text-primary hover:underline"
        >
          {detail.repo.replace(/^https?:\/\/(github\.com\/)?/, '')}
        </a>
      ) : (
        '-'
      ),
    },
    {
      label: 'Branch',
      value: (
        <span>
          {detail.branch || '-'}
          {detail.dirty && (
            <span className="ml-2 text-warning">(dirty)</span>
          )}
        </span>
      ),
    },
    {
      label: 'Last Commit',
      value: (
        <code className="text-xs">
          {detail.last_commit || '-'}
        </code>
      ),
    },
    {
      label: 'Resources',
      value: `CPU: ${detail.resources.req_cpu}/${detail.resources.lim_cpu} | Mem: ${detail.resources.req_mem}/${detail.resources.lim_mem}`,
    },
    ...(detail.usage
      ? [
          {
            label: 'Current Usage',
            value: `CPU: ${detail.usage.cpu} | Mem: ${detail.usage.memory}`,
          },
        ]
      : []),
    { label: 'Last Accessed', value: detail.last_accessed || '-' },
    ...(detail.expiry_warning
      ? [
          {
            label: 'Expiry Warning',
            value: (
              <span className="text-warning">
                {detail.expiry_warning}
              </span>
            ),
          },
        ]
      : []),
  ]

  return (
    <div className="flex flex-col gap-6">
      {/* Breadcrumb */}
      <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
        <Link to="/" className="hover:text-foreground">
          Workspaces
        </Link>
        <ChevronRight className="h-3 w-3" />
        <span className="font-medium text-foreground">{detail.name}</span>
      </div>

      {/* Header row */}
      <div className="flex flex-wrap items-center gap-4">
        <h1 className="text-2xl font-bold text-foreground">{detail.name}</h1>
        <StatusBadge
          status={detail.status}
          running={detail.running}
          creating={detail.creating}
        />
      </div>

      {/* Action buttons */}
      <div className="flex flex-wrap gap-2">
        {detail.running && detail.port > 0 && (
          <Button
            size="sm"
            onClick={() => {
              window.open(
                `http://${hostIp}:${detail.port}/?tkn=${detail.uid}&folder=/workspace/${detail.name}`,
                '_blank',
              )
            }}
          >
            <ExternalLink className="h-4 w-4" />
            Open VSCode
          </Button>
        )}
        {!detail.running && !detail.creating && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => fireAction('start', { pod: detail.pod })}
            className="text-success border-success/30 hover:bg-success/10"
          >
            <Play className="h-4 w-4" />
            Start
          </Button>
        )}
        {detail.running && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => fireAction('stop', { pod: detail.pod })}
            className="text-warning border-warning/30 hover:bg-warning/10"
          >
            <Square className="h-4 w-4" />
            Stop
          </Button>
        )}
        <Button
          variant="outline"
          size="sm"
          onClick={() =>
            fireAction('rebuild', {
              name: detail.name,
              pod: detail.pod,
              uid: detail.uid,
              repo: detail.repo,
              owner: detail.owner,
            })
          }
        >
          <RotateCcw className="h-4 w-4" />
          Rebuild
        </Button>

        {/* Resize Dialog */}
        <Dialog>
          <DialogTrigger asChild>
            <Button variant="outline" size="sm">
              <Scaling className="h-4 w-4" />
              Resize
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Resize Resources</DialogTitle>
            </DialogHeader>
            <div className="grid grid-cols-2 gap-4">
              <div className="flex flex-col gap-2">
                <Label className="text-xs">CPU Request</Label>
                <Input
                  value={resizeReqCpu}
                  onChange={(e) => setResizeReqCpu(e.target.value)}
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label className="text-xs">CPU Limit</Label>
                <Input
                  value={resizeLimCpu}
                  onChange={(e) => setResizeLimCpu(e.target.value)}
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label className="text-xs">Memory Request</Label>
                <Input
                  value={resizeReqMem}
                  onChange={(e) => setResizeReqMem(e.target.value)}
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label className="text-xs">Memory Limit</Label>
                <Input
                  value={resizeLimMem}
                  onChange={(e) => setResizeLimMem(e.target.value)}
                />
              </div>
            </div>
            <div className="flex justify-end pt-2">
              <Button
                onClick={() =>
                  fireAction('resize', {
                    pod: detail.pod,
                    uid: detail.uid,
                    req_cpu: resizeReqCpu,
                    req_mem: resizeReqMem,
                    lim_cpu: resizeLimCpu,
                    lim_mem: resizeLimMem,
                  })
                }
              >
                Apply Resize
              </Button>
            </div>
          </DialogContent>
        </Dialog>

        <Button
          variant="outline"
          size="sm"
          onClick={() =>
            fireAction('duplicate', {
              source_pod: detail.pod,
              source_name: detail.name,
              new_name: `${detail.name}-copy`,
              repo: detail.repo,
            })
          }
        >
          <Copy className="h-4 w-4" />
          Duplicate
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() =>
            fireAction('delete', {
              name: detail.name,
              pod: detail.pod,
              uid: detail.uid,
            })
          }
          className="text-destructive border-destructive/30 hover:bg-destructive/10"
        >
          <Trash2 className="h-4 w-4" />
          Delete
        </Button>
      </div>

      {/* Tabbed content */}
      <Tabs defaultValue="overview" className="w-full">
        <TabsList variant="line" className="w-full justify-start">
          <TabsTrigger value="overview">
            <Info className="h-3.5 w-3.5" />
            Overview
          </TabsTrigger>
          <TabsTrigger value="containers">
            <Container className="h-3.5 w-3.5" />
            Containers
          </TabsTrigger>
          <TabsTrigger value="storage">
            <HardDrive className="h-3.5 w-3.5" />
            Storage
          </TabsTrigger>
          <TabsTrigger value="events">
            <CalendarClock className="h-3.5 w-3.5" />
            Events
          </TabsTrigger>
          {detail.pod && (
            <TabsTrigger value="logs">
              <ScrollText className="h-3.5 w-3.5" />
              Logs
            </TabsTrigger>
          )}
          {detail.running && detail.pod && (
            <TabsTrigger value="terminal">
              <TerminalSquare className="h-3.5 w-3.5" />
              Terminal
            </TabsTrigger>
          )}
          <TabsTrigger value="usage">
            <BarChart3 className="h-3.5 w-3.5" />
            Usage
          </TabsTrigger>
        </TabsList>

        {/* Overview Tab */}
        <TabsContent value="overview" className="mt-4">
          <Card className="border-black/[0.06] bg-white/72 shadow-[var(--shadow-card)] backdrop-blur-xl">
            <CardHeader>
              <CardTitle className="text-base">Workspace Info</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid gap-0 divide-y divide-border">
                {infoRows.map((row) => (
                  <div
                    key={row.label}
                    className="flex items-center justify-between py-2.5 text-sm"
                  >
                    <span className="text-muted-foreground">
                      {row.label}
                    </span>
                    <span className="font-medium text-foreground">
                      {row.value}
                    </span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Containers Tab */}
        <TabsContent value="containers" className="mt-4">
          <Card className="border-black/[0.06] bg-white/72 shadow-[var(--shadow-card)] backdrop-blur-xl">
            <CardHeader>
              <CardTitle className="text-base">Containers</CardTitle>
            </CardHeader>
            <CardContent>
              {detail.containers.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No containers found.
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Image</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">
                        Restarts
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {detail.containers.map((c, i) => (
                      <TableRow key={i}>
                        <TableCell className="font-medium">
                          {c.name}
                        </TableCell>
                        <TableCell>
                          <code className="text-xs">
                            {c.image}
                          </code>
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant={
                              c.ready ? 'default' : 'destructive'
                            }
                          >
                            {c.ready ? 'Ready' : 'Not Ready'}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          {c.restart_count}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Storage Tab */}
        <TabsContent value="storage" className="mt-4">
          <Card className="border-black/[0.06] bg-white/72 shadow-[var(--shadow-card)] backdrop-blur-xl">
            <CardHeader>
              <CardTitle className="text-base">
                Persistent Volume Claims
              </CardTitle>
            </CardHeader>
            <CardContent>
              {detail.pvcs.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No PVCs found.
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Capacity</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Storage Class</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {detail.pvcs.map((pvc, i) => (
                      <TableRow key={i}>
                        <TableCell className="font-mono text-xs">
                          {pvc.name}
                        </TableCell>
                        <TableCell>{pvc.capacity}</TableCell>
                        <TableCell>
                          <Badge
                            variant={
                              pvc.status === 'Bound'
                                ? 'default'
                                : 'secondary'
                            }
                          >
                            {pvc.status}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          {pvc.storage_class}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Events Tab */}
        <TabsContent value="events" className="mt-4">
          <Card className="border-black/[0.06] bg-white/72 shadow-[var(--shadow-card)] backdrop-blur-xl">
            <CardHeader>
              <CardTitle className="text-base">Events</CardTitle>
            </CardHeader>
            <CardContent>
              {detail.events.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No events recorded.
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-24">Type</TableHead>
                      <TableHead className="w-36">Reason</TableHead>
                      <TableHead className="w-24">Age</TableHead>
                      <TableHead>Message</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {detail.events.map((event, i) => (
                      <TableRow key={i}>
                        <TableCell>
                          <Badge
                            variant={
                              event.type === 'Warning'
                                ? 'destructive'
                                : 'secondary'
                            }
                          >
                            {event.type}
                          </Badge>
                        </TableCell>
                        <TableCell className="font-medium">
                          {event.reason}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {event.age}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {event.message}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Logs Tab */}
        {detail.pod && (
          <TabsContent value="logs" className="mt-4">
            <Card className="border-black/[0.06] bg-white/72 shadow-[var(--shadow-card)] backdrop-blur-xl">
              <CardHeader>
                <CardTitle className="text-base">Logs</CardTitle>
              </CardHeader>
              <CardContent>
                <LogViewer pod={detail.pod} />
              </CardContent>
            </Card>
          </TabsContent>
        )}

        {/* Terminal Tab */}
        {detail.running && detail.pod && (
          <TabsContent value="terminal" className="mt-4">
            <Card className="border-black/[0.06] bg-white/72 shadow-[var(--shadow-card)] backdrop-blur-xl">
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle className="text-base">Terminal</CardTitle>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowTerminal((v) => !v)}
                >
                  <TerminalSquare className="h-4 w-4" />
                  {showTerminal ? 'Disconnect' : 'Connect'}
                </Button>
              </CardHeader>
              <CardContent>
                {showTerminal ? (
                  <TerminalComponent
                    podName={detail.pod}
                    wsUrl={terminalWsUrl}
                  />
                ) : (
                  <p className="text-sm text-muted-foreground">
                    Click "Connect" to open a terminal session.
                  </p>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        )}

        {/* Usage Tab */}
        <TabsContent value="usage" className="mt-4">
          <Card className="border-black/[0.06] bg-white/72 shadow-[var(--shadow-card)] backdrop-blur-xl">
            <CardHeader>
              <CardTitle className="text-base">Usage History</CardTitle>
            </CardHeader>
            <CardContent>
              <UsageChart entries={usageHistory} />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}
