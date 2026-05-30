'use strict'

// Terminal and FitAddon are globals loaded from xterm UMD scripts

const TERM_THEME = {
  background:   '#0e0e0c',
  foreground:   '#d4d2c8',
  cursor:       '#5DCAA5',
  cursorAccent: '#0e0e0c',
  black:        '#2c2c2a',
  red:          '#E24B4A',
  green:        '#639922',
  yellow:       '#FAC775',
  blue:         '#AFA9EC',
  magenta:      '#D4537E',
  cyan:         '#5DCAA5',
  white:        '#d4d2c8',
  brightBlack:  '#5F5E5A',
  brightWhite:  '#f0eeea',
}

const termTabs = new Map()   // tabId -> { term, fitAddon, el }
const termContainer = document.getElementById('terminal-container')

// ── Create a new terminal for a tab ──────────────────────────────────────────

function createTerminalTab(tabId) {
  const el = document.createElement('div')
  el.style.cssText = 'width:100%;height:100%;display:none;position:absolute;top:0;left:0'
  termContainer.appendChild(el)

  const term = new Terminal({
    fontFamily: '"JetBrains Mono", monospace',
    fontSize: 14,
    lineHeight: 1.5,
    theme: TERM_THEME,
    cursorBlink: true,
    scrollback: 5000,
    allowTransparency: true,
  })

  const fitAddon = new FitAddon.FitAddon()
  term.loadAddon(fitAddon)
  term.open(el)

  // Key input → PTY
  term.onData(data => window.shellBridge.write(tabId, data))

  termTabs.set(tabId, { term, fitAddon, el })
  return { term, fitAddon, el }
}

// ── Switch to a tab ───────────────────────────────────────────────────────────

function activateTab(tabId) {
  // Hide current
  if (window._activeTabId && termTabs.has(window._activeTabId)) {
    termTabs.get(window._activeTabId).el.style.display = 'none'
  }

  window._activeTabId = tabId
  const tab = termTabs.get(tabId)
  if (!tab) return

  tab.el.style.display = ''
  requestAnimationFrame(() => {
    tab.fitAddon.fit()
    window.shellBridge.resize(tabId, tab.term.cols, tab.term.rows)
    tab.term.focus()
  })

  // Keep legacy references pointing at the active terminal
  window.termInstance   = tab.term
  window._termFitAddon  = tab.fitAddon

  // Notify tab bar
  window.dispatchEvent(new CustomEvent('tab-activated', { detail: tabId }))
}

// ── Remove a tab's terminal ───────────────────────────────────────────────────

function removeTerminalTab(tabId) {
  const tab = termTabs.get(tabId)
  if (!tab) return
  tab.term.dispose()
  tab.el.remove()
  termTabs.delete(tabId)

  // If this was the active tab, switch to the last remaining one
  if (window._activeTabId === tabId) {
    const remaining = [...termTabs.keys()]
    if (remaining.length > 0) activateTab(remaining[remaining.length - 1])
  }
}

// ── Expose helpers for tab-bar.js ─────────────────────────────────────────────

window.termManager = { activateTab, removeTerminalTab, termTabs }

// ── Wire IPC ──────────────────────────────────────────────────────────────────

window.shellBridge.onData((tabId, data) => {
  termTabs.get(tabId)?.term.write(data)
})

window.shellBridge.onExit((tabId, exitCode, signal) => {
  const tab = termTabs.get(tabId)
  if (tab) {
    tab.term.write(
      `\r\n\x1b[31m[Shell exited — code ${exitCode}${signal ? ', signal ' + signal : ''}]\x1b[0m\r\n`
    )
  }
})

window.shellBridge.onTabCreated(({ tabId, title }) => {
  createTerminalTab(tabId)
  activateTab(tabId)
  window.dispatchEvent(new CustomEvent('tab-created', { detail: { tabId, title } }))
})

window.shellBridge.onTabClosed(tabId => {
  removeTerminalTab(tabId)
  window.dispatchEvent(new CustomEvent('tab-closed', { detail: tabId }))
})

window.shellBridge.onCloseActive(() => {
  if (window._activeTabId && termTabs.size > 1) {
    window.shellBridge.closeTab(window._activeTabId)
  }
})

// ── Resize observer ───────────────────────────────────────────────────────────

// Use position:absolute children so the container itself drives size
termContainer.style.position = 'relative'

const ro = new ResizeObserver(() => {
  requestAnimationFrame(() => {
    const tabId = window._activeTabId
    const tab   = tabId && termTabs.get(tabId)
    if (!tab) return
    tab.fitAddon.fit()
    window.shellBridge.resize(tabId, tab.term.cols, tab.term.rows)
  })
})
ro.observe(termContainer)
