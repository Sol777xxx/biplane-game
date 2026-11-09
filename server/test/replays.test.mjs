import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import http from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { setTimeout as sleep } from "node:timers/promises";
import { createApp } from "../src/app.js";
import { silentLogger } from "../src/logger.js";

let base;
let logDir;
let main;
const apps = [];

async function startApp(dir) {
	const config = {
		port: 0,
		host: "127.0.0.1",
		clientDir: tmpdir(),
		logDir: dir,
	};
	const app = createApp(config, { log: silentLogger, matchLog: false });
	const { port } = await app.listen();
	apps.push(app);
	return { app, port };
}

before(async () => {
	base = await mkdtemp(path.join(tmpdir(), "biplane-replays-"));
	logDir = path.join(base, "logs");
	await mkdir(logDir);
	const write = async (name, data, year) => {
		const f = path.join(logDir, name);
		await writeFile(f, data);
		await utimes(f, new Date(`${year}-01-01`), new Date(`${year}-01-01`));
	};
	await write("calm-1.ndjson", '{"t":1,"type":"match_start"}\n', 2020);
	await write(
		"calm-2.ndjson",
		'{"t":2,"type":"match_start"}\n{"t":3,"type":"match_end"}\n',
		2021,
	);
	await write("empty.ndjson", "", 2019);
	await write("big.ndjson", Buffer.alloc(20 * 1024 * 1024, "a"), 2019);
	await write("notes.txt", "не лог", 2022);
	await write("bad.name.ndjson", "x", 2022); // id із крапкою не показуємо
	main = await startApp(logDir);
});

after(async () => {
	await Promise.all(apps.map((app) => app.close()));
	await rm(base, { recursive: true, force: true });
});

// сирий запит: fetch сам нормалізує "/../"
function raw(port, urlPath, method = "GET") {
	return new Promise((resolve, reject) => {
		const req = http.request(
			{ host: "127.0.0.1", port, path: urlPath, method, agent: false },
			(res) => {
				const chunks = [];
				res.on("data", (c) => chunks.push(c));
				res.on("end", () =>
					resolve({
						status: res.statusCode,
						body: Buffer.concat(chunks).toString(),
					}),
				);
			},
		);
		req.on("error", reject);
		req.end();
	});
}

describe("/api/replays", () => {
	it("список: найновіші першими, лише коректні .ndjson", async () => {
		const r = await fetch(`http://127.0.0.1:${main.port}/api/replays`);
		const { replays } = await r.json();
		assert.deepEqual(
			replays.slice(0, 2).map((x) => x.id),
			["calm-2", "calm-1"],
		);
		assert.equal(replays[0].size, 56);
		const ids = replays.map((x) => x.id);
		assert.ok(ids.includes("big") && ids.includes("empty"));
		assert.ok(!ids.includes("notes") && !ids.includes("bad.name"));
	});

	it("теки логів ще немає: порожній список", async () => {
		const { port } = await startApp(path.join(base, "nope"));
		const r = await fetch(`http://127.0.0.1:${port}/api/replays`);
		assert.deepEqual(await r.json(), { replays: [] });
	});

	it("файл віддається байт у байт із правильними заголовками", async () => {
		const r = await fetch(`http://127.0.0.1:${main.port}/api/replays/calm-2`);
		assert.equal(r.status, 200);
		assert.match(r.headers.get("content-type"), /application\/x-ndjson/);
		assert.equal(r.headers.get("content-length"), "56");
		assert.match(
			r.headers.get("content-disposition"),
			/attachment; filename="calm-2\.ndjson"/,
		);
		assert.equal(
			await r.text(),
			'{"t":2,"type":"match_start"}\n{"t":3,"type":"match_end"}\n',
		);
	});

	it("порожній файл це 200 з нульовою довжиною", async () => {
		const r = await fetch(`http://127.0.0.1:${main.port}/api/replays/empty`);
		assert.equal(r.status, 200);
		assert.equal(r.headers.get("content-length"), "0");
		assert.equal(await r.text(), "");
	});

	it("немає файлу 404, некоректний id 400", async () => {
		assert.equal((await raw(main.port, "/api/replays/nope")).status, 404);
		for (const id of ["..%2fsecret", "a.b", "x%00", "..", "%2e%2e", "a%20b"]) {
			assert.equal(
				(await raw(main.port, `/api/replays/${id}`)).status,
				400,
				id,
			);
		}
	});

	it("не GET це 405", async () => {
		assert.equal(
			(await raw(main.port, "/api/replays/calm-1", "POST")).status,
			405,
		);
	});

	it("обрив клієнта посеред завантаження звільняє з'єднання, сервер живий", async () => {
		const { app, port } = await startApp(logDir); // окремий сервер: жодних чужих з'єднань
		await new Promise((resolve) => {
			const req = http.get(
				{ host: "127.0.0.1", port, path: "/api/replays/big", agent: false },
				(res) => {
					res.once("data", () => {
						res.destroy();
						req.destroy();
						resolve();
					});
				},
			);
			req.on("error", () => {});
		});

		let open = 1;
		for (let i = 0; i < 50 && open > 0; i++) {
			open = await new Promise((resolve) =>
				app.server.getConnections((_, n) => resolve(n)),
			);
			if (open > 0) await sleep(20);
		}
		assert.equal(open, 0);
		assert.equal((await fetch(`http://127.0.0.1:${port}/health`)).status, 200);
	});
});
