'use strict'

let _mcpServers = []

// ── Helpers ───────────────────────────────────────────────────────────────────

function escHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function showTerminal() {
  document.getElementById('terminal-container').style.display    = ''
  document.getElementById('agent-output-container').style.display = 'none'
  document.getElementById('mcp-detail-container').style.display  = 'none'
  document.getElementById('commands-detail-container').style.display = 'none'
  if (window.termInstance) {
    window.termInstance.focus()
    if (window._termFitAddon) window._termFitAddon.fit()
  }
}

function dotClass(status) {
  if (status === 'connected')        return 'connected'
  if (status.startsWith('error'))    return 'error'
  if (status === 'connecting…')      return 'connecting'
  return ''
}

// ── MCP detail view ───────────────────────────────────────────────────────────

function showMcpDetail(server) {
  document.getElementById('terminal-container').style.display        = 'none'
  document.getElementById('agent-output-container').style.display    = 'none'
  document.getElementById('commands-detail-container').style.display = 'none'
  document.getElementById('mcp-detail-container').style.display      = 'flex'

  const statusLabel = server.status || 'disconnected'
  document.getElementById('mcp-detail-title').textContent = server.name

  const content = document.getElementById('mcp-detail-content')
  const tools   = server.tools || []

  content.innerHTML = `
    <div class="mcp-detail-status">
      <span class="mcp-dot ${escHtml(dotClass(statusLabel))}"></span>
      <span style="font-size:12px;color:var(--text)">${escHtml(statusLabel)}</span>
      <span style="font-size:11px;color:var(--text-dim);margin-left:8px">${escHtml(server.transport || 'stdio')}</span>
    </div>
    ${tools.length === 0
      ? '<p style="color:var(--text-dim);font-size:12px">No tools available</p>'
      : tools.map(t => `
          <div class="mcp-tool-row">
            <span class="mcp-tool-name">${escHtml(t)}</span>
          </div>`).join('')
    }
  `
}

// ── Sidebar render ────────────────────────────────────────────────────────────

function renderMcpServers(servers) {
  _mcpServers = servers || []
  const list = document.getElementById('mcp-list')
  if (!list) return

  if (_mcpServers.length === 0) {
    list.innerHTML = '<div class="mcp-empty">No servers configured</div>'
    return
  }

  list.innerHTML = ''
  _mcpServers.forEach(s => {
    const status = s.status || 'disconnected'
    const item = document.createElement('div')
    item.className = 'mcp-item'
    item.style.cursor = 'pointer'
    item.innerHTML = `
      <div class="mcp-row">
        <span class="mcp-dot ${escHtml(dotClass(status))}"></span>
        <span class="mcp-name">${escHtml(s.name)}</span>
        <span class="mcp-status">${escHtml(status)}</span>
      </div>
      ${s.tools && s.tools.length
        ? `<div class="mcp-tools">${escHtml(s.tools.slice(0, 5).join(' · '))}${s.tools.length > 5 ? ' …' : ''}</div>`
        : ''}
    `
    item.addEventListener('click', () => showMcpDetail(s))
    list.appendChild(item)
  })
}

// ── Back button ───────────────────────────────────────────────────────────────

document.getElementById('mcp-detail-back').addEventListener('click', showTerminal)

// ── WebSocket events ──────────────────────────────────────────────────────────

window.addEventListener('_mcp-status', e => renderMcpServers(e.detail))
