import { defineProject } from "vitest/config";

// Спільні налаштування всіх трьох пакетів. node:test не мав ліміту часу, тому тут ліміти
// щедрі: частина тестів піднімає справжній сервер і чекає на мережу.
export const base = defineProject({
	test: {
		environment: "node",
		pool: "forks",
		include: ["test/**/*.test.{mjs,ts}"],
		testTimeout: 30_000,
		hookTimeout: 30_000,
	},
});
