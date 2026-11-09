import { on } from "node:events";
import { createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

// Об'єкти (події) на вході, рядки NDJSON на виході: по одному JSON на рядок.
export class NdjsonTransform extends Transform {
	count = 0;

	constructor() {
		super({ writableObjectMode: true });
	}

	_transform(event, _encoding, callback) {
		let line;
		try {
			line = JSON.stringify(event);
		} catch (error) {
			// подія, яку не можна серіалізувати (цикл), не повинна обривати весь лог
			line = JSON.stringify({
				t: Date.now(),
				type: "log_error",
				message: error.message,
			});
		}
		this.count++;
		callback(null, `${line}\n`);
	}
}

// 2026-11-08T03-50-12-345Z: без двокрапок, щоб ім'я файлу було допустиме на Windows
export function logFileName(roomId, date) {
	const stamp = date.toISOString().replaceAll(":", "-").replace(".", "-");
	return `${roomId}-${stamp}.ndjson`;
}

// Подія за подією з кімнати. on() підписується ОДРАЗУ при виклику (а не при першому
// next()), тож події між "matchstart" і стартом pipeline не губляться: вони чекають у черзі.
function roomEvents(room, signal) {
	const source = on(room, "event", { signal });
	return (async function* () {
		try {
			for await (const [event] of source) {
				yield event;
				if (event.type === "match_end") return; // return знімає слухача з кімнати
			}
		} catch (error) {
			// abort означає "завершуй": уже накопичені події віддані до помилки
			if (error.name !== "AbortError") throw error;
		}
	})();
}

export function createMatchLogs({ dir, log }) {
	const active = new Map(); // roomId -> поточний лог
	const pending = new Set(); // усі логи, що ще дописуються

	function start(room) {
		const ac = new AbortController();
		const events = roomEvents(room, ac.signal);
		const file = path.join(dir, logFileName(room.id, new Date()));
		const transform = new NdjsonTransform();
		const entry = { file, stop: () => ac.abort(), done: null };

		entry.done = (async () => {
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
			} catch (error) {
				// збій диска не має ламати гру
				log.error(`лог матчу ${file}:`, error);
			} finally {
				ac.abort(); // знімає слухача "event": інакше після збою черга росла б безкінечно
				if (active.get(room.id) === entry) active.delete(room.id);
			}
		})();

		active.set(room.id, entry);
		pending.add(entry.done);
		entry.done.finally(() => pending.delete(entry.done));
	}

	return {
		// Лог відкривається, коли в кімнату заходить перший гравець.
		attach(room) {
			room.on("matchstart", () => start(room));
		},

		get active() {
			return active.size;
		},

		// Graceful shutdown: дописати те, що вже в черзі, і дочекатись закриття файлів.
		async close() {
			for (const entry of active.values()) entry.stop();
			await Promise.all(pending);
		},
	};
}
