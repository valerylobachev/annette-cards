import { RouterProvider } from '@tanstack/react-router'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { createAppRouter } from './app/router'
import './i18n'
import './index.css'

const router = createAppRouter()

const root = document.getElementById('root')
if (!root) throw new Error('#root element is missing')

createRoot(root).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
)
