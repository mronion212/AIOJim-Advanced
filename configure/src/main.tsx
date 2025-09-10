import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import './index.css'
import { ConfigProvider } from './contexts/ConfigContext'
import { ThemeProvider } from './components/ThemeProvider'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ThemeProvider defaultTheme="dark" storageKey="aio-addon-theme">
      <ConfigProvider>
        <App />
      </ConfigProvider>
    </ThemeProvider>
  </React.StrictMode>,
)
