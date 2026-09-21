import { defineConfig } from 'orval'

// `just gen-api` writes openapi.json from the server, then runs orval. Never edit src/api/ by hand.
export default defineConfig({
  annette: {
    input: { target: './openapi.json' },
    output: {
      mode: 'tags-split',
      target: './src/api/endpoints',
      schemas: './src/api/model',
      client: 'react-query',
      httpClient: 'fetch',
      clean: true,
    },
  },
})
