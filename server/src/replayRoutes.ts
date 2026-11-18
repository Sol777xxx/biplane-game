import { createReadStream, type Stats } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import type { ServerResponse } from "node:http";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { hasCode } from "./errors.ts";
import { HttpError } from "./respond.ts";

const EXT = ".ndjson";

// Лише літери, цифри, _ і -: ні крапок, ні слешів, тож вийти за межі logDir неможливо.
// id береться із сирого шляху (без decodeURIComponent), тому %2e%2e теж не проходить.
export const REPLAY_ID = /^[\w-]{1,128}$/;

export interface ReplayInfo {
	readonly id: string;
	readonly size: number;
	readonly modified: string;
}

export async function listReplays(
	dir: string,
	limit = 100,
): Promise<ReplayInfo[]> {
	let names: string[];
	try {
		names = await readdir(dir);
	} catch (error: unknown) {
		if (hasCode(error, "ENOENT")) return []; // матчів ще не було
		throw error;
	}
	const rows = await Promise.all(
		names
			.filter((name) => name.endsWith(EXT))
			.map(async (name): Promise<ReplayInfo | null> => {
				const id = name.slice(0, -EXT.length);
				if (!REPLAY_ID.test(id)) return null;
				try {
					const info = await stat(path.join(dir, name));
					return { id, size: info.size, modified: info.mtime.toISOString() };
				} catch {
					return null; // файл зник між readdir і stat
				}
			}),
	);
	return rows
		.filter((row): row is ReplayInfo => row !== null)
		.sort((a, b) => b.modified.localeCompare(a.modified))
		.slice(0, limit);
}

// Віддає файл потоком. Файл не читається в пам'ять: pipeline бере шматок (64 КБ),
// пише його у відповідь і, якщо res.write() повернув false (клієнт не встигає),
// призупиняє читання, доки не буде події drain. Пам'ять не залежить від розміру файлу.
export async function sendReplay(
	res: ServerResponse,
	dir: string,
	id: string,
): Promise<void> {
	if (!REPLAY_ID.test(id)) throw new HttpError(400, "bad replay id");

	const file = path.join(dir, `${id}${EXT}`);
	let info: Stats;
	try {
		info = await stat(file);
	} catch (error: unknown) {
		if (hasCode(error, "ENOENT")) throw new HttpError(404, "replay not found");
		throw error;
	}
	if (!info.isFile()) throw new HttpError(404, "replay not found");

	res.writeHead(200, {
		"Content-Type": "application/x-ndjson; charset=utf-8",
		"Content-Length": info.size,
		"Content-Disposition": `attachment; filename="${id}.ndjson"`,
		"Cache-Control": "no-store",
	});
	if (info.size === 0) {
		res.end();
		return;
	}

	// end зафіксований за розміром зі stat: якщо лог ще дописується, Content-Length
	// збігається з тим, що справді відправлено
	const source = createReadStream(file, { start: 0, end: info.size - 1 });
	await pipeline(source, res).catch((error: unknown) => {
		// клієнт обірвав завантаження: pipeline сам закрив файл, це не помилка сервера
		if (!hasCode(error, "ERR_STREAM_PREMATURE_CLOSE")) throw error;
	});
}
