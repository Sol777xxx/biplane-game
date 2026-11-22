import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { setTimeout as sleep } from "node:timers/promises";
import { afterAll, describe, it } from "vitest";
import WebSocket from "ws";
import { createApp } from "../src/app.ts";
import { ConfigError, loadConfig } from "../src/config.ts";
import { silentLogger } from "../src/logger.ts";
import { clientIp, isOriginAllowed } from "../src/origin.ts";
import { RoomManager } from "../src/rooms.ts";

const apps = [];
afterAll(() => Promise.all(apps.map((a) => a.close())));

// сервер із конфігом, зібраним тим самим loadConfig, що й у production
async function start(env = {}, wsOptions = {}) {
	const rooms = new RoomManager();
	const config = {
		...loadConfig(env),
		port: 0,
		clientDir: tmpdir(),
		logDir: tmpdir(),
	};
	const app = createApp(config, {
		rooms,
		log: silentLogger,
		ws: wsOptions,
		matchLog: false,
	});
	const { port } = await app.listen();
	apps.push(app);
	return { app, rooms, port, http: `http://127.0.0.1:${port}` };
}

// Рукостискання з довільними заголовками. Повертає статус відмови, відкритий сокет
// або помилку (порт закрито).
function handshake(port, headers = {}) {
	return new Promise((resolve) => {
		const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, { headers });
		ws.on("error", (error) => resolve({ error }));
		ws.once("open", () => resolve({ ws }));
		ws.once("unexpected-response", (_req, res) => {
			resolve({ status: res.statusCode });
			res.resume();
		});
	});
}

describe("конфіг для хостингу", () => {
	it("значення за замовчуванням", () => {
		const c = loadConfig({});
		assert.deepEqual(c.allowedOrigins, []);
		assert.equal(c.maxConnPerIp, 20);
		assert.equal(c.maxPlayers, 200);
		assert.equal(c.trustProxy, false);
		assert.equal(c.logLevel, "info");
		assert.equal(c.gitSha, "dev");
	});

	it("читає оточення", () => {
		const c = loadConfig({
			ALLOWED_ORIGINS: "https://a.example, http://localhost:5173",
			MAX_CONN_PER_IP: "3",
			MAX_PLAYERS: "10",
			TRUST_PROXY: "1",
			LOG_LEVEL: "debug",
			GIT_SHA: " abc123 ",
		});
		assert.deepEqual(c.allowedOrigins, [
			"https://a.example",
			"http://localhost:5173",
		]);
		assert.equal(c.maxConnPerIp, 3);
		assert.equal(c.maxPlayers, 10);
		assert.equal(c.trustProxy, true);
		assert.equal(c.logLevel, "debug");
		assert.equal(c.gitSha, "abc123");
	});

	it("відхиляє некоректні значення й збирає всі помилки", () => {
		for (const env of [
			{ ALLOWED_ORIGINS: "https://a.example/" }, // слеш наприкінці
			{ ALLOWED_ORIGINS: "a.example" }, // без схеми
			{ MAX_CONN_PER_IP: "0" },
			{ MAX_PLAYERS: "abc" },
			{ LOG_LEVEL: "loud" },
		]) {
			assert.throws(() => loadConfig(env), ConfigError, JSON.stringify(env));
		}
		assert.throws(
			() => loadConfig({ MAX_CONN_PER_IP: "0", MAX_PLAYERS: "x" }),
			(e) => e instanceof ConfigError && e.problems.length === 2,
		);
	});
});

describe("isOriginAllowed", () => {
	it("без Origin це не браузер: пропускаємо", () => {
		assert.equal(isOriginAllowed(undefined, "h:1", []), true);
		assert.equal(
			isOriginAllowed(undefined, "h:1", ["https://a.example"]),
			true,
		);
	});

	it("зі списком: лише дослівний збіг", () => {
		const list = ["https://a.example"];
		assert.equal(isOriginAllowed("https://a.example", "x", list), true);
		assert.equal(isOriginAllowed("https://evil.example", "x", list), false);
		assert.equal(isOriginAllowed("http://a.example", "x", list), false);
		assert.equal(
			isOriginAllowed("https://a.example.evil.io", "x", list),
			false,
		);
	});

	it("без списку: Origin мусить збігатися з Host", () => {
		assert.equal(
			isOriginAllowed("http://127.0.0.1:3000", "127.0.0.1:3000", []),
			true,
		);
		assert.equal(
			isOriginAllowed("http://evil.example", "127.0.0.1:3000", []),
			false,
		);
		assert.equal(isOriginAllowed("null", "127.0.0.1:3000", []), false);
		assert.equal(isOriginAllowed("http://a", undefined, []), false);
	});
});

describe("clientIp", () => {
	const req = (headers, remote = "10.0.0.1") => ({
		headers,
		socket: { remoteAddress: remote },
	});

	it("прямо: адреса сокета, X-Forwarded-For ігнорується", () => {
		assert.equal(
			clientIp(req({ "x-forwarded-for": "1.2.3.4" }), false),
			"10.0.0.1",
		);
	});

	it("за проксі: перший елемент X-Forwarded-For, інакше сокет", () => {
		assert.equal(
			clientIp(req({ "x-forwarded-for": "1.2.3.4, 5.6.7.8" }), true),
			"1.2.3.4",
		);
		assert.equal(clientIp(req({}), true), "10.0.0.1");
	});
});

describe("/health, /ready, /metrics", () => {
	it("/health віддає git SHA збірки", async () => {
		const { http } = await start({ GIT_SHA: "deadbeef" });
		const body = await (await fetch(`${http}/health`)).json();
		assert.equal(body.status, "ok");
		assert.equal(body.sha, "deadbeef");
		assert.ok(body.uptime >= 0);
	});

	it("/ready: 200, а після початку завершення 503", async () => {
		const { app, http } = await start();
		const ok = await fetch(`${http}/ready`);
		assert.equal(ok.status, 200);
		assert.equal((await ok.json()).status, "ready");
		assert.equal(app.closing, false);

		const closing = app.close();
		assert.equal(app.closing, true);
		await closing;
	});

	it("/ready: 503, коли гравців стільки, скільки дозволено", async () => {
		const { rooms, http, port } = await start({ MAX_PLAYERS: "1" });
		const room = rooms.create({ name: "А" });
		const { ws } = await handshake(port);
		ws.send(JSON.stringify({ v: 1, type: "join", room: room.id, name: "A" }));
		while (room.players.size === 0) await sleep(10);

		const r = await fetch(`${http}/ready`);
		assert.equal(r.status, 503);
		assert.equal((await r.json()).reason, "full");
		ws.close();
	});

	it("/metrics: текст Prometheus із потрібними метриками", async () => {
		const { rooms, http, port } = await start({ GIT_SHA: "abc" });
		const room = rooms.create({ name: "А" });
		const { ws } = await handshake(port);
		ws.send(JSON.stringify({ v: 1, type: "join", room: room.id, name: "A" }));
		while (room.players.size === 0) await sleep(10);

		const r = await fetch(`${http}/metrics`);
		assert.equal(r.status, 200);
		assert.match(r.headers.get("content-type") ?? "", /^text\/plain/);
		const text = await r.text();
		for (const name of [
			"biplane_players 1",
			"biplane_rooms 1",
			'biplane_build_info{sha="abc"} 1',
			'biplane_messages_total{direction="in"}',
			'biplane_bytes_total{direction="out"}',
			"biplane_messages_per_second",
			"biplane_bytes_per_second",
			"biplane_tick_ms",
			"biplane_event_loop_utilization",
			"biplane_memory_bytes",
		]) {
			assert.ok(text.includes(name), `немає ${name}`);
		}
		assert.match(text, /biplane_messages_total\{direction="in"\} [1-9]/);
		ws.close();
	});
});

describe("WebSocket: Origin, ліміти, shutdown", () => {
	it("чужий Origin: 403, свій і відсутній пропускаються (зі списком)", async () => {
		const { port } = await start({ ALLOWED_ORIGINS: "https://game.example" });
		assert.equal(
			(await handshake(port, { Origin: "https://evil.example" })).status,
			403,
		);

		const ok = await handshake(port, { Origin: "https://game.example" });
		assert.ok(ok.ws);
		ok.ws.close();

		const noOrigin = await handshake(port);
		assert.ok(noOrigin.ws);
		noOrigin.ws.close();
	});

	it("без списку: Origin має збігатися з Host", async () => {
		const { port } = await start();
		assert.equal(
			(await handshake(port, { Origin: "http://evil.example" })).status,
			403,
		);
		const same = await handshake(port, { Origin: `http://127.0.0.1:${port}` });
		assert.ok(same.ws);
		same.ws.close();
	});

	it("ліміт з'єднань з однієї IP: 429, а після закриття місце звільняється", async () => {
		const { port } = await start({ MAX_CONN_PER_IP: "2" });
		const a = await handshake(port);
		const b = await handshake(port);
		assert.ok(a.ws && b.ws);
		assert.equal((await handshake(port)).status, 429);

		a.ws.close();
		await new Promise((resolve) => a.ws.once("close", resolve));
		await sleep(20);
		const c = await handshake(port);
		assert.ok(c.ws);
		b.ws.close();
		c.ws.close();
	});

	it("за проксі лічильник іде за X-Forwarded-For", async () => {
		const { port } = await start({ MAX_CONN_PER_IP: "1", TRUST_PROXY: "1" });
		const a = await handshake(port, { "X-Forwarded-For": "1.1.1.1" });
		assert.ok(a.ws);
		assert.equal(
			(await handshake(port, { "X-Forwarded-For": "1.1.1.1" })).status,
			429,
		);
		const other = await handshake(port, { "X-Forwarded-For": "2.2.2.2" });
		assert.ok(other.ws);
		a.ws.close();
		other.ws.close();
	});

	it("MAX_PLAYERS: зайвий гравець отримує 4006 «server full»", async () => {
		const { rooms, port } = await start({ MAX_PLAYERS: "1" });
		const room = rooms.create({ name: "А", max: 4 });
		const first = await handshake(port);
		first.ws.send(
			JSON.stringify({ v: 1, type: "join", room: room.id, name: "A" }),
		);
		while (room.players.size === 0) await sleep(10);

		const second = await handshake(port);
		const closed = new Promise((resolve) =>
			second.ws.once("close", (code, reason) =>
				resolve({ code, reason: reason.toString() }),
			),
		);
		second.ws.send(
			JSON.stringify({ v: 1, type: "join", room: room.id, name: "B" }),
		);
		assert.deepEqual(await closed, { code: 4006, reason: "server full" });
		first.ws.close();
	});

	it("shutdown: клієнт отримує повідомлення shutdown і закриття 1001", async () => {
		const { app, rooms, port } = await start();
		const room = rooms.create({ name: "А" });
		const { ws } = await handshake(port);
		const messages = [];
		ws.on("message", (data) => messages.push(JSON.parse(data.toString())));
		const closed = new Promise((resolve) =>
			ws.once("close", (code) => resolve(code)),
		);
		ws.send(JSON.stringify({ v: 1, type: "join", room: room.id, name: "A" }));
		while (room.players.size === 0) await sleep(10);

		const started = performance.now();
		await app.close();
		assert.equal(await closed, 1001);
		assert.ok(messages.some((m) => m.type === "shutdown"));
		assert.ok(performance.now() - started < 5000);
		// порт закрито: нових з'єднань немає
		assert.ok((await handshake(port)).error);
	});

	it("биті кадри: з'єднання закривається, лічильник порушень росте", async () => {
		const { http, port } = await start();
		const { ws } = await handshake(port);
		const closed = new Promise((resolve) =>
			ws.once("close", (code) => resolve(code)),
		);
		for (let i = 0; i < 200; i++) ws.send("{broken json");
		assert.equal(await closed, 4000);
		const text = await (await fetch(`${http}/metrics`)).text();
		assert.match(text, /biplane_ws_violations_total\{code="4000"\} [1-9]/);
	});
});
