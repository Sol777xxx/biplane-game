import { createApp } from "./app.ts";
import { type Config, ConfigError, loadConfig } from "./config.ts";
import { createRootLogger, fromPino } from "./logger.ts";
import { seedRooms } from "./rooms.ts";

// Хостинг (docker stop, Render) дає після SIGTERM 10 с, потім шле SIGKILL.
// Нам вистачає з запасом; цей таймер лише страхує від завислого закриття.
const SHUTDOWN_DEADLINE_MS = 8000;

let config: Config;
try {
	config = loadConfig();
} catch (error: unknown) {
	if (!(error instanceof ConfigError)) throw error;
	// конфіг не прочитано, тож рівень логу невідомий: пишемо стандартним
	createRootLogger().fatal(
		{ problems: error.problems },
		"некоректна конфігурація",
	);
	process.exit(1);
}

const root = createRootLogger(config.logLevel);
const log = fromPino(root);

// Необроблений виняток: процес у невідомому стані. Не глушимо порожнім обробником:
// пишемо в лог (pino синхронний, рядок не загубиться) і завершуємось із кодом 1,
// а хостинг запустить процес наново.
function crash(kind: string, reason: unknown): never {
	const err = reason instanceof Error ? reason : new Error(String(reason));
	root.fatal({ err }, kind);
	process.exit(1);
}
process.on("uncaughtException", (error) => crash("uncaughtException", error));
process.on("unhandledRejection", (reason) =>
	crash("unhandledRejection", reason),
);

const app = createApp(config, { game: true, log });
seedRooms(app.rooms);
const { port } = await app.listen();
root.info(
	{
		host: config.host,
		port,
		sha: config.gitSha,
		clientDir: config.clientDir,
		logDir: config.logDir,
		maxRooms: config.maxRooms,
		maxPlayers: config.maxPlayers,
		maxConnPerIp: config.maxConnPerIp,
		allowedOrigins: config.allowedOrigins,
		trustProxy: config.trustProxy,
	},
	"сервер слухає",
);
if (config.enableSlow) root.warn("/api/slow увімкнено (ENABLE_SLOW=1)");
if (config.enableNetsim) {
	root.warn("штучна затримка/втрати увімкнено (ENABLE_NETSIM=1)");
}

// Graceful shutdown: /ready стає 503, нові з'єднання не приймаємо, клієнти отримують
// shutdown і закриття 1001, матчі й логи дописуються, код виходу 0.
let stopping = false;
async function shutdown(signal: string): Promise<void> {
	if (stopping) return;
	stopping = true;
	const started = Date.now();
	root.info({ signal }, "отримано сигнал, зупиняюсь");
	setTimeout(() => {
		root.fatal({ ms: SHUTDOWN_DEADLINE_MS }, "не встигли завершитись, вихід");
		process.exit(1);
	}, SHUTDOWN_DEADLINE_MS).unref();
	try {
		await app.close();
		root.info({ ms: Date.now() - started }, "зупинено");
		process.exit(0);
	} catch (error: unknown) {
		root.error({ err: error }, "помилка при завершенні");
		process.exit(1);
	}
}

// once: другий Ctrl+C під час зависання завершує процес примусово
for (const signal of ["SIGINT", "SIGTERM"]) {
	process.once(signal, async () => {
		await shutdown(signal);
	});
}
