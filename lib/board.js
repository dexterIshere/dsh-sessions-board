/**
 * Pure helpers for the Sessions board: discover workspaces from the session
 * store, locate each workspace's state file, and parse its Markdown into
 * sections the browser half can render. No Cordis or Harness import, so this
 * module runs and is testable under plain Node.
 * @module dsh-sessions-board/board
 */
import { createReadStream, existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { createZstdDecompress } from 'node:zlib'

/** Default root of the DSH session store. */
export const DEFAULT_SESSIONS_ROOT = join(homedir(), '.dsh', 'sessions')

/** State-file candidates, tried in order, relative to one workspace root. */
export const BOARD_CANDIDATES = [
  'docs/SESSIONS.md',
  'SESSIONS.md',
  'docs/sessions.md',
  '.dsh/SESSIONS.md',
]

const MAX_SESSION_DIRS = 80
const MAX_HEADER_BYTES = 64 * 1024
const MAX_BOARD_BYTES = 2 * 1024 * 1024
const MAX_SESSIONS_PER_WORKSPACE = 40

/**
 * Read the first line of a session log and parse it as the session header.
 * Streams so a multi-megabyte log costs only its first line.
 * @param {string} file absolute path to a session log
 * @returns {Promise<object|null>} parsed header, or null when unusable
 */
export function readSessionHeader(file) {
  return new Promise(resolve => {
    let text = ''
    let settled = false
    const done = value => {
      if (settled) return
      settled = true
      resolve(value)
      stream.destroy()
      decoder.destroy()
    }
    const stream = createReadStream(file)
    const decoder = createZstdDecompress()
    stream.on('error', () => done(null))
    decoder.on('error', () => done(null))
    decoder.on('end', () => done(tryParse(text)))
    decoder.on('data', chunk => {
      text += chunk.toString('utf8')
      const end = text.indexOf('\n')
      if (end !== -1) done(tryParse(text.slice(0, end)))
      else if (text.length > MAX_HEADER_BYTES) done(null)
    })
    stream.pipe(decoder)
  })
}

function tryParse(line) {
  if (!line) return null
  try {
    const value = JSON.parse(line)
    return value && value.type === 'session' ? value : null
  } catch {
    return null
  }
}

const LOG_NAME = /^session\..+\.jsonl(\.zstd)?$/

/**
 * Newest session log inside one workspace directory. The store keeps one
 * sub-directory per session (`session-<uuid>/`), and older layouts put the log
 * straight in the workspace directory, so both are inspected.
 * @param {string} dir absolute workspace directory in the store
 */
function newestLog(dir) {
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return undefined
  }
  let best
  let bestAt = -1
  const consider = file => {
    try {
      const info = statSync(file)
      if (!info.isFile()) return
      if (info.mtimeMs > bestAt) {
        bestAt = info.mtimeMs
        best = { file, mtimeMs: info.mtimeMs, size: info.size }
      }
    } catch {
      /* unreadable entry: ignore */
    }
  }
  for (const entry of entries) {
    if (entry.isFile()) {
      if (LOG_NAME.test(entry.name)) consider(join(dir, entry.name))
      continue
    }
    if (!entry.isDirectory()) continue
    const sessionDir = join(dir, entry.name)
    let inner
    try {
      inner = readdirSync(sessionDir)
    } catch {
      continue
    }
    for (const name of inner) {
      if (LOG_NAME.test(name)) consider(join(sessionDir, name))
    }
  }
  return best
}

/**
 * Discover every workspace that appears in the session store, with the session
 * it holds and when that session was last written.
 * @param {object} [options]
 * @param {string} [options.sessionsRoot] store root, defaults to the DSH one
 * @returns {Promise<Array<{cwd: string, sessions: Array<object>, lastAt: number}>>}
 */
export async function discoverWorkspaces(options = {}) {
  const root = options.sessionsRoot ?? DEFAULT_SESSIONS_ROOT
  let dirs
  try {
    dirs = readdirSync(root, { withFileTypes: true }).filter(entry => entry.isDirectory()).slice(0, MAX_SESSION_DIRS)
  } catch {
    return []
  }
  /** @type {Map<string, {cwd: string, sessions: Array<object>, lastAt: number}>} */
  const byCwd = new Map()
  const headers = await Promise.all(
    dirs.map(async entry => {
      const dir = join(root, entry.name)
      const log = newestLog(dir)
      if (!log) return null
      const header = await readSessionHeader(log.file)
      if (!header || typeof header.cwd !== 'string' || !header.cwd) return null
      return { header, log }
    }),
  )
  for (const row of headers) {
    if (!row) continue
    const { header, log } = row
    const existing = byCwd.get(header.cwd) ?? { cwd: header.cwd, sessions: [], lastAt: 0 }
    existing.sessions.push({
      id: typeof header.id === 'string' ? header.id : undefined,
      createdAt: typeof header.createdAt === 'number' ? header.createdAt : undefined,
      lastAt: log.mtimeMs,
      delegationDepth: typeof header.delegationDepth === 'number' ? header.delegationDepth : 0,
    })
    existing.lastAt = Math.max(existing.lastAt, log.mtimeMs)
    byCwd.set(header.cwd, existing)
  }
  return [...byCwd.values()]
    .map(ws => ({
      ...ws,
      sessions: ws.sessions
        .sort((a, b) => b.lastAt - a.lastAt)
        .slice(0, MAX_SESSIONS_PER_WORKSPACE),
    }))
    .sort((a, b) => b.lastAt - a.lastAt)
}

/**
 * Locate and read one workspace's state file.
 * @param {string} cwd absolute workspace root
 * @returns {{path: string, relativePath: string, mtime: number, markdown: string, truncated: boolean}|null}
 */
export function readBoard(cwd) {
  for (const relativePath of BOARD_CANDIDATES) {
    const path = join(cwd, relativePath)
    if (!existsSync(path)) continue
    try {
      const info = statSync(path)
      if (!info.isFile()) continue
      const raw = readFileSync(path, 'utf8')
      const truncated = Buffer.byteLength(raw, 'utf8') > MAX_BOARD_BYTES
      return {
        path,
        relativePath,
        mtime: info.mtimeMs,
        markdown: truncated ? raw.slice(0, MAX_BOARD_BYTES) : raw,
        truncated,
      }
    } catch {
      /* unreadable candidate: try the next one */
    }
  }
  return null
}

/**
 * Split a Markdown state file into sections. Headings start a section; pipe
 * tables inside a section become structured rows so the client renders cells
 * instead of a wall of pipes.
 * @param {string} markdown
 * @returns {Array<{title: string, level: number, blocks: Array<object>}>}
 */
export function parseMarkdown(markdown) {
  const lines = String(markdown ?? '').split(/\r?\n/)
  const sections = []
  let current = { title: '', level: 0, blocks: [] }
  let table = null
  let list = null
  let paragraph = []

  const flushParagraph = () => {
    if (!paragraph.length) return
    current.blocks.push({ kind: 'text', text: paragraph.join(' ').trim() })
    paragraph = []
  }
  const flushTable = () => {
    if (!table) return
    current.blocks.push({ kind: 'table', header: table.header, rows: table.rows })
    table = null
  }
  const flushList = () => {
    if (!list) return
    current.blocks.push({ kind: 'list', ordered: list.ordered, items: list.items })
    list = null
  }
  const flushInline = () => {
    flushParagraph()
    flushTable()
    flushList()
  }
  const flushAll = () => {
    flushInline()
    if (current.title || current.blocks.length) sections.push(current)
  }

  for (const line of lines) {
    const heading = /^(#{1,6})\s+(.*)$/.exec(line)
    if (heading) {
      flushAll()
      current = { title: heading[2].trim(), level: heading[1].length, blocks: [] }
      continue
    }
    const isRow = line.trim().startsWith('|')
    if (isRow) {
      flushParagraph()
      flushList()
      const cells = splitRow(line)
      if (!table) table = { header: cells, rows: [] }
      else if (cells.every(cell => /^:?-{2,}:?$/.test(cell.trim())) && table.rows.length === 0) {
        /* separator row: ignore */
      } else table.rows.push(cells)
      continue
    }
    const listItem = /^\s*(\d+[.)]|[-*+])\s+(.*)$/.exec(line)
    if (listItem) {
      flushParagraph()
      flushTable()
      const ordered = /\d/.test(listItem[1])
      if (list && list.ordered !== ordered) flushList()
      if (!list) list = { ordered, items: [] }
      list.items.push(listItem[2].trim())
      continue
    }
    flushTable()
    flushList()
    if (line.trim() === '') flushParagraph()
    else paragraph.push(line.trim())
  }
  flushAll()
  return sections.filter(section => section.title || section.blocks.length)
}

/** Split one Markdown table row into trimmed cells. */
function splitRow(line) {
  const body = line.trim().replace(/^\|/, '').replace(/\|$/, '')
  const cells = []
  let buffer = ''
  let inCode = false
  for (const char of body) {
    if (char === '`') inCode = !inCode
    if (char === '|' && !inCode) {
      cells.push(buffer.trim())
      buffer = ''
      continue
    }
    buffer += char
  }
  cells.push(buffer.trim())
  return cells
}

/**
 * Assemble the whole board payload for the browser half.
 * @param {object} [options]
 * @param {string} [options.sessionsRoot]
 * @param {number} [options.now] override for tests
 * @returns {Promise<object>}
 */
export async function buildBoard(options = {}) {
  const sessionsRoot = options.sessionsRoot ?? DEFAULT_SESSIONS_ROOT
  const workspaces = options.workspaces ?? await discoverWorkspaces({ sessionsRoot })
  const rows = []
  for (const workspace of workspaces) {
    const board = readBoard(workspace.cwd)
    rows.push({
      cwd: workspace.cwd,
      name: workspace.cwd.split('/').filter(Boolean).pop() ?? workspace.cwd,
      lastAt: workspace.lastAt,
      sessionCount: workspace.sessions.length,
      sessions: workspace.sessions,
      board: board
        ? {
            path: board.path,
            relativePath: board.relativePath,
            mtime: board.mtime,
            truncated: board.truncated,
            sections: parseMarkdown(board.markdown),
          }
        : null,
      tried: BOARD_CANDIDATES,
    })
  }
  // Workspaces that actually have a state file first, then by recency.
  rows.sort((a, b) => {
    if (Boolean(a.board) !== Boolean(b.board)) return a.board ? -1 : 1
    return b.lastAt - a.lastAt
  })
  return {
    generatedAt: options.now ?? Date.now(),
    sessionsRoot,
    candidates: BOARD_CANDIDATES,
    workspaces: rows,
  }
}
