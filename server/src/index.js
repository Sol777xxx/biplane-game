import { createApp } from "./app.js";
import { ConfigError, loadConfig } from "./config.js";
import { seedRooms } from "./rooms.js";

let config;
try {
	config = loadConfig();
} catch (error) {
	if (!(error instanceof ConfigError)) throw error;
	console.error(error.message);
	process.exit(1);
}

const app = createApp(config, { game: true });
seedRooms(app.rooms);
const { port } = await app.listen();
console.log(
	`слухаю http://${config.host}:${port}  (клієнт: ${config.clientDir})`,
);
console.log(`логи матчів: ${config.logDir}`);

console.log(`ліміт кімнат: ${config.maxRooms}`);
if (config.enableSlow)
	console.warn("УВАГА: /api/slow увімкнено (ENABLE_SLOW=1)");

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
