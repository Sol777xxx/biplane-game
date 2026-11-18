import http from "node:http";
import type { AddressInfo } from "node:net";
import { createApi } from "./api.ts";
import type { Config } from "./config.ts";
import { createMatchLogs, type MatchLogs } from "./log/matchlog.ts";
import { consoleLogger, type Logger } from "./logger.ts";
import { createMatches, type Matches, type MatchesOptions } from "./matches.ts";
import { HttpError, sendError, sendJson } from "./respond.ts";
import { RoomManager } from "./rooms.ts";
import { createStaticHandler } from "./static.ts";
import { attachWebSocket, type WebSocketHub, type WsOptions } from "./ws.ts";

const FORCE_CLOSE_MS = 3000;

export interface AppOptions {
	readonly rooms?: RoomManager;
	readonly log?: Logger;
	readonly ws?: Partial<WsOptions>;
	readonly matchLog?: boolean;
	// чи рахує сервер гру (Match на кожну кімнату)
	readonly game?: boolean;
	readonly match?: Omit<MatchesOptions, "rooms" | "log">;
}

export interface App {
	readonly server: http.Server;
	readonly rooms: RoomManager;
	readonly sockets: WebSocketHub;
	readonly matches: Matches | null;
	readonly matchLogs: MatchLogs | null;
	listen(): Promise<AddressInfo>;
	onClose(fn: () => void | Promise<void>): void;
	close(): Promise<void>;
}

// game: чи рахує сервер гру (Match на кожну кімнату). За замовчуванням вимкнено, щоб тести
// кімнат і чату не отримували знімків; index.ts вмикає.
export function createApp(
	config: Config,
	{
		rooms = new RoomManager({ maxRooms: config.maxRooms }),
		log = consoleLogger,
		ws: wsOptions = {},
		matchLog = true,
		game = false,
		match: matchOptions = {},
	}: AppOptions = {},
): App {
	const serveStatic = createStaticHandler(config.clientDir);
	const matches = game ? createMatches({ rooms, log, ...matchOptions }) : null;
	const handleApi = createApi(rooms, {
		logDir: config.logDir,
		enableSlow: config.enableSlow,
		matches,
	});
	const startedAt = Date.now();
	const closers: (() => void | Promise<void>)[] = [() => rooms.dispose()];

	async function route(
		req: http.IncomingMessage,
		res: http.ServerResponse,
	): Promise<void> {
		const pathname = (req.url ?? "/").split("?")[0] ?? "/";

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
		if (pathname === "/ws") return sendJson(res, 404, { error: "not found" }); // upgrade: у ws.ts
		return serveStatic(req, res);
	}

	// Обробник async: без try/catch відхилений проміс став би unhandled rejection
	// і завалив би весь процес.
	const server = http.createServer(async (req, res) => {
		try {
			await route(req, res);
		} catch (error: unknown) {
			if (error instanceof HttpError && !res.headersSent)
				return sendError(req, res, error);
			console.error(`${req.method} ${req.url}:`, error);
			if (res.headersSent) res.destroy();
			else sendJson(res, 500, { error: "internal error" });
		}
	});
	const sockets = attachWebSocket({
		server,
		rooms,
		log,
		netsim: config.enableNetsim === true,
		...wsOptions,
	});
	closers.push(() => sockets.shutdown());

	// Match зупиняється після сокетів: спершу всі виходять із кімнат
	if (matches) {
		for (const room of rooms.all()) matches.attach(room);
		rooms.on("created", (room) => matches.attach(room));
		closers.push(() => matches.close());
	}

	// Лог матчу закривається ПІСЛЯ сокетів: спершу всі вийдуть із кімнат (match_end),
	const matchLogs = matchLog
		? createMatchLogs({ dir: config.logDir, log })
		: null;
	if (matchLogs) {
		for (const room of rooms.all()) matchLogs.attach(room);
		rooms.on("created", (room) => matchLogs.attach(room));
		closers.push(() => matchLogs.close());
	}

	let closing: Promise<void> | null = null;

	return {
		server,
		rooms,
		sockets,
		matches,
		matchLogs,

		listen() {
			return new Promise<AddressInfo>((resolve, reject) => {
				server.once("error", reject); // помилка listen (наприклад, порт зайнятий)
				server.listen(config.port, config.host, () => {
					server.off("error", reject);
					const address = server.address();
					// рядок це шлях unix-сокета: ми слухаємо host і port, тож сюди не потрапимо
					if (address === null || typeof address === "string") {
						reject(new Error("сервер не повернув адресу host:port"));
						return;
					}
					resolve(address);
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
				const closed = new Promise<void>((resolve) =>
					server.close(() => resolve()),
				);
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
