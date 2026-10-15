import { defineConfig } from 'vite';

// Compile shared schemas once for Node. Vercel's function tracer otherwise
// rewrites the .ts files but leaves .mjs imports pointing at their old names.
export default defineConfig({
  build: {
    ssr: 'server/assistant-http.mjs',
    outDir: 'server-build',
    emptyOutDir: true,
    rolldownOptions: { output: { entryFileNames: 'assistant-http.mjs' } },
  },
});
