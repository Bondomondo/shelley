'use strict'

// Terminal and FitAddon are globals loaded from xterm UMD scripts

const term = new Terminal({
  fontFamily: '"JetBrains Mono", monospace',
  fontSize: 14,
  lineHeight: 1.5,
  theme: {
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
  },
  cursorBlink: true,
  scrollback: 5000,
  allowTransparency: true,
})

const fitAddon = new FitAddon.FitAddon()
term.loadAddon(fitAddon)

const container = document.getElementById('terminal-container')
term.open(container)

// Defer initial fit until layout is painted
requestAnimationFrame(() => {
  fitAddon.fit()
  window.shellBridge.resize(term.cols, term.rows)
})

// Wire pty data
window.shellBridge.onData(data => term.write(data))
term.onData(data => window.shellBridge.write(data))

// Handle shell exit
window.shellBridge.onExit(({ exitCode, signal }) => {
  term.write(`\r\n\x1b[31m[Shell exited — code ${exitCode}${signal ? ', signal ' + signal : ''}]\x1b[0m\r\n`)
})

// Resize observer
const ro = new ResizeObserver(() => {
  requestAnimationFrame(() => {
    fitAddon.fit()
    window.shellBridge.resize(term.cols, term.rows)
  })
})
ro.observe(container)

// Shared references
window.termInstance = term
window._termFitAddon = fitAddon
