import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { after, before, describe, it } from "node:test";
import { createApp } from "../src/app.js";
import { RoomManager } from "../src/rooms.js";

let app;
let url;

before(async () => {
	const rooms = new RoomManager();
	app = createApp(
		{ port: 0, host: "127.0.0.1", clientDir: tmpdir(), logDir: tmpdir() },
		{ rooms },
	);
	const { port } = await app.listen();
	url = `http://127.0.0.1:${port}/api/rooms`;
});
after(() => app.close());

const post = (body, type = "application/json") =>
	fetch(url, {
		method: "POST",
		headers: { "content-type": type },
		body: typeof body === "string" ? body : JSON.stringify(body),
	});

describe("/api/rooms", () => {
	it("GET віддає список", async () => {
		const r = await fetch(url);
		assert.equal(r.status, 200);
		assert.ok(Array.isArray((await r.json()).rooms));
	});

	it("POST створює кімнату: 201, Location, видно в списку", async () => {
		const r = await post({ name: "  Тест ", max: 2, preset: "storm" });
		assert.equal(r.status, 201);
		const { room } = await r.json();
		assert.equal(room.name, "Тест");
		assert.equal(room.max, 2);
		assert.equal(room.arena.obstacles, 8);
		assert.equal(r.headers.get("location"), `/api/rooms/${room.id}`);
		const list = (await (await fetch(url)).json()).rooms;
		assert.ok(list.some((x) => x.id === room.id));
	});

	it("некоректні дані це 400", async () => {
		const bad = [
			{},
			{ name: "" },
			{ name: "   " },
			{ name: "x".repeat(25) },
			{ name: 5 },
			{ name: "ok", max: 99 },
			{ name: "ok", max: 1.5 },
			{ name: "ok", preset: "nope" },
			{ name: "ok", preset: "toString" },
			{ name: "ok", extra: 1 },
			[],
			null,
		];
		for (const body of bad) {
			const r = await post(body);
			assert.equal(r.status, 400, JSON.stringify(body));
		}
	});

	it("не JSON за Content-Type це 415", async () => {
		assert.equal((await post('{"name":"a"}', "text/plain")).status, 415);
	});

	it("зламаний JSON це 400", async () => {
		assert.equal((await post('{"name":')).status, 400);
	});

	it("тіло більше за 1 КБ це 413", async () => {
		const r = await post(`{"name":"${"x".repeat(2000)}"}`);
		assert.equal(r.status, 413);
	});

	it("інший метод це 405 з Allow", async () => {
		const r = await fetch(url, { method: "DELETE" });
		assert.equal(r.status, 405);
		assert.equal(r.headers.get("allow"), "GET, POST");
	});

	it("невідомий /api/... це 404", async () => {
		const r = await fetch(`${url}/../nope`.replace("/rooms/..", ""));
		assert.equal(r.status, 404);
	});
});
