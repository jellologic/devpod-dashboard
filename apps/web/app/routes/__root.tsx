import {
  createRootRoute,
  Outlet,
  Link,
  ScrollRestoration,
  redirect,
} from '@tanstack/react-router'
import { createServerFn, Meta, Scripts } from '@tanstack/react-start'
import { getSession } from '~/server/auth'
import { useRouterState } from '@tanstack/react-router'
import { useState } from 'react'
import {
  LayoutDashboard,
  LogOut,
  PanelLeftClose,
  PanelLeft,
  Server,
} from 'lucide-react'
import { Button } from '~/components/ui/button'
import { Separator } from '~/components/ui/separator'
import { cn } from '~/lib/cn'
import globalsCss from '~/globals.css?url'

const checkAuth = createServerFn({ method: 'GET' }).handler(
  async (): Promise<{ user: string; role: string } | null> => {
    const { getWebRequest } = await import('vinxi/http')
    const request = getWebRequest()
    const session = getSession(request.headers.get('cookie'))
    return session ? { user: session.user, role: session.role } : null
  },
)

export const Route = createRootRoute({
  beforeLoad: async ({ location }) => {
    if (location.pathname === '/login') return

    const session = await checkAuth()
    if (!session) {
      throw redirect({ to: '/login' })
    }

    return { session }
  },
  component: RootLayout,
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { title: 'WorkspaceKit' },
      {
        name: 'description',
        content: 'Cloud development workspace management dashboard',
      },
    ],
    links: [
      { rel: 'stylesheet', href: globalsCss },
    ],
  }),
})

function RootLayout() {
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const isLoginPage = pathname === '/login'
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)

  const handleLogout = async () => {
    await fetch('/api/login', {
      method: 'DELETE',
      headers: { 'X-Requested-With': 'workspacekit' },
    })
    window.location.href = '/login'
  }

  return (
    <html lang="en">
      <head>
        <Meta />
      </head>
      <body className="bg-background text-foreground antialiased">
        {/* Background gradient orbs */}
        <div className="fixed inset-0 -z-10 overflow-hidden">
          <div className="absolute -top-40 -right-40 h-[500px] w-[500px] rounded-full bg-blue-200/30 blur-3xl" />
          <div className="absolute -bottom-40 -left-40 h-[500px] w-[500px] rounded-full bg-purple-200/20 blur-3xl" />
        </div>

        {isLoginPage ? (
          <Outlet />
        ) : (
          <div className="flex h-screen overflow-hidden">
            {/* Sidebar */}
            <aside
              className={cn(
                'flex flex-col border-r border-black/[0.06] bg-white/60 backdrop-blur-xl transition-all duration-200',
                sidebarCollapsed ? 'w-16' : 'w-60',
              )}
            >
              {/* Logo */}
              <div className="flex h-14 items-center gap-3 border-b border-black/[0.06] px-4">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-[#0071e3] to-[#0077ED] text-sm font-extrabold text-white shadow-sm">
                  W
                </div>
                {!sidebarCollapsed && (
                  <span className="text-sm font-semibold text-foreground">
                    WorkspaceKit
                  </span>
                )}
              </div>

              {/* Nav links */}
              <nav className="flex flex-1 flex-col gap-1 p-3">
                <Link
                  to="/"
                  className={cn(
                    'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                    pathname === '/'
                      ? 'bg-accent text-accent-foreground'
                      : 'text-muted-foreground hover:bg-secondary hover:text-foreground',
                  )}
                >
                  <LayoutDashboard className="h-4 w-4 shrink-0" />
                  {!sidebarCollapsed && <span>Workspaces</span>}
                </Link>
              </nav>

              <Separator className="mx-3" />

              {/* Bottom section */}
              <div className="flex flex-col gap-2 p-3">
                <Button
                  variant="ghost"
                  size={sidebarCollapsed ? 'icon' : 'sm'}
                  onClick={() => setSidebarCollapsed((v) => !v)}
                  className="justify-start gap-3 text-muted-foreground"
                >
                  {sidebarCollapsed ? (
                    <PanelLeft className="h-4 w-4 shrink-0" />
                  ) : (
                    <>
                      <PanelLeftClose className="h-4 w-4 shrink-0" />
                      <span>Collapse</span>
                    </>
                  )}
                </Button>
                <Button
                  variant="ghost"
                  size={sidebarCollapsed ? 'icon' : 'sm'}
                  onClick={handleLogout}
                  className="justify-start gap-3 text-muted-foreground hover:text-destructive"
                >
                  <LogOut className="h-4 w-4 shrink-0" />
                  {!sidebarCollapsed && <span>Logout</span>}
                </Button>
              </div>
            </aside>

            {/* Main area */}
            <div className="flex flex-1 flex-col overflow-hidden">
              {/* Top bar */}
              <header className="flex h-14 shrink-0 items-center gap-4 border-b border-black/[0.06] bg-white/72 px-6 backdrop-blur-xl">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Server className="h-4 w-4" />
                  <span className="font-medium text-foreground">
                    Dashboard
                  </span>
                </div>
              </header>

              {/* Page content */}
              <main className="flex-1 overflow-auto p-6">
                <div className="mx-auto max-w-7xl">
                  <Outlet />
                </div>
              </main>
            </div>
          </div>
        )}

        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  )
}
