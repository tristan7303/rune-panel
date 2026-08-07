import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { install as installMotion } from './motion'
import './styles.css'
import './article.css'

const container = document.getElementById('root')
if (!container) throw new Error('#root missing from index.html')

// Before the first render: #root has to be collapsed by the time main shows the
// window, and main shows it as soon as the renderer is ready.
installMotion()

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>
)
