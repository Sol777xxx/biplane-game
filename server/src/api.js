import { setTimeout as sleep } from "node:timers/promises";
import { readJsonBody } from "./body.js";
import { listReplays, sendReplay } from "./replayRoutes.js";
import { HttpError, sendJson } from "./respond.js";
import { PRESETS, RoomError } from "./rooms.js";

const MAX_BODY = 1024;
const ALLOWED = new Set(["name", "max", "preset"]);

// Ніколи не довіряємо формі вхідних даних: перевіряємо все, повертаємо чистий об'єкт.
export function validateNewRoom(body) {
	if (typeof body !== "object" || body === null || Array.isArray(body)) {
		throw new HttpError(400, "очікується JSON-об'єкт");
	}
	for (const key of Object.keys(body)) {
		if (!ALLOWED.has(key)) throw new HttpError(400, `невідоме поле "${key}"`);
	}

	if (typeof body.name !== "string")
		throw new HttpError(400, "name має бути рядком");
	const name = body.name.trim();
	if (name.length < 1 || name.length > 24)
		throw new HttpError(400, "name: від 1 до 24 символів");
	if (/\p{Cc}/u.test(name))
		throw new HttpError(400, "name містить керівні символи");
	const max = body.max ?? 4;
	if (!Number.isInteger(max) || max < 1 || max > 8)
		throw new HttpError(400, "max: ціле від 1 до 8");

	const preset = body.preset ?? "classic";
	if (typeof preset !== "string" || !Object.hasOwn(PRESETS, preset)) {
		throw new HttpError(
			400,
			`preset: один із ${Object.keys(PRESETS).join(", ")}`,
		);
	}
	return { name, max, arena: PRESETS[preset] };
}

const MAX_SLOW_MS = 2000;

// Навмисне блокування: JS однопотоковий, поки цей цикл крутиться, цикл подій не
// обслуговує нікого (ні сокети, ні таймери, ні інші запити).
function blockFor(ms) {
	const end = performance.now() + ms;
	while (performance.now() < end) {
		// порожньо: процесор зайнятий, цикл подій стоїть
	}
}

async function handleSlow(req, res) {
	const params = new URL(req.url, "http://x").searchParams;
	const rawMs = params.get("ms") ?? "300";
	const ms = Number(rawMs);
	if (!/^\d{1,4}$/.test(rawMs) || ms > MAX_SLOW_MS) {
		throw new HttpError(400, `ms: ціле число 0–${MAX_SLOW_MS}`);
	}
	const mode = params.get("mode") ?? "block";
	if (mode !== "block" && mode !== "sleep")
		throw new HttpError(400, "mode: block або sleep");

	const started = performance.now();
	if (mode === "block") blockFor(ms);
	else await sleep(ms); // таймер: цикл подій вільний, інші клієнти не відчувають
	sendJson(res, 200, {
		mode,
		ms,
		tookMs: Math.round(performance.now() - started),
	});
}

export function createApi(
	rooms,
	{ logDir, enableSlow = false, matches = null },
) {
	return async function handleApi(req, res, pathname) {
		if (pathname === "/api/rooms") {
			if (req.method === "GET")
				return sendJson(res, 200, { rooms: rooms.list() });

			if (req.method === "POST") {
				const spec = validateNewRoom(await readJsonBody(req, MAX_BODY));
				let room;
				try {
					room = rooms.create(spec);
				} catch (error) {
					if (error instanceof RoomError)
						throw new HttpError(503, error.message);
					throw error;
				}
				res.setHeader("Location", `/api/rooms/${room.id}`);
				return sendJson(res, 201, { room: room.summary() });
			}

			res.setHeader("Allow", "GET, POST");
			throw new HttpError(405, "method not allowed");
		}
		if (pathname === "/api/stats") {
			if (req.method !== "GET") {
				res.setHeader("Allow", "GET");
				throw new HttpError(405, "method not allowed");
			}
			return sendJson(res, 200, {
				uptime: Math.round(process.uptime()),
				rooms: matches?.stats() ?? [],
			});
		}
		if (pathname === "/api/replays" || pathname.startsWith("/api/replays/")) {
			if (req.method !== "GET") {
				res.setHeader("Allow", "GET");
				throw new HttpError(405, "method not allowed");
			}
			if (pathname === "/api/replays") {
				return sendJson(res, 200, { replays: await listReplays(logDir) });
			}
			return sendReplay(res, logDir, pathname.slice("/api/replays/".length));
		}
		if (pathname === "/api/slow" && enableSlow) {
			if (req.method !== "GET") {
				res.setHeader("Allow", "GET");
				throw new HttpError(405, "method not allowed");
			}
			return handleSlow(req, res);
		}
		throw new HttpError(404, "not found");
	};
}
