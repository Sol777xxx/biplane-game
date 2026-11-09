import { existsSync } from "node:fs";
import { join } from "node:path";
import { defineConfig } from "vite";

const SERVER = `127.0.0.1:${process.env.SERVER_PORT ?? 3000}`;

// Лише для dev-сервера:
//  - /api і /ws проксуються на server/ (запустіть npm run dev:server);
//  - ?delay=мс затримує відповідь на будь-який запит: так перевіряємо прогрес-бар,
//    таймаути й різницю sequential/concurrent;
//  - неіснуючий /assets/* дає справжній 404 (за замовчуванням Vite віддав би index.html зі статусом 200).
export default defineConfig({
	server: {
		proxy: {
			"/api": `http://${SERVER}`,
			"/ws": { target: `ws://${SERVER}`, ws: true },
		},
	},
	plugins: [
		{
			name: "lab03-dev-api",
			configureServer(server) {
				const publicDir = server.config.publicDir;
				server.middlewares.use((req, res, next) => {
					const url = new URL(req.url, "http://x");
					const missing =
						url.pathname.startsWith("/assets/") &&
						!existsSync(join(publicDir, url.pathname));
					const go = () => {
						if (missing) {
							res.statusCode = 404;
							res.end("not found");
						} else {
							next();
						}
					};
					const ms = Number(url.searchParams.get("delay"));
					if (ms > 0) setTimeout(go, ms);
					else go();
				});
			},
		},
	],
});
