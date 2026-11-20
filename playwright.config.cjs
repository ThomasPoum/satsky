// Tests de bout en bout : la page est servie localement, le réseau (CelesTrak, Wikipédia) est simulé.
const { defineConfig, devices } = require('@playwright/test');
module.exports = defineConfig({
  testDir: 'tests',
  testMatch: /.*\.e2e\.cjs/,
  timeout: 60_000,
  use: {
    ...devices['Pixel 7'],
    baseURL: 'http://localhost:8765',
    launchOptions: process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}
  },
  webServer: { command: 'python3 -m http.server 8765', port: 8765, reuseExistingServer: true }
});
