import http from "node:http";
import { sendJson } from "./respond.js";
import { createStaticHandler } from "./static.js";

const FORCE_CLOSE_MS = 3000;

export function createApp(config) {
	const serveStatic = createStaticHandler(config.clientDir);
	const startedAt = Date.now();
	const closers = [];

	async function route(req, res) {
		const pathname = req.url.split("?")[0];

		if (pathname === "/health") {
			return sendJson(res, 200, {
				status: "ok",
				uptime: Math.round((Date.now() - startedAt) / 1000),
			});
		}
		// /api тут з'явиться в коміті 3, /ws це upgrade (коміт 4)
		if (pathname.startsWith("/api/") || pathname === "/ws") {
			return sendJson(res, 404, { error: "not found" });
		}
		return serveStatic(req, res);
	}

	// Обробник async: без try/catch відхилений проміс став би unhandled rejection
	// і завалив би весь процес.
	const server = http.createServer(async (req, res) => {
		try {
			await route(req, res);
		} catch (error) {
			console.error(`${req.method} ${req.url}:`, error);
			if (res.headersSent) res.destroy();
			else sendJson(res, 500, { error: "internal error" });
		}
	});

	let closing = null;

	return {
		server,

		listen() {
			return new Promise((resolve, reject) => {
				server.once("error", reject); // помилка listen (наприклад, порт зайнятий)
				server.listen(config.port, config.host, () => {
					server.off("error", reject);
					resolve(server.address());
				});
			});
		},

		// Реєструє завдання завершення: закрити сокети, скинути логи. Виконуються по черзі.
		onClose(fn) {
			closers.push(fn);
		},

		// Graceful shutdown: нові з'єднання не приймаємо, поточним даємо завершитись.
		close() {
			closing ??= (async () => {
				const closed = new Promise((resolve) => server.close(() => resolve()));
				server.closeIdleConnections();
				// те, що не завершилось за 3 с, рубаємо
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
