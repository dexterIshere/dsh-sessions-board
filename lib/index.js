/**
 * Host half: exposes one read-only JSON route with the Sessions board of every
 * workspace known to this DSH home. No model-facing tools, no session event
 * types — the board is a projection of files on disk.
 *
 * The route sits behind the same fence as the GUI: `ctx.connection.admit(req)`
 * rejects a request without the launch token or the pairing cookie. Without that
 * fence the board (absolute workspace paths and the state file contents) would
 * answer any local process, and any peer the host is later bound to.
 * @module dsh-sessions-board
 */
import { buildBoard } from './board.js'

export const name = 'sessions-board'

/** The web host owns the HTTP server; the connection owns the auth fence. */
export const inject = ['webServer', 'connection']

const DEFAULT_ROUTE = '/sessions-board'

export function apply(ctx, config = {}) {
  const route = typeof config.path === 'string' && config.path.startsWith('/') ? config.path : DEFAULT_ROUTE
  const sessionsRoot = typeof config.sessionsRoot === 'string' && config.sessionsRoot ? config.sessionsRoot : undefined

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: route,
    async handler(req, res) {
      // Fail closed: a host without the connection service never serves the board.
      if (typeof ctx.connection?.admit !== 'function') {
        res.writeHead(503, { 'content-type': 'text/plain; charset=utf-8' })
        res.end('sessions board unavailable: connection service missing')
        return
      }
      const admission = ctx.connection.admit(req)
      if (admission && typeof admission === 'object' && 'rejection' in admission) {
        const status = admission.rejection === 403 ? 403 : 401
        res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8' })
        res.end(status === 401 ? 'dsh web authentication required' : 'forbidden')
        return
      }
      try {
        const payload = JSON.stringify(await buildBoard({ sessionsRoot }))
        res.writeHead(200, {
          'content-type': 'application/json; charset=utf-8',
          'cache-control': 'no-store',
          'content-length': Buffer.byteLength(payload, 'utf8'),
        })
        res.end(payload)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' })
        res.end('sessions board failed: ' + message)
      }
    },
  }), 'dsh-sessions-board: route')
}
