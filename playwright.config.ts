import { defineConfig } from '@playwright/test';

export default defineConfig({
	testDir: 'tests/e2e',
	fullyParallel: false,
	workers: 1,
	timeout: 30_000,
	expect: { timeout: 10_000 },
	use: {
		baseURL: 'http://127.0.0.1:4173',
		permissions: ['microphone'],
		trace: 'retain-on-failure',
		video: 'retain-on-failure',
		launchOptions: {
			args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream']
		}
	},
	projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
	webServer: [
		{
			command: 'pnpm build && pnpm preview --host 127.0.0.1',
			port: 4173,
			reuseExistingServer: true,
			env: { PUBLIC_E2E_SIGNALING_URL: 'ws://127.0.0.1:4174' }
		},
		{
			command: 'node tests/e2e/signaling-server.mjs',
			port: 4174,
			reuseExistingServer: true
		}
	],
	testMatch: '**/*.spec.ts'
});
