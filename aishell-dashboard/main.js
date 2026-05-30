'use strict'

const { app, BrowserWindow, globalShortcut, ipcMain } = require('electron')
const path = require('path')
const fs = require('fs')
const { exec } = require('child_process')

let win = null
let prevCpu = null
let prevNet = null
let statsInterval = null

// ─── Tab / PTY management ─────────────────────────────────────────────────────

const tabs = new Map()   // tabId -> { ptyProcess, resizeTimer }
let tabIdCounter = 0

const projectRoot = path.join(__dirname, '..')
const venvPython  = path.join(projectRoot, '.venv', 'bin', 'python3')
const pythonBin   = fs.existsSync(venvPython) ? venvPython : 'python3'
const shellPath   = path.join(projectRoot, 'aishell.py')

function createTab() {
  let pty
  try { pty = require('node-pty') } catch (e) {
    console.error('node-pty not available:', e.message)
    return null
  }

  const tabId   = ++tabIdCounter
  const wsPort  = tabId === 1 ? '7700' : '0'   // only first tab runs WS server
  const title   = `Shell ${tabId}`

  const ptyProcess = pty.spawn(pythonBin, [shellPath], {
    name: 'xterm-color',
    cols: 120,
    rows: 40,
    cwd:  projectRoot,
    env:  Object.assign({}, process.env, {
      TERM: 'xterm-color',
      AISHELL_WS_PORT: wsPort,
    }),
  })

  ptyProcess.onData(data => {
    if (win && !win.isDestroyed()) win.webContents.send('pty-data', { tabId, data })
  })

  ptyProcess.onExit(({ exitCode, signal }) => {
    if (win && !win.isDestroyed()) win.webContents.send('pty-exit', { tabId, exitCode, signal })
    tabs.delete(tabId)
  })

  tabs.set(tabId, { ptyProcess, resizeTimer: null })

  if (win && !win.isDestroyed()) win.webContents.send('tab-created', { tabId, title })

  return tabId
}

function closeTab(tabId) {
  const tab = tabs.get(tabId)
  if (!tab) return
  clearTimeout(tab.resizeTimer)
  try { tab.ptyProcess.kill('SIGTERM') } catch (_) {}
  tabs.delete(tabId)
  if (win && !win.isDestroyed()) win.webContents.send('tab-closed', tabId)
}

// ─── IPC ─────────────────────────────────────────────────────────────────────

ipcMain.on('pty-write', (_, { tabId, data }) => {
  const tab = tabs.get(tabId)
  if (tab) tab.ptyProcess.write(data)
})

ipcMain.on('pty-resize', (_, { tabId, cols, rows }) => {
  const tab = tabs.get(tabId)
  if (!tab) return
  clearTimeout(tab.resizeTimer)
  tab.resizeTimer = setTimeout(() => {
    try { tab.ptyProcess.resize(cols, rows) } catch (_) {}
  }, 100)
})

ipcMain.on('tab-new',   ()        => createTab())
ipcMain.on('tab-close', (_, tabId) => closeTab(tabId))

// ─── Window ───────────────────────────────────────────────────────────────────

function createWindow() {
  win = new BrowserWindow({
    fullscreen: true,
    frame: false,
    backgroundColor: '#0e0e0c',
    icon: path.join(__dirname, 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'))

  if (process.argv.includes('--dev')) {
    win.webContents.openDevTools({ mode: 'detach' })
  }
}

// ─── System stats ─────────────────────────────────────────────────────────────

function parseCpuLine(line) {
  const parts = line.trim().split(/\s+/)
  const nums = parts.slice(1).map(Number)
  const idle = nums[3] + (nums[4] || 0)
  const total = nums.reduce((a, b) => a + b, 0)
  return { idle, total }
}

async function readCpu() {
  return new Promise(resolve => {
    fs.readFile('/proc/stat', 'utf8', (err, data) => {
      if (err) return resolve(null)
      const line = data.split('\n').find(l => l.startsWith('cpu '))
      resolve(line ? parseCpuLine(line) : null)
    })
  })
}

async function readMemory() {
  return new Promise(resolve => {
    fs.readFile('/proc/meminfo', 'utf8', (err, data) => {
      if (err) return resolve({ used_gb: 0, total_gb: 0, percent: 0 })
      const get = key => { const m = data.match(new RegExp(key + ':\\s+(\\d+)')); return m ? parseInt(m[1]) : 0 }
      const total = get('MemTotal'), avail = get('MemAvailable'), used = total - avail
      resolve({ used_gb: +(used/1024/1024).toFixed(1), total_gb: +(total/1024/1024).toFixed(1), percent: total ? Math.round(used/total*100) : 0 })
    })
  })
}

async function readDisk() {
  return new Promise(resolve => {
    exec('df -h /', (err, stdout) => {
      if (err) return resolve({ free_gb: 0, total_gb: 0, percent: 0 })
      const cols = stdout.trim().split('\n')[1]?.trim().split(/\s+/) || []
      const p = s => { const n = parseFloat(s); return s.endsWith('G') ? n : s.endsWith('T') ? n*1024 : s.endsWith('M') ? +(n/1024).toFixed(2) : n }
      resolve({ total_gb: p(cols[1]||'0'), free_gb: p(cols[3]||'0'), percent: parseInt((cols[4]||'0%').replace('%',''))||0 })
    })
  })
}

async function readNetwork() {
  return new Promise(resolve => {
    fs.readFile('/proc/net/dev', 'utf8', (err, data) => {
      if (err) return resolve({ rx: 0, tx: 0 })
      for (const line of data.trim().split('\n').slice(2)) {
        const [iface, stats] = line.split(':')
        if (!stats || iface.trim() === 'lo') continue
        const nums = stats.trim().split(/\s+/).map(Number)
        return resolve({ rx: nums[0], tx: nums[8] })
      }
      resolve({ rx: 0, tx: 0 })
    })
  })
}

async function readUptime() {
  return new Promise(resolve => {
    fs.readFile('/proc/uptime', 'utf8', (err, data) => {
      resolve({ seconds: err ? 0 : Math.floor(parseFloat(data.split(' ')[0])) })
    })
  })
}

async function pollStats() {
  const [cpu, memory, disk, net, uptime] = await Promise.all([readCpu(), readMemory(), readDisk(), readNetwork(), readUptime()])
  let cpuPercent = 0
  if (cpu && prevCpu) { const dT = cpu.total - prevCpu.total, dI = cpu.idle - prevCpu.idle; cpuPercent = dT > 0 ? Math.round((1 - dI/dT)*100) : 0 }
  if (cpu) prevCpu = cpu
  let rx_kbps = 0, tx_kbps = 0
  if (prevNet) { rx_kbps = Math.max(0, +((net.rx - prevNet.rx)/1024/2).toFixed(1)); tx_kbps = Math.max(0, +((net.tx - prevNet.tx)/1024/2).toFixed(1)) }
  prevNet = net
  if (win && !win.isDestroyed()) win.webContents.send('sys-stats', { cpu: { percent: cpuPercent }, memory, disk, network: { rx_kbps, tx_kbps }, uptime })
}

// ─── Global shortcuts ─────────────────────────────────────────────────────────

function registerShortcuts() {
  const reg = (key, fn) => { if (!globalShortcut.register(key, fn)) console.warn(`${key} shortcut could not be registered`) }

  reg('Ctrl+Alt+Q', () => app.quit())

  reg('Ctrl+Alt+T', () => { if (win && !win.isDestroyed()) win.webContents.send('focus-terminal') })

  reg('Ctrl+Alt+A', () => { if (win && !win.isDestroyed()) win.webContents.send('toggle-ai-panel') })

  reg('Ctrl+T', () => createTab())

  reg('Ctrl+W', () => { if (win && !win.isDestroyed()) win.webContents.send('close-active-tab') })
}

// ─── App lifecycle ────────────────────────────────────────────────────────────

app.whenReady().then(async () => {
  createWindow()

  // Wait for renderer to be ready before sending tab-created
  win.webContents.once('did-finish-load', () => createTab())

  registerShortcuts()
  prevCpu = await readCpu()
  prevNet = await readNetwork()
  statsInterval = setInterval(pollStats, 2000)
})

app.on('will-quit', e => {
  e.preventDefault()
  globalShortcut.unregisterAll()
  if (statsInterval) clearInterval(statsInterval)

  const procs = [...tabs.values()].map(t => t.ptyProcess).filter(Boolean)
  tabs.clear()

  if (procs.length === 0) { app.exit(0); return }

  let done = 0
  const finish = () => { if (++done >= procs.length) app.exit(0) }
  procs.forEach(p => { p.onExit(finish); try { p.kill('SIGTERM') } catch (_) {} })
  setTimeout(() => app.exit(0), 2000)
})

app.on('window-all-closed', () => app.quit())
