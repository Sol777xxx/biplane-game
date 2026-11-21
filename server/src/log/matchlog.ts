import { on } from "node:events";
import { createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { Readable, Transform, type TransformCallback } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { Logger } from "../logger.ts";
import type { Room, RoomLogEvent } from "../rooms.ts";

// Об'єкти (події) на вході, рядки NDJSON на виході: по одному JSON на рядок.
export class NdjsonTransform extends Transform {
	count = 0;

	constructor() {
		super({ writableObjectMode: true });
	}

	override _transform(
		event: unknown,
		_encoding: BufferEncoding,
		callback: TransformCallback,
	): void {
		let line: string;
		try {
			line = JSON.stringify(event);
		} catch (error: unknown) {
			// подія, яку не можна серіалізувати (цикл), не повинна обривати весь лог
			line = JSON.stringify({
				t: Date.now(),
				type: "log_error",
				message: error instanceof Error ? error.message : String(error),
			});
		}
		this.count++;
		callback(null, `${line}\n`);
	}
}

// 2026-11-08T03-50-12-345Z: без двокрапок, щоб ім'я файлу було допустиме на Windows
export function logFileName(roomId: string, date: Date): string {
	const stamp = date.toISOString().replaceAll(":", "-").replace(".", "-");
	return `${roomId}-${stamp}.ndjson`;
}

const LOG_TYPES: ReadonlySet<unknown> = new Set([
	"match_start",
	"join",
	"leave",
	"chat",
	"match_end",
]);

// on() повертає події без типів (масив аргументів слухача), тому перед використанням
// перевіряємо, що це запис кімнати. Джерело наше, але межа між EventEmitter і типами одна.
function isRoomLogEvent(value: unknown): value is RoomLogEvent {
	return (
		typeof value === "object" &&
		value !== null &&
		"type" in value &&
		LOG_TYPES.has(value.type) &&
		"t" in value &&
		typeof value.t === "number"
	);
}

// Подія за подією з кімнати. on() підписується ОДРАЗУ при виклику (а не при першому
// next()), тож події між "matchstart" і стартом pipeline не губляться: вони чекають у черзі.
function roomEvents(
	room: Room,
	signal: AbortSignal,
): AsyncGenerator<RoomLogEvent> {
	const source: AsyncIterable<readonly unknown[]> = on(room, "event", {
		signal,
	});
	return (async function* () {
		try {
			for await (const [event] of source) {
				if (!isRoomLogEvent(event)) continue;
				yield event;
				if (event.type === "match_end") return; // return знімає слухача з кімнати
			}
		} catch (error: unknown) {
			// abort означає "завершуй": уже накопичені події віддані до помилки
			if (!(error instanceof Error && error.name === "AbortError")) throw error;
		}
	})();
}

export interface MatchLogsOptions {
	readonly dir: string;
	readonly log: Logger;
}

export interface MatchLogs {
	// Лог відкривається, коли в кімнату заходить перший гравець.
	attach(room: Room): void;
	readonly active: number;
	// Graceful shutdown: дописати те, що вже в черзі, і дочекатись закриття файлів.
	close(): Promise<void>;
}

interface ActiveLog {
	readonly file: string;
	readonly stop: () => void;
}

export function createMatchLogs({ dir, log }: MatchLogsOptions): MatchLogs {
	const active = new Map<string, ActiveLog>(); // roomId -> поточний лог
	const pending = new Set<Promise<void>>(); // усі логи, що ще дописуються

	function start(room: Room): void {
		const ac = new AbortController();
		const events = roomEvents(room, ac.signal);
		const file = path.join(dir, logFileName(room.id, new Date()));
		const transform = new NdjsonTransform();
		const entry: ActiveLog = { file, stop: () => ac.abort() };

		const done = (async () => {
			try {
				await mkdir(dir, { recursive: true });
				// pipeline: помилка будь-якого ланцюга руйнує всі решту й закриває файл;
				// write() що повернув false призупиняє читання (backpressure)
				await pipeline(
					Readable.from(events),
					transform,
					createWriteStream(file, { flags: "a" }),
				);
				log.info(`лог матчу: ${file} (${transform.count} подій)`);
			} catch (error: unknown) {
				// збій диска не має ламати гру
				log.error(`лог матчу ${file}:`, error);
			} finally {
				ac.abort(); // знімає слухача "event": інакше після збою черга росла б безкінечно
				if (active.get(room.id) === entry) active.delete(room.id);
			}
		})();

		active.set(room.id, entry);
		pending.add(done);
		void done.finally(() => pending.delete(done));
	}

	return {
		attach(room) {
			room.on("matchstart", () => start(room));
		},

		get active() {
			return active.size;
		},

		async close() {
			for (const entry of active.values()) entry.stop();
			await Promise.all(pending);
		},
	};
}
