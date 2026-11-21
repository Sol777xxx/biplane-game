import { defineConfig } from "@playwright/test";

const PORT = 4173;
const BASE = `http://127.0.0.1:${PORT}`;

// e2e проганяє справжній сервер зі зібраним клієнтом: збірка, потім node server/src/index.ts.
// Окремий порт, щоб не конфліктувати з `npm run dev:server` на :3000.
export default defineConfig({
	testDir: "e2e",
	// усі тести діляться одним сервером і постійними кімнатами, тож без паралелізму
	fullyParallel: false,
	workers: 1,
	retries: process.env.CI ? 1 : 0,
	reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
	use: {
		baseURL: BASE,
		trace: "retain-on-failure",
	},
	projects: [{ name: "chromium", use: { browserName: "chromium" } }],
	webServer: {
		command: "npm run build && node server/src/index.ts",
		url: `${BASE}/api/rooms`,
		timeout: 120_000,
		reuseExistingServer: !process.env.CI,
		env: {
			PORT: String(PORT),
			HOST: "127.0.0.1",
			LOG_DIR: "test-results/server-logs",
		},
	},
});
