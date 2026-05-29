'use strict'

const feed = document.getElementById('context-feed')
const wsWaiting = document.getElementById('ws-waiting')
const promptIcon = document.getElementById('prompt-icon')

// id -> card element, for tool_result matching
const pendingTools = new Map()

function escHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function setPromptPulse(active) {
  if (!promptIcon) return
  promptIcon.classList.toggle('pulsing', active)
}

function scrollFeed() {
  feed.scrollTop = feed.scrollHeight
}

function appendCard(type, ev) {
  const card = document.createElement('div')
  card.className = 'ai-card card-' + type

  if (type === 'thinking') {
    card.innerHTML = `
      <div class="card-thinking">
        <span class="thinking-dot"></span>
        <span class="thinking-text">${escHtml((ev.input || '').slice(0, 80))}</span>
      </div>`
  } else if (type === 'response') {
    const id = 'resp-' + Date.now()
    card.innerHTML = `
      <span class="card-icon">◆</span>
      <span class="card-text" id="${id}">${escHtml(ev.text || '')}</span>
      <span class="show-more" data-target="${id}" style="display:none">Show more</span>`
    // Check if content overflows 4 lines
    requestAnimationFrame(() => {
      const textEl = card.querySelector('.card-text')
      const toggle = card.querySelector('.show-more')
      if (textEl && toggle && textEl.scrollHeight > textEl.clientHeight + 2) {
        toggle.style.display = 'inline-block'
        toggle.addEventListener('click', () => {
          textEl.classList.toggle('expanded')
          toggle.textContent = textEl.classList.contains('expanded') ? 'Show less' : 'Show more'
        })
      }
    })
  } else if (type === 'tool') {
    card.innerHTML = `
      <div class="tool-cmd">${escHtml(ev.command || '')}</div>
      <div class="tool-explain">${escHtml(ev.explanation || '')}</div>`
  }

  feed.appendChild(card)
  scrollFeed()
  return card
}

let thinkingCard = null

function handleEvent(ev) {
  if (!ev || !ev.type) return

  switch (ev.type) {
    case 'ai_thinking':
      if (thinkingCard) thinkingCard.remove()
      thinkingCard = appendCard('thinking', ev)
      setPromptPulse(true)
      break

    case 'ai_response':
      if (thinkingCard) { thinkingCard.remove(); thinkingCard = null }
      appendCard('response', ev)
      setPromptPulse(false)
      break

    case 'tool_start': {
      const card = appendCard('tool', ev)
      pendingTools.set(ev.command, card)
      break
    }

    case 'tool_result': {
      const card = pendingTools.get(ev.command)
      if (card) {
        pendingTools.delete(ev.command)
        const badge = ev.exit_code === 0
          ? '<span class="exit-badge ok">✓</span>'
          : `<span class="exit-badge fail">✗ ${ev.exit_code}</span>`
        const stdoutId = 'stdout-' + Date.now()
        const stdout = (ev.stdout || '').split('\n').slice(0, 3).join('\n')
        const resultDiv = document.createElement('div')
        resultDiv.className = 'tool-result'
        resultDiv.innerHTML = `
          ${badge}
          <pre class="tool-stdout" id="${stdoutId}">${escHtml(stdout)}</pre>`
        card.appendChild(resultDiv)
        // Click to expand stdout
        const pre = resultDiv.querySelector('.tool-stdout')
        if (pre) {
          pre.addEventListener('click', () => {
            pre.classList.toggle('expanded')
            if (pre.classList.contains('expanded')) {
              pre.textContent = ev.stdout || ''
            } else {
              pre.textContent = (ev.stdout || '').split('\n').slice(0, 3).join('\n')
            }
          })
        }
        scrollFeed()
      }
      break
    }

    case 'agent_registered':
    case 'agent_update':
      // Route to agent panel via a synthetic event
      window.agentBridge && window.dispatchEvent(
        new CustomEvent('_agent-ws-event', { detail: ev })
      )
      break

    case 'mcp_status':
      window.dispatchEvent(new CustomEvent('_mcp-status', { detail: ev.servers }))
      break
  }
}

// WebSocket with reconnect
let ws = null

function connect() {
  ws = new WebSocket('ws://localhost:7700')

  ws.onopen = () => {
    if (wsWaiting) wsWaiting.remove()
  }

  ws.onclose = () => {
    ws = null
    setTimeout(connect, 2000)
  }

  ws.onerror = () => {
    // onclose fires after onerror; nothing to do here
  }

  ws.onmessage = e => {
    try {
      handleEvent(JSON.parse(e.data))
    } catch (err) {
      console.warn('ai-context: bad message', err)
    }
  }
}

connect()
