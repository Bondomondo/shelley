'use strict'

// Toggle AI panel
function toggleAiPanel() {
  const panel = document.getElementById('ai-panel')
  panel.classList.toggle('collapsed')
  const btn = document.getElementById('collapse-ai-panel')
  btn.textContent = panel.classList.contains('collapsed') ? '›' : '‹'
}

document.getElementById('collapse-ai-panel').addEventListener('click', toggleAiPanel)

window.uiBridge.onToggleAiPanel(toggleAiPanel)

window.uiBridge.onFocusTerminal(() => {
  if (window.termInstance) window.termInstance.focus()
})

// Prompt bar
const promptInput = document.getElementById('prompt-input')

promptInput.addEventListener('keydown', e => {
  if (e.key === 'Enter') {
    const val = promptInput.value
    promptInput.value = ''
    window.shellBridge.write(val + '\n')
  } else if (e.key === 'Escape') {
    promptInput.value = ''
    if (window.termInstance) window.termInstance.focus()
  }
  // Up/Down: TODO — cycle prompt_toolkit history
})

// Back to terminal button
document.getElementById('agent-back-btn').addEventListener('click', () => {
  document.getElementById('terminal-container').style.display = ''
  document.getElementById('agent-output-container').style.display = 'none'
  if (window.termInstance) {
    window.termInstance.focus()
    if (window._termFitAddon) window._termFitAddon.fit()
  }
})
