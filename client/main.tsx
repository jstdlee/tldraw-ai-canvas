import '@fontsource/inter/400.css'
import '@fontsource/inter/500.css'
import '@fontsource/inter/700.css'
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'
import './pipeline/index.css'
import './ai/ai.css'
import './shell/shell.css'

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
	<React.StrictMode>
		<App />
	</React.StrictMode>
)
