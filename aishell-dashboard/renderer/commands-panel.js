'use strict'

let _commands = []

// ── Helpers ───────────────────────────────────────────────────────────────────

function escHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function showTerminal() {
  document.getElementById('terminal-container').style.display        = ''
  document.getElementById('agent-output-container').style.display    = 'none'
  document.getElementById('mcp-detail-container').style.display      = 'none'
  document.getElementById('commands-detail-container').style.display = 'none'
  if (window.termInstance) {
    window.termInstance.focus()
    if (window._termFitAddon) window._termFitAddon.fit()
  }
}

// ── Command detail view ───────────────────────────────────────────────────────

function showCommandDetail(cmd) {
  document.getElementById('terminal-container').style.display        = 'none'
  document.getElementById('agent-output-container').style.display    = 'none'
  document.getElementById('mcp-detail-container').style.display      = 'none'
  document.getElementById('commands-detail-container').style.display = 'flex'

  document.getElementById('commands-detail-title').textContent = ':' + cmd.name

  const cmds    = cmd.commands || []
  const created = (cmd.created || '').slice(0, 10)

  document.getElementById('commands-detail-content').innerHTML = `
    <div class="cmd-block">
      <div class="cmd-meta">Saved ${escHtml(created)} · run with <code style="color:var(--teal)">:${escHtml(cmd.name)}</code></div>
      ${cmds.map(c => `<div class="cmd-line">${escHtml(c)}</div>`).join('')}
    </div>
  `
}

// ── Sidebar render ────────────────────────────────────────────────────────────

function renderCommands(commands) {
  _commands = commands || []
  const list = document.getElementById('commands-list')
  if (!list) return

  if (_commands.length === 0) {
    list.innerHTML = '<div class="mcp-empty">No saved commands</div>'
    return
  }

  list.innerHTML = ''
  _commands.forEach(cmd => {
    const item = document.createElement('div')
    item.className = 'cmd-item'
    item.innerHTML = `
      <span class="cmd-item-name">:${escHtml(cmd.name)}</span>
      <span class="cmd-item-date">${escHtml((cmd.created || '').slice(0, 10))}</span>
    `
    item.addEventListener('click', () => showCommandDetail(cmd))
    list.appendChild(item)
  })
}

// ── Back button ───────────────────────────────────────────────────────────────

document.getElementById('commands-detail-back').addEventListener('click', showTerminal)

// ── WebSocket events ──────────────────────────────────────────────────────────

window.addEventListener('_commands-list', e => renderCommands(e.detail))
