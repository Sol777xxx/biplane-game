import http from "node:http";
import type { AddressInfo } from "node:net";
import { createApi } from "./api.ts";
import { createBots } from "./bots.ts";
import type { Config } from "./config.ts";
import { createMatchLogs, type MatchLogs } from "./log/matchlog.ts";
import { consoleLogger, type Logger } from "./logger.ts";
import { createMatches, type Matches, type MatchesOptions } from "./matches.ts";
import { Metrics } from "./metrics.ts";
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
	// true з першої миті завершення: за цим /ready віддає 503
	readonly closing: boolean;
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
	const bots = createBots();
	const handleApi = createApi(rooms, {
		logDir: config.logDir,
		enableSlow: config.enableSlow,
		matches,
		bots,
	});
	const startedAt = Date.now();
	const metrics = new Metrics();
	metrics.start();
	let shuttingDown = false;
	const maxPlayers = config.maxPlayers ?? Number.POSITIVE_INFINITY;
	const totalPlayers = (): number =>
		rooms.all().reduce((sum, room) => sum + room.players.size, 0);
	const closers: (() => void | Promise<void>)[] = [
		() => bots.dispose(),
		() => rooms.dispose(),
		() => metrics.stop(),
	];

	async function route(
		req: http.IncomingMessage,
		res: http.ServerResponse,
	): Promise<void> {
		const pathname = (req.url ?? "/").split("?")[0] ?? "/";

		if (pathname === "/health") {
			const { rss, heapUsed } = process.memoryUsage();
			return sendJson(res, 200, {
				status: "ok",
				sha: config.gitSha ?? "dev",
				uptime: Math.round((Date.now() - startedAt) / 1000),
				rss,
				heapUsed,
			});
		}
		// /health: процес живий. /ready: процес може пускати гравців (не завершується
		// і не досяг MAX_PLAYERS). Хостинг за першим перезапускає, за другим знімає з балансування.
		if (pathname === "/ready") {
			const reason = shuttingDown
				? "shutting_down"
				: totalPlayers() >= maxPlayers
					? "full"
					: null;
			return sendJson(
				res,
				reason ? 503 : 200,
				reason ? { status: "unavailable", reason } : { status: "ready" },
			);
		}
		if (pathname === "/metrics") {
			const body = Buffer.from(
				metrics.render({
					players: totalPlayers,
					rooms: () => rooms.size,
					connections: () => sockets.wss.clients.size,
					matches: () => matches?.stats() ?? [],
					gitSha: config.gitSha ?? "dev",
				}),
			);
			res.writeHead(200, {
				"Content-Type": "text/plain; version=0.0.4; charset=utf-8",
				"Content-Length": body.length,
				"Cache-Control": "no-store",
			});
			res.end(body);
			return;
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
			log.error({ method: req.method, url: req.url }, "помилка запиту", error);
			if (res.headersSent) res.destroy();
			else sendJson(res, 500, { error: "internal error" });
		}
	});
	const sockets = attachWebSocket({
		server,
		rooms,
		log,
		metrics,
		netsim: config.enableNetsim === true,
		allowedOrigins: config.allowedOrigins,
		maxConnPerIp: config.maxConnPerIp,
		maxPlayers: config.maxPlayers,
		trustProxy: config.trustProxy,
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

		get closing() {
			return shuttingDown;
		},

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
			shuttingDown = true; // /ready віддає 503 одразу, ще до закриття сокетів
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
