import React from 'react'
import ReactDOM from 'react-dom/client'
import { ConfigProvider } from 'antd'
import zhCN from 'antd/locale/zh_CN'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import './styles.css'

const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 20_000 } } })

async function bootstrap() {
  if ('serviceWorker' in navigator) {
    const { worker } = await import('./api/browser')
    await worker.start({ onUnhandledRequest: 'bypass' })
  }
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <ConfigProvider locale={zhCN} theme={{ token: { colorPrimary: '#176d78', borderRadius: 8, fontFamily: '"PingFang SC","Microsoft YaHei",sans-serif' } }}>
        <QueryClientProvider client={queryClient}>
          <BrowserRouter>
            <App />
          </BrowserRouter>
        </QueryClientProvider>
      </ConfigProvider>
    </React.StrictMode>,
  )
}

bootstrap()
