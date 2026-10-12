import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
export default defineConfig({
  base: "/japanese-app/",
  build: {
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            {
              name: "react",
              test: /node_modules[\\/](react(?:-dom)?|scheduler)[\\/]/,
            },
          ],
        },
      },
    },
  },
  plugins: [
    react(),
    VitePWA({
      registerType: "prompt",
      includeAssets: [
        "icon.svg",
        "icon-180.png",
        "icon-192.png",
        "icon-512.png",
      ],
      manifest: {
        name: "帰る · Japanese reactivation",
        short_name: "帰る",
        description: "Get your Japanese flowing again.",
        id: "/japanese-app/",
        start_url: "/japanese-app/",
        scope: "/japanese-app/",
        display: "standalone",
        background_color: "#f6f5ef",
        theme_color: "#253c36",
        icons: [
          {
            src: "icon-192.png",
            sizes: "192x192",
            type: "image/png",
            purpose: "any",
          },
          {
            src: "icon-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "any",
          },
          {
            src: "icon.svg",
            sizes: "any",
            type: "image/svg+xml",
            purpose: "any",
          },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,png,json,wasm}"],
        maximumFileSizeToCacheInBytes: 5_000_000,
      },
    }),
  ],
  test: { environment: "node", include: ["tests/**/*.test.ts"] },
});
