import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { after, describe, it } from "node:test";
import { setTimeout as sleep } from "node:timers/promises";
import { createApp } from "../src/app.js";
import { silentLogger } from "../src/logger.js";

const apps = [];
async function start(extra = {}) {
	const config = {
		port: 0,
		host: "127.0.0.1",
		clientDir: tmpdir(),
		logDir: tmpdir(),
		...extra,
	};
	const app = createApp(config, { log: silentLogger, matchLog: false });
	const { port } = await app.listen();
	apps.push(app);
	return `http://127.0.0.1:${port}`;
}
after(() => Promise.all(apps.map((a) => a.close())));

const createRoom = (base, name) =>
	fetch(`${base}/api/rooms`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ name }),
	});

describe("ліміт кімнат", () => {
	it("за MAX_ROOMS наступний POST отримує 503", async () => {
		const base = await start({ maxRooms: 2 });
		assert.equal((await createRoom(base, "A")).status, 201);
		assert.equal((await createRoom(base, "B")).status, 201);
		assert.equal((await createRoom(base, "C")).status, 503);
	});
});

describe("/api/slow", () => {
	it("за замовчуванням його не існує", async () => {
		const base = await start();
		assert.equal((await fetch(`${base}/api/slow`)).status, 404);
	});

	it("block: тримає процес не менше за ms", async () => {
		const base = await start({ enableSlow: true });
		const r = await fetch(`${base}/api/slow?ms=300`);
		assert.equal(r.status, 200);
		const body = await r.json();
		assert.equal(body.mode, "block");
		assert.ok(body.tookMs >= 295, `tookMs=${body.tookMs}`);
	});

	it("sleep: чекає, але інші запити обслуговуються", async () => {
		const base = await start({ enableSlow: true });
		const slow = fetch(`${base}/api/slow?mode=sleep&ms=400`).then((r) =>
			r.json(),
		);
		await sleep(50);
		const t0 = performance.now();
		assert.equal((await fetch(`${base}/health`)).status, 200);
		assert.ok(
			performance.now() - t0 < 200,
			"health мав відповісти, поки slow спить",
		);
		assert.ok((await slow).tookMs >= 395);
		// режим block у цьому процесі не перевірити: тест і сервер ділять один цикл подій.
		// Блокування показує tools/lag-demo.mjs, де клієнт це окремий процес.
	});

	it("некоректні параметри це 400", async () => {
		const base = await start({ enableSlow: true });
		for (const q of ["ms=abc", "ms=5000", "ms=-1", "mode=nope"]) {
			assert.equal((await fetch(`${base}/api/slow?${q}`)).status, 400, q);
		}
	});
});
