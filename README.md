# DevPod Dashboard

A lightweight web dashboard for managing [DevPod](https://devpod.sh) workspaces running on Kubernetes. Pure Python stdlib -- no pip dependencies.

![Python 3.8+](https://img.shields.io/badge/python-3.8+-blue) ![License: MIT](https://img.shields.io/badge/license-MIT-green)

## Features

- **Workspace management** -- create, stop, start, delete, duplicate, resize workspaces
- **Live resource monitoring** -- CPU cores, memory, swap, disk, load average, top processes
- **Per-workspace detail pages** -- pod info, containers, events, PVCs, resource usage
- **Live log streaming** -- SSE-based real-time container logs and creation output
- **Resource controls** -- configure provider defaults, LimitRange, and ResourceQuota from the UI
- **Auto-shutdown timers** -- set per-workspace idle shutdown timers

## Requirements

- Python 3.8+ (stdlib only, no pip install needed)
- `kubectl` configured with cluster access
- DevPod installed with the Kubernetes provider
- Linux host (reads `/proc` for system stats)

## Quick Start

```bash
# Clone
git clone https://github.com/jellologic/devpod-dashboard.git
cd devpod-dashboard

# Configure
cp .env.example .env
# Edit .env with your settings (at minimum, change DASHBOARD_PASS)

# Run
python3 -m dashboard
```

Open `http://your-host:8080` in a browser (default credentials: `admin` / `changeme`).

## Configuration

All settings are environment variables. See [`.env.example`](.env.example) for the full list.

| Variable | Default | Description |
|---|---|---|
| `DASHBOARD_USER` | `admin` | HTTP Basic Auth username |
| `DASHBOARD_PASS` | `changeme` | HTTP Basic Auth password |
| `DASHBOARD_PORT` | `8080` | Listen port |
| `KUBECONFIG` | `/etc/rancher/k3s/k3s.yaml` | Path to kubeconfig |
| `DASHBOARD_NAMESPACE` | `devpod` | Kubernetes namespace for DevPod workspaces |
| `DEVPOD_USER` | `devpod` | OS user that runs the devpod CLI |
| `DEVPOD_HOME` | `/home/devpod` | Home directory for the devpod user |

## Systemd Service

```ini
[Unit]
Description=DevPod Dashboard
After=k3s.service

[Service]
Type=simple
ExecStart=/usr/bin/python3 -m dashboard
WorkingDirectory=/usr/local/lib
EnvironmentFile=/usr/local/lib/dashboard/.env
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

## Project Structure

```
dashboard/
    __init__.py              # Package marker
    __main__.py              # Entry point: python3 -m dashboard
    config.py                # Constants and env var configuration
    auth.py                  # HTTP Basic Auth
    server.py                # HTTP handler and route dispatch
    kube.py                  # kubectl wrappers
    stats.py                 # System stats collector thread
    settings.py              # Provider defaults, LimitRange, ResourceQuota
    workspaces.py            # Workspace CRUD operations
    logs.py                  # Log buffer and streaming
    templates/
        base.py              # Shared HTML shell
        styles.py            # CSS
        scripts.py           # JavaScript
        main_page.py         # Main dashboard page
        workspace_detail.py  # Workspace detail page
```

## License

[MIT](LICENSE)
