import http from "node:http";
import { createApi } from "./api.js";
import { createMatchLogs } from "./log/matchlog.js";
import { consoleLogger } from "./logger.js";
import { HttpError, sendError, sendJson } from "./respond.js";
import { RoomManager } from "./rooms.js";
import { createStaticHandler } from "./static.js";
import { attachWebSocket } from "./ws.js";

const FORCE_CLOSE_MS = 3000;

export function createApp(
	config,
	{
		rooms = new RoomManager(),
		log = consoleLogger,
		ws: wsOptions = {},
		matchLog = true,
	} = {},
) {
	const serveStatic = createStaticHandler(config.clientDir);
	const handleApi = createApi(rooms, { logDir: config.logDir });
	const startedAt = Date.now();
	const closers = [() => rooms.dispose()];

	async function route(req, res) {
		const pathname = req.url.split("?")[0];

		if (pathname === "/health") {
			const { rss, heapUsed } = process.memoryUsage();
			return sendJson(res, 200, {
				status: "ok",
				uptime: Math.round((Date.now() - startedAt) / 1000),
				rss,
				heapUsed,
			});
		}
		if (pathname.startsWith("/api/")) return handleApi(req, res, pathname);
		if (pathname === "/ws") return sendJson(res, 404, { error: "not found" }); // upgrade: коміт 4
		return serveStatic(req, res);
	}

	// Обробник async: без try/catch відхилений проміс став би unhandled rejection
	// і завалив би весь процес.
	const server = http.createServer(async (req, res) => {
		try {
			await route(req, res);
		} catch (error) {
			if (error instanceof HttpError && !res.headersSent)
				return sendError(req, res, error);
			console.error(`${req.method} ${req.url}:`, error);
			if (res.headersSent) res.destroy();
			else sendJson(res, 500, { error: "internal error" });
		}
	});
	const sockets = attachWebSocket({ server, rooms, log, ...wsOptions });
	closers.push(() => sockets.shutdown());

	// Лог матчу закривається ПІСЛЯ сокетів: спершу всі вийдуть із кімнат (match_end),
	const matchLogs = matchLog
		? createMatchLogs({ dir: config.logDir, log })
		: null;
	if (matchLogs) {
		for (const room of rooms.all()) matchLogs.attach(room);
		rooms.on("created", (room) => matchLogs.attach(room));
		closers.push(() => matchLogs.close());
	}

	let closing = null;

	return {
		server,
		rooms,
		sockets,
		matchLogs,

		listen() {
			return new Promise((resolve, reject) => {
				server.once("error", reject); // помилка listen (наприклад, порт зайнятий)
				server.listen(config.port, config.host, () => {
					server.off("error", reject);
					resolve(server.address());
				});
			});
		},

		// Завдання завершення: закрити сокети, скинути логи. Виконуються по черзі.
		onClose(fn) {
			closers.push(fn);
		},

		// Graceful shutdown: нові з'єднання не приймаємо, поточним даємо завершитись.
		close() {
			closing ??= (async () => {
				const closed = new Promise((resolve) => server.close(() => resolve()));
				server.closeIdleConnections();
				const force = setTimeout(
					() => server.closeAllConnections(),
					FORCE_CLOSE_MS,
				);
				force.unref();
				for (const fn of closers) await fn();
				await closed;
				clearTimeout(force);
			})();
			return closing;
		},
	};
}
