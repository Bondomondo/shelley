'use strict'

function renderMcpServers(servers) {
  const list = document.getElementById('mcp-list')
  if (!list) return

  if (!servers || servers.length === 0) {
    list.innerHTML = '<div class="mcp-empty">No servers configured</div>'
    return
  }

  list.innerHTML = ''
  servers.forEach(s => {
    const status = s.status || 'disconnected'
    const dotClass = status === 'connected'
      ? 'connected'
      : status.startsWith('error')
        ? 'error'
        : status === 'connecting…'
          ? 'connecting'
          : ''

    const item = document.createElement('div')
    item.className = 'mcp-item'
    item.innerHTML = `
      <div class="mcp-row">
        <span class="mcp-dot ${dotClass}"></span>
        <span class="mcp-name">${escHtml(s.name)}</span>
        <span class="mcp-status">${escHtml(status)}</span>
      </div>
      ${s.tools && s.tools.length
        ? `<div class="mcp-tools">${escHtml(s.tools.slice(0, 6).join('  ·  '))}${s.tools.length > 6 ? ' …' : ''}</div>`
        : ''}
    `
    list.appendChild(item)
  })
}

function escHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

// Receive mcp_status events forwarded from ai-context.js WebSocket
window.addEventListener('_mcp-status', e => {
  renderMcpServers(e.detail)
})
