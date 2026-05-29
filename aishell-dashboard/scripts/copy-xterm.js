'use strict'
// Copies xterm UMD dist files into renderer/lib/ so Electron's CSP
// can load them as same-origin scripts without ../node_modules/ traversal.
const fs   = require('fs')
const path = require('path')

const root = path.join(__dirname, '..')
const dest = path.join(root, 'renderer', 'lib')

if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true })

const copies = [
  ['xterm/lib/xterm.js',               'xterm.js'],
  ['xterm/css/xterm.css',              'xterm.css'],
  ['xterm-addon-fit/lib/xterm-addon-fit.js', 'xterm-addon-fit.js'],
]

for (const [src, dst] of copies) {
  const from = path.join(root, 'node_modules', src)
  const to   = path.join(dest, dst)
  if (!fs.existsSync(from)) {
    console.warn(`copy-xterm: source not found: ${from}`)
    continue
  }
  fs.copyFileSync(from, to)
  console.log(`copy-xterm: ${src} → renderer/lib/${dst}`)
}
