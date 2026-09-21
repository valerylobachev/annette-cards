// Fixed time zone with daylight saving time, so study-day tests behave the same on every machine and in CI.
process.env.TZ = 'Europe/Riga'

// IndexedDB for Dexie in jsdom; must load before any module opens the database.
import 'fake-indexeddb/auto'
import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'
import '@/i18n'

// Vitest runs without globals, so Testing Library cannot register its automatic cleanup.
afterEach(cleanup)

// jsdom does not implement scrolling; the router's scroll restoration calls it.
window.scrollTo = () => {}
