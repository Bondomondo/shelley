'use strict'

function fmtUptime(seconds) {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (h > 0) return h + 'h ' + m + 'm'
  return m + 'm'
}

function updateGauge(id, percent) {
  const el = document.getElementById(id)
  if (!el) return
  const fill = el.querySelector('.gauge-fill')
  const pct  = el.querySelector('.gauge-pct')
  if (!fill || !pct) return
  fill.style.width = Math.min(100, percent) + '%'
  pct.textContent  = percent + '%'
  fill.classList.remove('warn', 'crit')
  if (percent >= 85)      fill.classList.add('crit')
  else if (percent >= 60) fill.classList.add('warn')
}

window.systemBridge.onStats(stats => {
  if (stats.cpu)     updateGauge('gauge-cpu',  stats.cpu.percent)
  if (stats.memory)  updateGauge('gauge-mem',  stats.memory.percent)
  if (stats.disk)    updateGauge('gauge-disk', stats.disk.percent)

  if (stats.network) {
    const el = document.getElementById('net-stats')
    if (el) el.textContent = `↓ ${stats.network.rx_kbps} KB/s   ↑ ${stats.network.tx_kbps} KB/s`
  }

  if (stats.uptime) {
    const el = document.getElementById('uptime-row')
    if (el) el.textContent = 'Up: ' + fmtUptime(stats.uptime.seconds)
  }
})
