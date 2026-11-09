// Запуск: node tools/naive-replay-server.mjs [ім'я=big-200mb] [порт=3001]
// ТАК РОБИТИ НЕ МОЖНА: усе тримається в пам'яті, поки клієнт не забере останній байт.
import { readFile } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { loadConfig } from "../src/config.js";

const [name = "big-200mb", port = "3001"] = process.argv.slice(2);
const { logDir } = loadConfig();

http
	.createServer(async (req, res) => {
		if (req.url === "/health") {
			res.setHeader("Content-Type", "application/json");
			return res.end(JSON.stringify({ rss: process.memoryUsage().rss }));
		}
		const data = await readFile(path.join(logDir, `${name}.ndjson`));
		res.writeHead(200, { "Content-Length": data.length });
		res.end(data);
	})
	.listen(Number(port), "127.0.0.1", () =>
		console.log(`наївний сервер: :${port}`),
	);
