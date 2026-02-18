/**
 * In-memory stats cache with periodic collection from the K8s Metrics API.
 *
 * Runs three collection intervals inside the web server process:
 *   1. Pod metrics every 5 seconds  - fetches CPU/memory usage per pod
 *   2. System stats every 5 seconds - collects CPU%, memory, disk, processes
 *   3. Usage history every 120 seconds - appends to a per-pod ring buffer
 */

import os from 'node:os'
import fs from 'node:fs'
import { execSync } from 'node:child_process'
import {
  getPodMetrics,
  parseCpuValue,
  parseMemValue,
  listWorkspacePods,
  getContainerResources,
} from '@workspacekit/k8s'
import type { PodMetric } from '@workspacekit/k8s'
import type { SystemStats, UsageEntry, ProcessInfo } from '@workspacekit/types'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** How often we fetch pod metrics (milliseconds). */
const METRICS_INTERVAL_MS = 5_000

/** How often we collect system stats (milliseconds). */
const SYSTEM_STATS_INTERVAL_MS = 5_000

/** How often we snapshot usage history (milliseconds). */
const HISTORY_INTERVAL_MS = 120_000

/** Maximum number of history entries per pod (ring buffer). */
const MAX_HISTORY_ENTRIES = 60

// ---------------------------------------------------------------------------
// Caches
// ---------------------------------------------------------------------------

/**
 * Per-pod usage metrics (refreshed every METRICS_INTERVAL_MS).
 */
let podMetricsCache = new Map<string, PodMetric>()

/**
 * Per-pod usage history ring buffer (appended every HISTORY_INTERVAL_MS).
 */
const usageHistoryCache = new Map<string, UsageEntry[]>()

/**
 * Cached system stats snapshot returned by getStats().
 */
export let statsCache: SystemStats = emptyStats()

/**
 * Previous CPU times snapshot for delta-based CPU% calculation.
 */
let prevCpuTimes: { idle: number; total: number } | null = null

// ---------------------------------------------------------------------------
// Default empty stats
// ---------------------------------------------------------------------------

function emptyStats(): SystemStats {
  return {
    cpu: {},
    ncpu: os.cpus().length,
    mem: { total: 0, used: 0, buffers: 0, cached: 0, available: 0 },
    swap: { total: 0, used: 0 },
    load: [0, 0, 0],
    tasks: '0',
    uptime: '0s',
    disk: { total: 0, used: 0, available: 0 },
    procs: [],
  }
}

// ---------------------------------------------------------------------------
// System stats collectors
// ---------------------------------------------------------------------------

/**
 * Reads /proc/stat to compute aggregate CPU usage percentage (delta-based).
 * Falls back to os.cpus() idle-time estimation on macOS.
 */
function collectCpuPercent(): number {
  try {
    const content = fs.readFileSync('/proc/stat', 'utf-8')
    const line = content.split('\n')[0] // "cpu  user nice system idle iowait irq softirq steal"
    const parts = line.split(/\s+/).slice(1).map(Number)
    const idle = parts[3] + (parts[4] || 0) // idle + iowait
    const total = parts.reduce((a, b) => a + b, 0)

    if (prevCpuTimes) {
      const idleDelta = idle - prevCpuTimes.idle
      const totalDelta = total - prevCpuTimes.total
      prevCpuTimes = { idle, total }
      if (totalDelta > 0) {
        return Math.round(((totalDelta - idleDelta) / totalDelta) * 100)
      }
    }
    prevCpuTimes = { idle, total }
    return 0
  } catch {
    // macOS fallback: estimate from os.cpus() idle ratios
    const cpus = os.cpus()
    let totalIdle = 0
    let totalTick = 0
    for (const cpu of cpus) {
      totalIdle += cpu.times.idle
      totalTick += cpu.times.user + cpu.times.nice + cpu.times.sys + cpu.times.idle + cpu.times.irq
    }
    if (totalTick > 0) {
      return Math.round(((totalTick - totalIdle) / totalTick) * 100)
    }
    return 0
  }
}

/**
 * Reads /proc/meminfo for detailed memory stats.
 * Falls back to os.totalmem()/freemem() on macOS.
 */
function collectMemory(): { total: number; used: number; buffers: number; cached: number; available: number } {
  try {
    const content = fs.readFileSync('/proc/meminfo', 'utf-8')
    const fields: Record<string, number> = {}
    for (const line of content.split('\n')) {
      const match = line.match(/^(\w+):\s+(\d+)/)
      if (match) {
        fields[match[1]] = parseInt(match[2], 10) * 1024 // kB -> bytes
      }
    }

    const total = fields.MemTotal || 0
    const free = fields.MemFree || 0
    const buffers = fields.Buffers || 0
    const cached = fields.Cached || 0
    const available = fields.MemAvailable || (free + buffers + cached)
    const used = total - free - buffers - cached

    return { total, used, buffers, cached, available }
  } catch {
    const total = os.totalmem()
    const free = os.freemem()
    return { total, used: total - free, buffers: 0, cached: 0, available: free }
  }
}

/**
 * Reads swap info from /proc/meminfo.
 */
function collectSwap(): { total: number; used: number } {
  try {
    const content = fs.readFileSync('/proc/meminfo', 'utf-8')
    let swapTotal = 0
    let swapFree = 0
    for (const line of content.split('\n')) {
      const match = line.match(/^(SwapTotal|SwapFree):\s+(\d+)/)
      if (match) {
        const val = parseInt(match[2], 10) * 1024
        if (match[1] === 'SwapTotal') swapTotal = val
        else swapFree = val
      }
    }
    return { total: swapTotal, used: swapTotal - swapFree }
  } catch {
    return { total: 0, used: 0 }
  }
}

/**
 * Runs `df -B1 /` to get disk usage.
 */
function collectDisk(): { total: number; used: number; available: number } {
  try {
    // Use -B1 on Linux for byte values; macOS df doesn't support -B1
    let output: string
    try {
      output = execSync('df -B1 /', { timeout: 3000, encoding: 'utf-8' })
    } catch {
      // macOS: df outputs 512-byte blocks by default
      output = execSync('df -k /', { timeout: 3000, encoding: 'utf-8' })
      const lines = output.trim().split('\n')
      if (lines.length >= 2) {
        const parts = lines[1].split(/\s+/)
        // df -k: values in 1K blocks
        const total = parseInt(parts[1], 10) * 1024
        const used = parseInt(parts[2], 10) * 1024
        const available = parseInt(parts[3], 10) * 1024
        if (!isNaN(total)) return { total, used, available }
      }
      return { total: 0, used: 0, available: 0 }
    }

    const lines = output.trim().split('\n')
    if (lines.length >= 2) {
      const parts = lines[1].split(/\s+/)
      const total = parseInt(parts[1], 10)
      const used = parseInt(parts[2], 10)
      const available = parseInt(parts[3], 10)
      if (!isNaN(total)) return { total, used, available }
    }
    return { total: 0, used: 0, available: 0 }
  } catch {
    return { total: 0, used: 0, available: 0 }
  }
}

/**
 * Runs `ps aux --sort=-rss | head -21` to get top processes by memory.
 */
function collectProcesses(): ProcessInfo[] {
  try {
    let output: string
    try {
      // Linux
      output = execSync('ps aux --sort=-rss | head -21', { timeout: 3000, encoding: 'utf-8' })
    } catch {
      // macOS: ps aux without --sort, pipe through sort
      output = execSync('ps aux | sort -nrk6 | head -20', { timeout: 3000, encoding: 'utf-8' })
    }

    const lines = output.trim().split('\n')
    const procs: ProcessInfo[] = []

    // Skip header line (first line from `ps aux` output)
    for (let i = 1; i < lines.length && procs.length < 20; i++) {
      const parts = lines[i].split(/\s+/)
      if (parts.length < 11) continue

      const rssKb = parseInt(parts[5], 10)
      procs.push({
        pid: parts[1],
        user: parts[0],
        cpu: parts[2],
        mem: parts[3],
        rss: isNaN(rssKb) ? 0 : rssKb * 1024,
        cmd: parts.slice(10).join(' '),
      })
    }

    return procs
  } catch {
    return []
  }
}

/**
 * Collects all system-level stats and merges them into the stats cache.
 */
function collectSystemStats(): void {
  try {
    const cpuPercent = collectCpuPercent()
    const mem = collectMemory()
    const swap = collectSwap()
    const disk = collectDisk()
    const procs = collectProcesses()
    const loadAvg = os.loadavg() as [number, number, number]
    const uptimeSeconds = os.uptime()

    // Merge system CPU% into existing pod CPU map
    const cpuMap = { ...statsCache.cpu }
    cpuMap['_system'] = cpuPercent

    statsCache = {
      ...statsCache,
      cpu: cpuMap,
      ncpu: os.cpus().length,
      mem,
      swap,
      load: loadAvg,
      uptime: formatUptime(uptimeSeconds),
      disk,
      procs,
    }
  } catch (err) {
    console.error('[stats] Failed to collect system stats:', err)
  }
}

// ---------------------------------------------------------------------------
// Pod metrics collector
// ---------------------------------------------------------------------------

/**
 * Fetches pod metrics from the K8s Metrics API and computes per-pod CPU/memory
 * usage percentages. Merges pod CPU percentages into statsCache.cpu.
 */
async function collectPodMetrics(): Promise<void> {
  try {
    const metrics = await getPodMetrics()
    podMetricsCache = metrics

    // Build per-pod CPU usage map
    const podCpuMap: Record<string, number> = {}
    const pods = await listWorkspacePods()

    for (const pod of pods) {
      const podName = pod.metadata?.name ?? ''
      if (!podName) continue

      const metric = metrics.get(podName)
      if (!metric) continue

      const resources = getContainerResources(pod)
      const usedCpuMillis = parseCpuValue(metric.cpu)
      const limitCpuMillis = parseCpuValue(resources.lim_cpu || resources.req_cpu)

      if (limitCpuMillis > 0) {
        podCpuMap[podName] = Math.round((usedCpuMillis / limitCpuMillis) * 100)
      } else {
        podCpuMap[podName] = 0
      }
    }

    // Merge pod CPU entries into existing stats (preserve _system key)
    const mergedCpu = { ...statsCache.cpu }
    // Remove old pod entries (keep _system)
    for (const key of Object.keys(mergedCpu)) {
      if (key !== '_system') delete mergedCpu[key]
    }
    Object.assign(mergedCpu, podCpuMap)

    statsCache = {
      ...statsCache,
      cpu: mergedCpu,
      tasks: String(pods.length),
    }
  } catch (err) {
    console.error('[stats] Failed to collect pod metrics:', err)
  }
}

/**
 * Snapshots the current pod metrics into the per-pod usage history ring buffer.
 */
async function collectUsageHistory(): Promise<void> {
  try {
    const now = Date.now()

    for (const [podName, metric] of podMetricsCache) {
      const cpuMc = parseCpuValue(metric.cpu)
      const memBytes = parseMemValue(metric.memory)

      let history = usageHistoryCache.get(podName)
      if (!history) {
        history = []
        usageHistoryCache.set(podName, history)
      }

      history.push({
        timestamp: now,
        cpu_mc: cpuMc,
        mem_bytes: memBytes,
      })

      // Trim ring buffer
      if (history.length > MAX_HISTORY_ENTRIES) {
        usageHistoryCache.set(
          podName,
          history.slice(history.length - MAX_HISTORY_ENTRIES),
        )
      }
    }

    // Clean up entries for pods that no longer exist
    for (const podName of usageHistoryCache.keys()) {
      if (!podMetricsCache.has(podName)) {
        usageHistoryCache.delete(podName)
      }
    }
  } catch (err) {
    console.error('[stats] Failed to collect usage history:', err)
  }
}

// ---------------------------------------------------------------------------
// Uptime formatting
// ---------------------------------------------------------------------------

function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400)
  const hours = Math.floor((seconds % 86400) / 3600)
  const mins = Math.floor((seconds % 3600) / 60)

  if (days > 0) return `${days}d ${hours}h`
  if (hours > 0) return `${hours}h ${mins}m`
  return `${Math.floor(seconds % 3600)}s`
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

let started = false

/**
 * Starts the periodic stats collection intervals.
 * Safe to call multiple times; will only start once.
 */
export function startStatsCollection(): void {
  if (started) return
  started = true

  console.log('[stats] Starting stats collection')

  // Run initial collection immediately
  void collectPodMetrics()
  collectSystemStats()

  // Pod metrics every 5 seconds
  const metricsTimer = setInterval(() => {
    void collectPodMetrics()
  }, METRICS_INTERVAL_MS)

  // System stats every 5 seconds
  const systemTimer = setInterval(() => {
    collectSystemStats()
  }, SYSTEM_STATS_INTERVAL_MS)

  // Usage history every 120 seconds
  const historyTimer = setInterval(() => {
    void collectUsageHistory()
  }, HISTORY_INTERVAL_MS)

  // Do not prevent process from exiting
  for (const timer of [metricsTimer, systemTimer, historyTimer]) {
    if (typeof timer === 'object' && 'unref' in timer) {
      timer.unref()
    }
  }
}

/**
 * Returns the most recent cached system stats.
 */
export function getStats(): SystemStats {
  return statsCache
}

/**
 * Returns the cached usage history for a specific pod.
 */
export function getUsageHistory(podName: string): UsageEntry[] {
  return usageHistoryCache.get(podName) ?? []
}

/**
 * Returns the current pod metrics cache.
 * Useful for building workspace list responses with inline usage data.
 */
export function getPodMetricsCache(): Map<string, PodMetric> {
  return podMetricsCache
}
