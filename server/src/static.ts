import { createReadStream, type Stats } from "node:fs";
import { stat } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { hasCode } from "./errors.ts";
import { sendText } from "./respond.ts";

const MIME: Readonly<Record<string, string>> = {
	".html": "text/html; charset=utf-8",
	".js": "text/javascript; charset=utf-8",
	".mjs": "text/javascript; charset=utf-8",
	".css": "text/css; charset=utf-8",
	".json": "application/json; charset=utf-8",
	".webmanifest": "application/manifest+json; charset=utf-8",
	".png": "image/png",
	".jpg": "image/jpeg",
	".svg": "image/svg+xml",
	".wav": "audio/wav",
	".ico": "image/x-icon",
	".woff2": "font/woff2",
	".txt": "text/plain; charset=utf-8",
};

// Перетворює шлях із запиту на файл усередині root. Працює із СИРИМ url:
// WHATWG URL сам прибирає "/../", тож перевіряти треба до нього.
// Результат: або { status } (відмова), або { file }; відрізняємо їх за наявністю status.
export type Resolved =
	| { readonly status: 400 | 403 }
	| { readonly file: string };

export function resolveSafe(root: string, rawUrl: string): Resolved {
	const raw = rawUrl.split("?")[0]?.split("#")[0] ?? "";
	let decoded: string;
	try {
		decoded = decodeURIComponent(raw);
	} catch {
		return { status: 400 }; // зламане %-кодування
	}
	if (decoded.includes("\0")) return { status: 400 };

	// і "/", і "\" вважаємо роздільниками (на Windows обидва працюють)
	const parts = decoded.split(/[\\/]+/).filter(Boolean);
	if (parts.includes("..")) return { status: 403 };

	// друга лінія оборони: результат мусить лежати всередині root
	const file = path.join(root, ...parts);
	const rel = path.relative(root, file);
	if (rel.startsWith("..") || path.isAbsolute(rel)) return { status: 403 };
	return { file };
}

async function statOrNull(file: string): Promise<Stats | null> {
	try {
		return await stat(file);
	} catch {
		return null;
	}
}

export function createStaticHandler(
	root: string,
): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
	return async function serveStatic(req, res) {
		if (req.method !== "GET" && req.method !== "HEAD") {
			res.setHeader("Allow", "GET, HEAD");
			sendText(res, 405, "Method Not Allowed");
			return;
		}

		const resolved = resolveSafe(root, req.url ?? "/");
		if ("status" in resolved) {
			sendText(
				res,
				resolved.status,
				resolved.status === 403 ? "Forbidden" : "Bad Request",
			);
			return;
		}

		let file = resolved.file;
		let info = await statOrNull(file);
		if (info?.isDirectory()) {
			file = path.join(file, "index.html");
			info = await statOrNull(file);
		}
		if (!info?.isFile()) {
			const hint = (await statOrNull(root))
				? ""
				: " (client/dist немає: виконайте npm run build)";
			sendText(res, 404, `Not Found${hint}`);
			return;
		}

		const ext = path.extname(file).toLowerCase();
		res.writeHead(200, {
			"Content-Type": MIME[ext] ?? "application/octet-stream",
			"Content-Length": info.size,
			// HTML і service worker перевіряємо щоразу: від них залежить, яку версію побачить гравець
			"Cache-Control":
				ext === ".html" || path.basename(file) === "sw.js"
					? "no-cache"
					: "public, max-age=300",
		});
		if (req.method === "HEAD") {
			res.end();
			return;
		}

		// файл летить потоком, у пам'ять не читається; обрив клієнта не помилка сервера
		await pipeline(createReadStream(file), res).catch((error: unknown) => {
			if (!hasCode(error, "ERR_STREAM_PREMATURE_CLOSE")) throw error;
		});
	};
}
