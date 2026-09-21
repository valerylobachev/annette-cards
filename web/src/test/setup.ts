import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'
import '@/i18n'

// Vitest runs without globals, so Testing Library cannot register its automatic cleanup.
afterEach(cleanup)

// jsdom does not implement scrolling; the router's scroll restoration calls it.
window.scrollTo = () => {}
