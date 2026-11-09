import { createApp } from "./app.js";
import { ConfigError, loadConfig } from "./config.js";

let config;
try {
	config = loadConfig();
} catch (error) {
	if (!(error instanceof ConfigError)) throw error;
	console.error(error.message);
	process.exit(1);
}

const app = createApp(config);
const { port } = await app.listen();
console.log(
	`слухаю http://${config.host}:${port}  (клієнт: ${config.clientDir})`,
);

// once: другий Ctrl+C під час зависання завершує процес примусово
for (const signal of ["SIGINT", "SIGTERM"]) {
	process.once(signal, async () => {
		console.log(`${signal}: завершуюсь`);
		try {
			await app.close();
			console.log("готово");
			process.exit(0);
		} catch (error) {
			console.error("помилка при завершенні:", error);
			process.exit(1);
		}
	});
}
