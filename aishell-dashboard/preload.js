'use strict'

const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('shellBridge', {
  // Tab-aware data flow
  onData:  (cb) => ipcRenderer.on('pty-data', (_, msg) => cb(msg.tabId, msg.data)),
  onExit:  (cb) => ipcRenderer.on('pty-exit', (_, msg) => cb(msg.tabId, msg.exitCode, msg.signal)),
  write:   (tabId, data) => ipcRenderer.send('pty-write', { tabId, data }),
  resize:  (tabId, cols, rows) => ipcRenderer.send('pty-resize', { tabId, cols, rows }),

  // Tab lifecycle
  newTab:         ()       => ipcRenderer.send('tab-new'),
  closeTab:       (tabId)  => ipcRenderer.send('tab-close', tabId),
  onTabCreated:   (cb)     => ipcRenderer.on('tab-created',      (_, info)  => cb(info)),
  onTabClosed:    (cb)     => ipcRenderer.on('tab-closed',       (_, tabId) => cb(tabId)),
  onCloseActive:  (cb)     => ipcRenderer.on('close-active-tab', ()         => cb()),
})

contextBridge.exposeInMainWorld('systemBridge', {
  onStats: (cb) => ipcRenderer.on('sys-stats', (_, stats) => cb(stats)),
})

contextBridge.exposeInMainWorld('agentBridge', {
  onUpdate: (cb) => ipcRenderer.on('agent-update', (_, agents) => cb(agents)),
})

contextBridge.exposeInMainWorld('uiBridge', {
  onFocusTerminal: (cb) => ipcRenderer.on('focus-terminal',  () => cb()),
  onToggleAiPanel: (cb) => ipcRenderer.on('toggle-ai-panel', () => cb()),
})
