import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The RYG line status XML feed has no CORS header, so it is fetched through
// the dev server proxy. For production, `server/line-status-proxy.js` provides
// the same endpoint.
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api/line-status': {
        target: 'https://tnews.mtr.com.hk',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/line-status/, '/alert/ryg_line_status.xml'),
      },
      // The Next Train API is publicly CORS-enabled, but its CDN occasionally
      // omits the CORS header on throttled (429) responses. Proxying keeps the
      // browser path consistent and lets the client retry those cases properly.
      '/api/schedule': {
        target: 'https://rt.data.gov.hk',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/schedule/, '/v1/transport/mtr/getSchedule.php'),
      },
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
