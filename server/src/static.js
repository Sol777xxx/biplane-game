import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { sendText } from "./respond.js";

const MIME = {
	".html": "text/html; charset=utf-8",
	".js": "text/javascript; charset=utf-8",
	".mjs": "text/javascript; charset=utf-8",
	".css": "text/css; charset=utf-8",
	".json": "application/json; charset=utf-8",
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
export function resolveSafe(root, rawUrl) {
	const raw = rawUrl.split("?")[0].split("#")[0];
	let decoded;
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

async function statOrNull(file) {
	try {
		return await stat(file);
	} catch {
		return null;
	}
}

export function createStaticHandler(root) {
	return async function serveStatic(req, res) {
		if (req.method !== "GET" && req.method !== "HEAD") {
			res.setHeader("Allow", "GET, HEAD");
			return sendText(res, 405, "Method Not Allowed");
		}

		const resolved = resolveSafe(root, req.url);
		if (resolved.status) {
			return sendText(
				res,
				resolved.status,
				resolved.status === 403 ? "Forbidden" : "Bad Request",
			);
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
			return sendText(res, 404, `Not Found${hint}`);
		}

		const ext = path.extname(file).toLowerCase();
		res.writeHead(200, {
			"Content-Type": MIME[ext] ?? "application/octet-stream",
			"Content-Length": info.size,
			"Cache-Control": ext === ".html" ? "no-cache" : "public, max-age=300",
		});
		if (req.method === "HEAD") return res.end();

		// файл летить потоком, у пам'ять не читається; обрив клієнта не помилка сервера
		await pipeline(createReadStream(file), res).catch((error) => {
			if (error.code !== "ERR_STREAM_PREMATURE_CLOSE") throw error;
		});
	};
}
