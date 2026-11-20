import { defineConfig } from "vitest/config";

// Один запуск `npm test` проганяє всі три пакети як окремі проєкти.
export default defineConfig({
	test: {
		projects: ["client", "server", "shared"],
	},
});
