import { createApp } from "./app.ts";
import { type Config, ConfigError, loadConfig } from "./config.ts";
import { seedRooms } from "./rooms.ts";

let config: Config;
try {
	config = loadConfig();
} catch (error: unknown) {
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
if (config.enableNetsim)
	console.warn("УВАГА: штучна затримка/втрати увімкнено (ENABLE_NETSIM=1)");

// once: другий Ctrl+C під час зависання завершує процес примусово
for (const signal of ["SIGINT", "SIGTERM"]) {
	process.once(signal, async () => {
		console.log(`${signal}: завершуюсь`);
		try {
			await app.close();
			console.log("готово");
			process.exit(0);
		} catch (error: unknown) {
			console.error("помилка при завершенні:", error);
			process.exit(1);
		}
	});
}
