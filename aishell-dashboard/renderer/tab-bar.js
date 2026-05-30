'use strict'

// tab-bar.js — renders and manages the tab strip above the terminal.
// Depends on terminal.js (window.termManager) being loaded first.

const tabBar = document.getElementById('tab-bar')
const newBtn = document.createElement('button')
newBtn.id = 'tab-new-btn'
newBtn.title = 'New tab (Ctrl+T)'
newBtn.textContent = '+'
tabBar.appendChild(newBtn)
newBtn.addEventListener('click', () => window.shellBridge.newTab())

let tabsList = []   // [{ tabId, title }]

// ── Render ────────────────────────────────────────────────────────────────────

function render() {
  // Remove all tab elements (not the + button)
  tabBar.querySelectorAll('.tab').forEach(el => el.remove())

  tabsList.forEach(({ tabId, title }) => {
    const el = document.createElement('div')
    el.className = 'tab' + (tabId === window._activeTabId ? ' active' : '')
    el.dataset.tabId = tabId

    const label = document.createElement('span')
    label.className = 'tab-label'
    label.textContent = title

    const close = document.createElement('button')
    close.className = 'tab-close'
    close.title = 'Close tab'
    close.textContent = '×'
    close.addEventListener('click', ev => {
      ev.stopPropagation()
      if (tabsList.length > 1) window.shellBridge.closeTab(tabId)
    })

    el.appendChild(label)
    el.appendChild(close)
    el.addEventListener('click', () => window.termManager.activateTab(tabId))

    // Insert before the + button
    tabBar.insertBefore(el, newBtn)
  })
}

// ── Events from terminal.js ───────────────────────────────────────────────────

window.addEventListener('tab-created', e => {
  const { tabId, title } = e.detail
  tabsList.push({ tabId, title })
  render()
})

window.addEventListener('tab-closed', e => {
  const tabId = e.detail
  tabsList = tabsList.filter(t => t.tabId !== tabId)
  render()
})

window.addEventListener('tab-activated', e => {
  render()
})

// ── Keyboard shortcuts (renderer-side) ────────────────────────────────────────

document.addEventListener('keydown', e => {
  // Ctrl+1-9: switch to tab N
  if (e.ctrlKey && !e.altKey && !e.shiftKey && e.key >= '1' && e.key <= '9') {
    const idx = parseInt(e.key) - 1
    if (idx < tabsList.length) {
      e.preventDefault()
      window.termManager.activateTab(tabsList[idx].tabId)
    }
    return
  }

  // Ctrl+Tab: next tab
  if (e.ctrlKey && !e.altKey && !e.shiftKey && e.key === 'Tab') {
    e.preventDefault()
    const idx = tabsList.findIndex(t => t.tabId === window._activeTabId)
    if (idx !== -1) window.termManager.activateTab(tabsList[(idx + 1) % tabsList.length].tabId)
    return
  }

  // Ctrl+Shift+Tab: previous tab
  if (e.ctrlKey && !e.altKey && e.shiftKey && e.key === 'Tab') {
    e.preventDefault()
    const idx = tabsList.findIndex(t => t.tabId === window._activeTabId)
    if (idx !== -1) window.termManager.activateTab(tabsList[(idx - 1 + tabsList.length) % tabsList.length].tabId)
  }
})
