/** `version` from web/package.json, set by Vite `define`. */
declare const __APP_VERSION__: string

/** Runtime dependencies with version and license (Settings → About), set by Vite `define`. */
declare const __LICENSES__: { name: string; version: string; license: string }[]
