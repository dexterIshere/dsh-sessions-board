/**
 * Host half: exposes one read-only JSON route with the Sessions board of every
 * workspace known to this DSH home. No model-facing tools, no session event
 * types — the board is a projection of files on disk.
 * @module dsh-sessions-board
 */
import { buildBoard } from './board.js'

export const name = 'sessions-board'

/** The web host owns the HTTP server; this plugin only registers a route. */
export const inject = ['webServer']

const DEFAULT_ROUTE = '/sessions-board'

export function apply(ctx, config = {}) {
  const route = typeof config.path === 'string' && config.path.startsWith('/') ? config.path : DEFAULT_ROUTE
  const sessionsRoot = typeof config.sessionsRoot === 'string' && config.sessionsRoot ? config.sessionsRoot : undefined
  const headers = {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  }
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: route,
    async resource() {
      try {
        return new Response(JSON.stringify(await buildBoard({ sessionsRoot })), { status: 200, headers })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return new Response(JSON.stringify({ error: message }), { status: 500, headers })
      }
    },
  }), 'dsh-sessions-board: route')
}
