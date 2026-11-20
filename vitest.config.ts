import { defineConfig } from "vitest/config";

// Один запуск `npm test` проганяє всі три пакети як окремі проєкти.
export default defineConfig({
	test: {
		projects: ["client", "server", "shared"],
		coverage: {
			provider: "v8",
			// міряємо лише shared/: це спільна симуляція й протокол, саме її вимагає лаба
			include: ["shared/{codec,protocol,sim}/**/*.ts"],
			reporter: ["text", "html"],
			reportsDirectory: "coverage",
		},
	},
});
