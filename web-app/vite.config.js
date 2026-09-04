/* global process */
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');

  // Safety Assertion: If building for production, enforce that target project is it114115-2627
  if (mode === 'production') {
    const projectId = env.VITE_PROJECT_ID || env.VITE_FIREBASE_PROJECT_ID;
    if (projectId && projectId !== 'it114115-2627') {
      throw new Error(
        `\n======================================================\n` +
        `[CRITICAL BUILD ERROR] Production build aborted!\n` +
        `Expected target projectId: 'it114115-2627'\n` +
        `Found projectId in environment: '${projectId}'\n` +
        `Please ensure you are using the correct production configuration.\n` +
        `======================================================\n`
      );
    }
  }

  return {
    plugins: [react()],
    test: {
      globals: true,
      environment: 'jsdom',
      setupFiles: './src/test/setup.js',
      isolate: true,
      fileParallelism: false,
      coverage: {
        provider: 'v8',
        reporter: ['text'],
      },
    },
  };
})
