'use strict'

const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('shellBridge', {
  onData:  (cb) => ipcRenderer.on('pty-data',  (_, data)   => cb(data)),
  onExit:  (cb) => ipcRenderer.on('pty-exit',  (_, info)   => cb(info)),
  write:   (data) => ipcRenderer.send('pty-write', data),
  resize:  (cols, rows) => ipcRenderer.send('pty-resize', { cols, rows }),
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
