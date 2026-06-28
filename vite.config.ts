import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const defaultSiteUrl = 'https://pyastreboff.github.io/hypersonics-visualiser';

function injectSeo(siteUrl: string) {
  return {
    name: 'inject-seo',
    transformIndexHtml(html: string) {
      return html.replaceAll('%SITE_URL%', siteUrl.replace(/\/$/, ''));
    },
  };
}

export default defineConfig({
  base: process.env.VITE_BASE_PATH || '/',
  plugins: [react(), injectSeo(process.env.VITE_SITE_URL || defaultSiteUrl)],
  resolve: {
    alias: {
      '@': '/src',
    },
  },
  worker: {
    format: 'es',
  },
  assetsInclude: ['**/*.wasm'],
});
