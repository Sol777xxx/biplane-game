import type { IncomingMessage, ServerResponse } from "node:http";
import { setTimeout as sleep } from "node:timers/promises";
import type { ArenaConfig } from "biplane-shared/sim/game.ts";
import { z } from "zod";
import { readJsonBody } from "./body.ts";
import { listReplays, sendReplay } from "./replayRoutes.ts";
import { HttpError, sendJson } from "./respond.ts";
import {
	isPresetName,
	PRESETS,
	type PresetName,
	RoomError,
	type RoomManager,
} from "./rooms.ts";

const MAX_BODY = 1024;

// Форма тіла POST /api/rooms. strictObject: зайве поле це помилка, а не мовчазне ігнорування.
// z.custom<PresetName> з перевіркою isPresetName: на виході preset має тип PresetName,
// а не просто string, тож PRESETS[preset] нижче tsc приймає без жодного приведення типів.
const newRoomSchema = z.strictObject({
	name: z
		.string()
		.trim()
		.min(1)
		.max(24)
		.refine((s) => !/\p{Cc}/u.test(s)),
	max: z.number().int().min(1).max(8).default(4),
	preset: z
		.custom<PresetName>((v) => typeof v === "string" && isPresetName(v))
		.default("classic"),
});

// що не так з полем, людською мовою (схема каже лише «не пройшло»)
const HINT: Readonly<Record<string, string>> = {
	name: "рядок від 1 до 24 символів без керівних",
	max: "ціле від 1 до 8",
	preset: `один із ${Object.keys(PRESETS).join(", ")}`,
};

export interface NewRoomSpec {
	readonly name: string;
	readonly max: number;
	readonly arena: ArenaConfig;
}

// Ніколи не довіряємо формі вхідних даних: приймаємо unknown, віддаємо чистий об'єкт.
export function validateNewRoom(body: unknown): NewRoomSpec {
	const parsed = newRoomSchema.safeParse(body);
	if (!parsed.success) {
		const issue = parsed.error.issues[0];
		if (issue?.code === "unrecognized_keys") {
			throw new HttpError(400, `невідоме поле "${issue.keys[0]}"`);
		}
		const field = String(issue?.path[0] ?? "");
		throw new HttpError(
			400,
			field
				? `${field}: ${HINT[field] ?? "некоректне значення"}`
				: "очікується JSON-об'єкт",
		);
	}
	const { name, max, preset } = parsed.data;
	return { name, max, arena: PRESETS[preset] };
}

const MAX_SLOW_MS = 2000;

// Навмисне блокування: JS однопотоковий, поки цей цикл крутиться, цикл подій не
// обслуговує нікого (ні сокети, ні таймери, ні інші запити).
function blockFor(ms: number): void {
	const end = performance.now() + ms;
	while (performance.now() < end) {
		// порожньо: процесор зайнятий, цикл подій стоїть
	}
}

async function handleSlow(
	req: IncomingMessage,
	res: ServerResponse,
): Promise<void> {
	const params = new URL(req.url ?? "/", "http://x").searchParams;
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

// Звідки API бере статистику матчів (поки Match ще не типізований, лише цей контракт).
export interface MatchStatsSource {
	stats(): readonly unknown[];
}

export interface ApiOptions {
	readonly logDir: string;
	readonly enableSlow?: boolean;
	readonly matches?: MatchStatsSource | null;
}

export function createApi(
	rooms: RoomManager,
	{ logDir, enableSlow = false, matches = null }: ApiOptions,
): (
	req: IncomingMessage,
	res: ServerResponse,
	pathname: string,
) => Promise<void> {
	return async function handleApi(req, res, pathname) {
		if (pathname === "/api/rooms") {
			if (req.method === "GET") {
				sendJson(res, 200, { rooms: rooms.list() });
				return;
			}

			if (req.method === "POST") {
				const spec = validateNewRoom(await readJsonBody(req, MAX_BODY));
				let room: ReturnType<RoomManager["create"]>;
				try {
					room = rooms.create(spec);
				} catch (error: unknown) {
					if (error instanceof RoomError)
						throw new HttpError(503, error.message);
					throw error;
				}
				res.setHeader("Location", `/api/rooms/${room.id}`);
				sendJson(res, 201, { room: room.summary() });
				return;
			}

			res.setHeader("Allow", "GET, POST");
			throw new HttpError(405, "method not allowed");
		}
		if (pathname === "/api/stats") {
			if (req.method !== "GET") {
				res.setHeader("Allow", "GET");
				throw new HttpError(405, "method not allowed");
			}
			sendJson(res, 200, {
				uptime: Math.round(process.uptime()),
				rooms: matches?.stats() ?? [],
			});
			return;
		}
		if (pathname === "/api/replays" || pathname.startsWith("/api/replays/")) {
			if (req.method !== "GET") {
				res.setHeader("Allow", "GET");
				throw new HttpError(405, "method not allowed");
			}
			if (pathname === "/api/replays") {
				sendJson(res, 200, { replays: await listReplays(logDir) });
				return;
			}
			await sendReplay(res, logDir, pathname.slice("/api/replays/".length));
			return;
		}
		if (pathname === "/api/slow" && enableSlow) {
			if (req.method !== "GET") {
				res.setHeader("Allow", "GET");
				throw new HttpError(405, "method not allowed");
			}
			await handleSlow(req, res);
			return;
		}
		throw new HttpError(404, "not found");
	};
}
