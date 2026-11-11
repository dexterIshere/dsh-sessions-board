/**
 * Browser half: a "Sessions" sidebar entry and its page. Reads the read-only
 * board route once at open and then every 30 s; renders each workspace's state
 * file as readable sections and tables. No build step: a ModuleLoader factory,
 * the same shape the official plugin UI template uses.
 */
window.__ModuleLoader__.load({
  id: 'dsh-sessions-board',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const PANEL_ID = 'sessions-board'
    const ROUTE = '/sessions-board'
    const REFRESH_MS = 30000

    const color = {
      text: 'var(--dsw-alias-label-primary)',
      secondary: 'var(--dsw-alias-label-secondary)',
      border: 'var(--dsw-alias-border-l1)',
      surface: 'var(--dsw-alias-bg-layer-1)',
      accent: 'var(--dsw-alias-brand-primary)',
      error: 'var(--dsw-alias-state-error-primary)',
    }
    const pageStyle = {
      display: 'flex', flexDirection: 'column', gap: 16, width: '100%',
      maxWidth: 960, margin: '0 auto', padding: '28px 32px', boxSizing: 'border-box',
      color: color.text, overflowY: 'auto',
    }
    const cardStyle = {
      display: 'flex', flexDirection: 'column', gap: 12,
      background: color.surface, border: '1px solid ' + color.border,
      borderRadius: 12, padding: 18,
    }
    const titleStyle = { fontSize: 15, fontWeight: 600, margin: 0, color: color.text }
    const metaStyle = { fontSize: 12, color: color.secondary, margin: 0, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }
    const sectionTitleStyle = { fontSize: 13, fontWeight: 600, margin: '10px 0 6px', color: color.text }
    const textStyle = { fontSize: 13, lineHeight: 1.55, margin: '0 0 8px', color: color.secondary }
    const buttonStyle = {
      appearance: 'none', border: '1px solid ' + color.border, borderRadius: 8,
      background: 'transparent', color: color.text, padding: '6px 12px', fontSize: 13, cursor: 'pointer',
    }
    const tableStyle = { width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }
    const cellStyle = { borderTop: '1px solid ' + color.border, padding: '6px 8px', textAlign: 'left', verticalAlign: 'top', color: color.secondary }
    const headCellStyle = { ...cellStyle, color: color.text, fontWeight: 600, borderTop: 'none' }

    function Icon({ size = 16 }) {
      return h('svg', {
        viewBox: '0 0 24 24', width: size, height: size, fill: 'none',
        stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round',
        'aria-hidden': true, style: { display: 'block' },
      },
      h('rect', { x: 3, y: 4, width: 18, height: 6, rx: 2 }),
      h('rect', { x: 3, y: 14, width: 18, height: 6, rx: 2 }),
      h('path', { d: 'M7 7h.01M7 17h.01' }))
    }

    function formatWhen(value) {
      if (!value) return '—'
      try {
        return new Date(value).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })
      } catch {
        return String(value)
      }
    }

    /** Markdown cell → plain text: keep the words, drop the syntax. */
    function plain(text) {
      return String(text ?? '')
        .replace(/\*\*(.+?)\*\*/g, '$1')
        .replace(/`([^`]+)`/g, '$1')
        .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
        .replace(/<br\s*\/?>/gi, ' ')
    }

    function Table({ block, keyPrefix }) {
      return h('table', { style: tableStyle },
        h('thead', null,
          h('tr', null, (block.header || []).map((cell, index) => h('th', { key: keyPrefix + 'h' + index, style: headCellStyle }, plain(cell))))),
        h('tbody', null,
          (block.rows || []).map((row, rowIndex) => h('tr', { key: keyPrefix + 'r' + rowIndex },
            (row || []).map((cell, cellIndex) => h('td', { key: keyPrefix + 'c' + cellIndex, style: cellStyle }, plain(cell)))))))
    }

    const listStyle = { margin: '0 0 10px', paddingLeft: 22, fontSize: 13, lineHeight: 1.55, color: color.secondary }

    function List({ block, keyPrefix }) {
      const items = (block.items || []).map((item, index) => h('li', { key: keyPrefix + 'i' + index, style: { marginBottom: 4 } }, plain(item)))
      return h(block.ordered ? 'ol' : 'ul', { style: listStyle }, items)
    }

    function Blocks({ blocks, keyPrefix }) {
      return (blocks || []).map((block, blockIndex) => {
        const key = keyPrefix + '_b' + blockIndex
        if (block.kind === 'table') return h(Table, { key, block, keyPrefix: key + '_' })
        if (block.kind === 'list') return h(List, { key, block, keyPrefix: key + '_' })
        return h('p', { key, style: textStyle }, plain(block.text))
      })
    }

    function Workspace({ workspace, index }) {
      const board = workspace.board
      return h('section', { style: cardStyle },
        h('div', null,
          h('h2', { style: titleStyle }, workspace.name),
          h('p', { style: metaStyle }, workspace.cwd),
          h('p', { style: { ...metaStyle, marginTop: 4 } },
            workspace.sessionCount + (workspace.sessionCount > 1 ? ' sessions' : ' session')
            + (workspace.subagentCount ? ' · ' + workspace.subagentCount + (workspace.subagentCount > 1 ? ' sous-agents' : ' sous-agent') : '')
            + ' · dernière écriture ' + formatWhen(workspace.lastAt)
            + (board ? ' · ' + board.relativePath : ' · aucun fichier d\'état'))),
        board
          ? board.sections.map((section, sectionIndex) => h('div', { key: 'sec' + index + '_' + sectionIndex },
              section.title && section.level !== 1 ? h('h3', { style: sectionTitleStyle }, section.title) : null,
              h(Blocks, { blocks: section.blocks, keyPrefix: 's' + index + '_' + sectionIndex })))
          : h('p', { style: textStyle }, 'Cherché : ' + (workspace.tried || []).join(', ')),
        board && board.truncated ? h('p', { style: { ...textStyle, color: color.error } }, 'Fichier tronqué à la lecture.') : null)
    }

    function Panel() {
      const [state, setState] = React.useState({ status: 'loading', data: null, error: null })
      const load = React.useCallback(async () => {
        setState(previous => ({ status: previous.data ? 'refreshing' : 'loading', data: previous.data, error: null }))
        try {
          const response = await fetch(ROUTE, { headers: { accept: 'application/json' } })
          const data = await response.json()
          setState({ status: 'ready', data, error: data && data.error ? data.error : null })
        } catch (error) {
          setState(previous => ({ status: 'error', data: previous.data, error: error && error.message ? error.message : String(error) }))
        }
      }, [])
      React.useEffect(() => {
        let alive = true
        const timer = setInterval(() => { if (alive) void load() }, REFRESH_MS)
        void load()
        return () => { alive = false; clearInterval(timer) }
      }, [load])

      const data = state.data
      const workspaces = data && Array.isArray(data.workspaces) ? data.workspaces : []

      return h('div', { style: pageStyle },
        h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 } },
          h('div', null,
            h('h1', { style: { ...titleStyle, fontSize: 18 } }, 'Sessions'),
            h('p', { style: { ...textStyle, margin: '4px 0 0' } },
              data ? workspaces.length + ' espace(s) de travail · lu ' + formatWhen(data.generatedAt) : 'Lecture…')),
          h('button', { type: 'button', style: buttonStyle, onClick: () => { void load() }, disabled: state.status === 'loading' },
            state.status === 'refreshing' ? 'Actualisation…' : 'Actualiser')),
        state.error ? h('p', { style: { ...textStyle, color: color.error } }, 'Erreur : ' + state.error) : null,
        ...workspaces.map((workspace, index) => h(Workspace, { key: workspace.cwd || index, workspace, index })),
        !workspaces.length && state.status !== 'loading'
          ? h('p', { style: textStyle }, 'Aucun espace de travail trouvé dans le magasin de sessions.')
          : null)
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        ctx.slots.inject('main', () => ctx.slots.register({
          name: 'main', key: PANEL_ID,
        }, Panel))

        ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
          name: 'sidebar.panellist', id: PANEL_ID, order: 6,
          label: () => 'Sessions',
        }, Icon))
      },
    }
  },
})
