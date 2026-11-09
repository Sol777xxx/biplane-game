import path from "node:path";

export class ConfigError extends Error {
	constructor(problems) {
		super(`Некоректна конфігурація:\n - ${problems.join("\n - ")}`);
		this.name = "ConfigError";
		this.problems = problems;
	}
}

const ROOT = path.resolve(import.meta.dirname, "..", "..");

// Читає й перевіряє оточення. Збирає всі помилки одразу, а не лише першу.
export function loadConfig(env = process.env) {
	const problems = [];

	const rawPort = env.PORT ?? "3000";
	const port = Number(rawPort);
	if (!/^\d+$/.test(rawPort) || port > 65535) {
		problems.push(`PORT має бути цілим числом 0–65535, отримано "${rawPort}"`);
	}

	const host = (env.HOST ?? "127.0.0.1").trim();
	if (!host) problems.push("HOST порожній");

	if (problems.length) throw new ConfigError(problems);

	return Object.freeze({
		port,
		host,
		// відносні шляхи рахуються від каталогу, з якого запущено сервер (server/)
		logDir: path.resolve(env.LOG_DIR ?? "./logs"),
		clientDir: path.resolve(
			env.CLIENT_DIR ?? path.join(ROOT, "client", "dist"),
		),
	});
}
