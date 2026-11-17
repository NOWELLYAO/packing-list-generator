import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    // Application installable et utilisable hors ligne (entrepôt sans réseau)
    VitePWA({
      registerType: 'prompt',
      includeAssets: ['apple-touch-icon.png', 'exemple_packing_list.xlsx'],
      manifest: {
        name: 'Packing List',
        short_name: 'Packing List',
        description: 'Génération de Packing Lists à partir de vos PL existantes',
        lang: 'fr',
        start_url: '/',
        display: 'standalone',
        background_color: '#f3f5f8',
        theme_color: '#ffffff',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // l'application (y compris PDF, Excel, PDF.js) est gardée en mémoire dès la première visite
        globPatterns: ['**/*.{js,css,html,png,svg,ico,xlsx}'],
        globIgnores: ['tesseract/**', 'pdfjs/**'],
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
        cleanupOutdatedCaches: true,
        navigateFallback: '/index.html',
        // moteur OCR et décodeurs PDF (lourds) : téléchargés au premier besoin, puis gardés
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.startsWith('/tesseract/') || url.pathname.startsWith('/pdfjs/'),
            handler: 'CacheFirst',
            options: { cacheName: 'ocr-pdf-assets', expiration: { maxEntries: 60 } },
          },
        ],
      },
    }),
  ],
})
