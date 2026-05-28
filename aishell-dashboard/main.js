'use strict'

const { app, BrowserWindow, globalShortcut, ipcMain } = require('electron')
const path = require('path')
const fs = require('fs')
const { exec } = require('child_process')

let win = null
let ptyProcess = null
let prevCpu = null
let prevNet = null
let statsInterval = null

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

// ─── PTY ──────────────────────────────────────────────────────────────────────

function spawnPty() {
  let pty
  try {
    pty = require('node-pty')
  } catch (e) {
    console.error('node-pty not available:', e.message)
    return
  }

  const shellPath = path.join(__dirname, '..', 'aishell.py')
  ptyProcess = pty.spawn('python3', [shellPath], {
    name: 'xterm-color',
    cols: 120,
    rows: 40,
    cwd: path.join(__dirname, '..'),
    env: Object.assign({}, process.env, { TERM: 'xterm-color' }),
  })

  ptyProcess.onData(data => {
    if (win && !win.isDestroyed()) {
      win.webContents.send('pty-data', data)
    }
  })

  ptyProcess.onExit(({ exitCode, signal }) => {
    if (win && !win.isDestroyed()) {
      win.webContents.send('pty-exit', { exitCode, signal })
    }
  })
}

ipcMain.on('pty-write', (_, data) => {
  if (ptyProcess) ptyProcess.write(data)
})

// Debounced resize — only apply after 100 ms of quiet
let resizeTimer = null
ipcMain.on('pty-resize', (_, { cols, rows }) => {
  clearTimeout(resizeTimer)
  resizeTimer = setTimeout(() => {
    if (ptyProcess) {
      try { ptyProcess.resize(cols, rows) } catch (_) {}
    }
  }, 100)
})

// ─── System stats ─────────────────────────────────────────────────────────────

function parseCpuLine(line) {
  // cpu  user nice system idle iowait irq softirq steal guest guest_nice
  const parts = line.trim().split(/\s+/)
  const nums = parts.slice(1).map(Number)
  const idle = nums[3] + (nums[4] || 0) // idle + iowait
  const total = nums.reduce((a, b) => a + b, 0)
  return { idle, total }
}

async function readCpu() {
  return new Promise(resolve => {
    fs.readFile('/proc/stat', 'utf8', (err, data) => {
      if (err) return resolve(null)
      const line = data.split('\n').find(l => l.startsWith('cpu '))
      if (!line) return resolve(null)
      resolve(parseCpuLine(line))
    })
  })
}

async function readMemory() {
  return new Promise(resolve => {
    fs.readFile('/proc/meminfo', 'utf8', (err, data) => {
      if (err) return resolve({ used_gb: 0, total_gb: 0, percent: 0 })
      const get = key => {
        const m = data.match(new RegExp(key + ':\\s+(\\d+)'))
        return m ? parseInt(m[1]) : 0
      }
      const total = get('MemTotal')
      const avail = get('MemAvailable')
      const used = total - avail
      resolve({
        used_gb:  +(used  / 1024 / 1024).toFixed(1),
        total_gb: +(total / 1024 / 1024).toFixed(1),
        percent:  total ? Math.round(used / total * 100) : 0,
      })
    })
  })
}

async function readDisk() {
  return new Promise(resolve => {
    exec('df -h /', (err, stdout) => {
      if (err) return resolve({ free_gb: 0, total_gb: 0, percent: 0 })
      const lines = stdout.trim().split('\n')
      if (lines.length < 2) return resolve({ free_gb: 0, total_gb: 0, percent: 0 })
      const cols = lines[1].trim().split(/\s+/)
      // filesystem size used avail use% mountpoint
      const parseSize = s => {
        const n = parseFloat(s)
        if (s.endsWith('G')) return n
        if (s.endsWith('T')) return n * 1024
        if (s.endsWith('M')) return +(n / 1024).toFixed(2)
        return n
      }
      resolve({
        total_gb: parseSize(cols[1] || '0'),
        free_gb:  parseSize(cols[3] || '0'),
        percent:  parseInt((cols[4] || '0%').replace('%', '')) || 0,
      })
    })
  })
}

async function readNetwork() {
  return new Promise(resolve => {
    fs.readFile('/proc/net/dev', 'utf8', (err, data) => {
      if (err) return resolve({ rx_kbps: 0, tx_kbps: 0 })
      const lines = data.trim().split('\n').slice(2)
      let rx = 0, tx = 0
      for (const line of lines) {
        const [iface, stats] = line.split(':')
        if (!stats) continue
        const name = iface.trim()
        if (name === 'lo') continue
        const nums = stats.trim().split(/\s+/).map(Number)
        rx += nums[0]
        tx += nums[8]
        break // first non-lo interface
      }
      resolve({ rx, tx })
    })
  })
}

async function readUptime() {
  return new Promise(resolve => {
    fs.readFile('/proc/uptime', 'utf8', (err, data) => {
      if (err) return resolve({ seconds: 0 })
      resolve({ seconds: Math.floor(parseFloat(data.split(' ')[0])) })
    })
  })
}

async function pollStats() {
  const [cpu, memory, disk, net, uptime] = await Promise.all([
    readCpu(), readMemory(), readDisk(), readNetwork(), readUptime(),
  ])

  let cpuPercent = 0
  if (cpu && prevCpu) {
    const dTotal = cpu.total - prevCpu.total
    const dIdle  = cpu.idle  - prevCpu.idle
    cpuPercent = dTotal > 0 ? Math.round((1 - dIdle / dTotal) * 100) : 0
  }
  if (cpu) prevCpu = cpu

  let rx_kbps = 0, tx_kbps = 0
  if (prevNet) {
    rx_kbps = +((net.rx - prevNet.rx) / 1024 / 2).toFixed(1)
    tx_kbps = +((net.tx - prevNet.tx) / 1024 / 2).toFixed(1)
    if (rx_kbps < 0) rx_kbps = 0
    if (tx_kbps < 0) tx_kbps = 0
  }
  prevNet = net

  const stats = {
    cpu:     { percent: cpuPercent },
    memory,
    disk,
    network: { rx_kbps, tx_kbps },
    uptime,
  }

  if (win && !win.isDestroyed()) {
    win.webContents.send('sys-stats', stats)
  }
}

// ─── Global shortcuts ─────────────────────────────────────────────────────────

function registerShortcuts() {
  const r = globalShortcut.register
  if (!r.call(globalShortcut, 'Ctrl+Alt+Q', () => app.quit())) {
    console.warn('Ctrl+Alt+Q shortcut could not be registered')
  }
  globalShortcut.register('Ctrl+Alt+T', () => {
    if (win && !win.isDestroyed()) win.webContents.send('focus-terminal')
  })
  globalShortcut.register('Ctrl+Alt+A', () => {
    if (win && !win.isDestroyed()) win.webContents.send('toggle-ai-panel')
  })
}

// ─── App lifecycle ────────────────────────────────────────────────────────────

app.whenReady().then(async () => {
  createWindow()
  spawnPty()
  registerShortcuts()

  // Seed prevCpu and prevNet before first interval fires
  prevCpu = await readCpu()
  prevNet = await readNetwork()
  statsInterval = setInterval(pollStats, 2000)
})

app.on('will-quit', e => {
  e.preventDefault()
  globalShortcut.unregisterAll()
  if (statsInterval) clearInterval(statsInterval)
  if (ptyProcess) {
    let cleaned = false
    const finish = () => {
      if (cleaned) return
      cleaned = true
      app.exit(0)
    }
    ptyProcess.onExit(finish)
    try { ptyProcess.kill('SIGTERM') } catch (_) {}
    setTimeout(finish, 2000) // force exit after 2 s
  } else {
    app.exit(0)
  }
})

app.on('window-all-closed', () => app.quit())
