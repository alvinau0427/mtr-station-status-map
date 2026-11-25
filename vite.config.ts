import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { createAggregator } from './server/aggregator.js';

// Dev uses the same in-memory aggregator as the production server, so local
// development behaves exactly like the deployed app: one snapshot request per
// client, with the upstream APIs polled slowly in the background.
const snapshotApi = () => {
  const aggregator = createAggregator();
  return {
    name: 'snapshot-api',
    configureServer(server: { middlewares: { use: (path: string, handler: unknown) => void } }) {
      if (process.env.VITEST) return;
      aggregator.start();
      server.middlewares.use('/api/snapshot', aggregator.handleSnapshot);
      server.middlewares.use('/api/refresh', aggregator.handleRefresh);
      server.middlewares.use('/api/full-scan', aggregator.handleFullScan);
    },
  };
};

export default defineConfig({
  plugins: [react(), snapshotApi()],
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'server/**/*.test.js'],
  },
});
