import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { setTimeout as sleep } from "node:timers/promises";
import { createApp } from "../src/app.js";

let base;
let app;
let port;

before(async () => {
	base = await mkdtemp(path.join(tmpdir(), "biplane-"));
	const dist = path.join(base, "dist");
	await mkdir(dist);
	await writeFile(path.join(dist, "index.html"), "<h1>hi</h1>");
	await writeFile(path.join(dist, "main.js"), "export {};");
	await writeFile(path.join(base, "secret.txt"), "TOP SECRET"); // поза root
	app = createApp({
		port: 0,
		host: "127.0.0.1",
		clientDir: dist,
		logDir: base,
	});
	({ port } = await app.listen());
});

after(async () => {
	await app.close();
	await rm(base, { recursive: true, force: true });
});

// сирий запит: fetch сам нормалізує "/../", а нам треба надіслати шлях як є
function raw(urlPath, method = "GET") {
	return new Promise((resolve, reject) => {
		const req = http.request(
			{ host: "127.0.0.1", port, path: urlPath, method, agent: false },
			(res) => {
				const chunks = [];
				res.on("data", (c) => chunks.push(c));
				res.on("end", () =>
					resolve({
						status: res.statusCode,
						headers: res.headers,
						body: Buffer.concat(chunks).toString(),
					}),
				);
			},
		);
		req.on("error", reject);
		req.end();
	});
}

describe("HTTP-сервер", () => {
	it("GET /health", async () => {
		const r = await raw("/health");
		assert.equal(r.status, 200);
		assert.equal(JSON.parse(r.body).status, "ok");
	});

	it("/ віддає index.html", async () => {
		const r = await raw("/");
		assert.equal(r.status, 200);
		assert.match(r.headers["content-type"], /text\/html/);
		assert.equal(r.body, "<h1>hi</h1>");
	});

	it("правильний MIME для .js", async () => {
		const r = await raw("/main.js");
		assert.match(r.headers["content-type"], /text\/javascript/);
	});

	it("неіснуючий файл це 404", async () => {
		assert.equal((await raw("/nope.png")).status, 404);
	});

	it("шлях із .. відхиляється (у т.ч. закодований)", async () => {
		for (const p of [
			"/../secret.txt",
			"/%2e%2e/secret.txt",
			"/..%2fsecret.txt",
			"/a/../../secret.txt",
			"/..\\secret.txt",
		]) {
			const r = await raw(p);
			assert.equal(r.status, 403, p);
			assert.ok(!r.body.includes("TOP SECRET"), p);
		}
	});

	it("зламане кодування та нуль-байт це 400", async () => {
		assert.equal((await raw("/%E0%A4%A")).status, 400);
		assert.equal((await raw("/%00")).status, 400);
	});

	it("POST на статику це 405", async () => {
		const r = await raw("/", "POST");
		assert.equal(r.status, 405);
		assert.equal(r.headers.allow, "GET, HEAD");
	});

	it("HEAD без тіла", async () => {
		const r = await raw("/", "HEAD");
		assert.equal(r.status, 200);
		assert.equal(r.body, "");
	});
});

describe("graceful shutdown", () => {
	it("виконує завдання по черзі, не висить на keep-alive й закриває порт", async () => {
		const second = createApp({
			port: 0,
			host: "127.0.0.1",
			clientDir: base,
			logDir: base,
		});
		const addr = await second.listen();
		const order = [];
		second.onClose(() => order.push("a"));
		second.onClose(async () => {
			await sleep(10);
			order.push("b");
		});

		// fetch тримає з'єднання keep-alive: close() не повинен на ньому зависнути
		await (await fetch(`http://127.0.0.1:${addr.port}/health`)).text();

		const t0 = Date.now();
		await second.close();
		assert.ok(Date.now() - t0 < 2000, "close() завис");
		assert.deepEqual(order, ["a", "b"]);
		await assert.rejects(fetch(`http://127.0.0.1:${addr.port}/health`));
	});
});
