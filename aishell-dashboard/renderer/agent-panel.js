'use strict'

const agents = new Map() // id -> { name, status, message, lastSeen, output }

function statusClass(status) {
  if (status === 'running') return ''
  if (status === 'warn')    return 'warn'
  if (status === 'error' || status === 'stopped') return 'error'
  return 'gray'
}

function renderAgents() {
  const list = document.getElementById('agent-list')
  if (!list) return
  list.innerHTML = ''
  agents.forEach((agent, id) => {
    const item = document.createElement('div')
    item.className = 'agent-item'
    item.dataset.id = id
    item.innerHTML = `
      <div class="agent-header">
        <span class="agent-dot ${statusClass(agent.status)}"></span>
        <span class="agent-name">${escHtml(agent.name)}</span>
      </div>
      <div class="agent-desc">${escHtml(agent.message || '')}${agent.lastSeen ? ' · ' + timeAgo(agent.lastSeen) : ''}</div>
    `
    item.addEventListener('click', () => showAgentOutput(id))
    list.appendChild(item)
  })
}

function showAgentOutput(id) {
  const agent = agents.get(id)
  if (!agent) return
  document.getElementById('terminal-container').style.display = 'none'
  document.getElementById('agent-output-container').style.display = 'flex'
  document.getElementById('agent-output-title').textContent = agent.name
  const pre = document.getElementById('agent-output-pre')
  pre.textContent = agent.output || '(no output yet)'
  pre.scrollTop = pre.scrollHeight

  // Mark active
  document.querySelectorAll('.agent-item').forEach(el => el.classList.remove('active'))
  const el = document.querySelector(`.agent-item[data-id="${id}"]`)
  if (el) el.classList.add('active')
}

function timeAgo(ts) {
  const secs = Math.floor((Date.now() - ts) / 1000)
  if (secs < 60)   return secs + 's ago'
  if (secs < 3600) return Math.floor(secs / 60) + 'm ago'
  return Math.floor(secs / 3600) + 'h ago'
}

function escHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function processAgentEvent(ev) {
  if (ev.type === 'agent_registered') {
    agents.set(ev.id, {
      name: ev.name,
      status: 'running',
      message: '',
      lastSeen: Date.now(),
      output: '',
    })
  } else if (ev.type === 'agent_update') {
    const a = agents.get(ev.id)
    if (a) {
      a.status   = ev.status  || a.status
      a.message  = ev.message || a.message
      a.lastSeen = Date.now()
      a.output   = (a.output || '') + '\n' + (ev.message || '')
      // Refresh agent output view if it's currently visible
      const pre   = document.getElementById('agent-output-pre')
      const title = document.getElementById('agent-output-title')
      if (pre && title && title.textContent === a.name) {
        pre.textContent = a.output
        pre.scrollTop = pre.scrollHeight
      }
    }
  }
}

// Receive agent events from IPC (aishell spawns agents via main process)
window.agentBridge.onUpdate(events => {
  const arr = Array.isArray(events) ? events : [events]
  arr.forEach(processAgentEvent)
  renderAgents()
})

// Receive agent events forwarded from the WebSocket bridge (ai-context.js)
window.addEventListener('_agent-ws-event', e => {
  processAgentEvent(e.detail)
  renderAgents()
})

// Stale detection
setInterval(() => {
  let changed = false
  agents.forEach(agent => {
    const age = Date.now() - agent.lastSeen
    if (age > 300000 && agent.status !== 'gray') {
      agent.status = 'gray'; changed = true
    } else if (age > 60000 && agent.status === 'running') {
      agent.status = 'warn'; changed = true
    }
  })
  if (changed) renderAgents()
}, 10000)
