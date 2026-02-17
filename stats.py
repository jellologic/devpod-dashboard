"""System stats collector thread."""

import subprocess
import time

from . import config


def parse_cpu_lines(lines):
    cpus = {}
    for line in lines:
        if line.startswith("cpu"):
            parts = line.split()
            cpus[parts[0]] = [int(x) for x in parts[1:]]
    return cpus


def calc_cpu_pct(prev_vals, curr_vals):
    delta = [c - p for c, p in zip(curr_vals, prev_vals)]
    total = sum(delta)
    if total == 0:
        return 0.0
    idle = delta[3] + (delta[4] if len(delta) > 4 else 0)
    return round(100.0 * (total - idle) / total, 1)


def collect_stats_loop():
    while True:
        try:
            stats = {}
            with open("/proc/stat") as f:
                cpu_lines = f.readlines()
            curr_cpu = parse_cpu_lines(cpu_lines)
            if config.prev_cpu:
                cpu_pcts = {}
                for name in sorted(curr_cpu):
                    if name in config.prev_cpu:
                        cpu_pcts[name] = calc_cpu_pct(config.prev_cpu[name], curr_cpu[name])
                stats["cpu"] = cpu_pcts
                stats["ncpu"] = len([k for k in cpu_pcts if k != "cpu"])
            config.prev_cpu = curr_cpu

            mi = {}
            with open("/proc/meminfo") as f:
                for line in f:
                    k, v = line.split(":", 1)
                    mi[k.strip()] = int(v.strip().split()[0])
            total = mi["MemTotal"]
            avail = mi["MemAvailable"]
            buffers = mi.get("Buffers", 0)
            cached = mi.get("Cached", 0) + mi.get("SReclaimable", 0)
            stats["mem"] = {"total": total, "used": total - avail, "buffers": buffers,
                            "cached": cached, "available": avail}
            stats["swap"] = {"total": mi.get("SwapTotal", 0),
                             "used": mi.get("SwapTotal", 0) - mi.get("SwapFree", 0)}

            with open("/proc/loadavg") as f:
                p = f.read().split()
                stats["load"] = [float(p[0]), float(p[1]), float(p[2])]
                stats["tasks"] = p[3]

            with open("/proc/uptime") as f:
                secs = float(f.read().split()[0])
                d, rem = divmod(int(secs), 86400)
                h, rem = divmod(rem, 3600)
                m, _ = divmod(rem, 60)
                stats["uptime"] = f"{d}d {h}h {m}m"

            r = subprocess.run(["df", "-B1", "/"], capture_output=True, text=True, timeout=5)
            if r.returncode == 0:
                parts = r.stdout.strip().split("\n")[1].split()
                stats["disk"] = {"total": int(parts[1]), "used": int(parts[2]),
                                 "available": int(parts[3])}

            r = subprocess.run(["ps", "axo", "pid,user,%cpu,%mem,rss,comm", "--sort=-%cpu",
                                "--no-headers"], capture_output=True, text=True, timeout=5)
            if r.returncode == 0:
                procs = []
                for line in r.stdout.strip().split("\n")[:30]:
                    parts = line.split(None, 5)
                    if len(parts) >= 6:
                        procs.append({"pid": parts[0], "user": parts[1], "cpu": parts[2],
                                      "mem": parts[3], "rss": int(parts[4]), "cmd": parts[5][:60]})
                stats["procs"] = procs

            with config.stats_lock:
                config.sys_stats.update(stats)
        except Exception:
            pass
        time.sleep(2)
