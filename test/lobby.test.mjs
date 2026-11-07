import assert from "node:assert/strict";
import http from "node:http";
import { after, before, describe, it } from "node:test";
import { sleep } from "../src/assets/loader.js";
import { Lobby } from "../src/lobby.js";

const ROOMS = {
	rooms: [
		{ id: "a", name: "A", players: 1, max: 4, arena: {} },
		{ id: "full", name: "F", players: 4, max: 4, arena: {} },
	],
};

let server;
let base;

before(async () => {
	server = http.createServer((req, res) => {
		const u = new URL(req.url, "http://x");
		const delay = Number(u.searchParams.get("delay") ?? 0);
		setTimeout(() => {
			if (u.pathname === "/rooms") return res.end(JSON.stringify(ROOMS));
			res.statusCode = 404;
			res.end("nope");
		}, delay);
	});
	await new Promise((r) => server.listen(0, r));
	base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

function collect(lobby, type) {
	const seen = [];
	lobby.addEventListener(type, (e) => seen.push(e.detail));
	return seen;
}

describe("Lobby", () => {
	it("refresh віддає список кімнат подією rooms", async () => {
		const lobby = new Lobby({ url: `${base}/rooms` });
		const seen = collect(lobby, "rooms");
		await lobby.refresh();
		assert.equal(seen.length, 1);
		assert.deepEqual(seen[0], ROOMS.rooms);
		assert.deepEqual(lobby.rooms, ROOMS.rooms);
	});

	it("404 дає подію error, а не rooms", async () => {
		const lobby = new Lobby({ url: `${base}/none` });
		const rooms = collect(lobby, "rooms");
		const errors = collect(lobby, "error");
		await lobby.refresh();
		assert.equal(rooms.length, 0);
		assert.equal(errors[0].status, 404);
	});

	it("кожен запит має таймаут", async () => {
		const lobby = new Lobby({ url: `${base}/rooms?delay=500`, timeoutMs: 50 });
		const errors = collect(lobby, "error");
		await lobby.refresh();
		assert.equal(errors[0].name, "TimeoutError");
	});

	it("stop() обриває запит, який ще летить: жодних подій", async () => {
		const lobby = new Lobby({ url: `${base}/rooms?delay=200` });
		const rooms = collect(lobby, "rooms");
		const errors = collect(lobby, "error");
		lobby.start();
		await sleep(30);
		lobby.stop();
		await sleep(300);
		assert.equal(rooms.length, 0);
		assert.equal(errors.length, 0);
	});

	it("опитує по інтервалу й замовкає після stop()", async () => {
		const lobby = new Lobby({ url: `${base}/rooms`, intervalMs: 30 });
		const rooms = collect(lobby, "rooms");
		lobby.start();
		await sleep(250);
		lobby.stop();
		assert.ok(rooms.length >= 3, `лише ${rooms.length} оновлень`);
		const n = rooms.length;
		await sleep(100);
		assert.equal(rooms.length, n);
	});

	it("join перевіряє ім'я, кімнату й заповненість", async () => {
		const lobby = new Lobby({ url: `${base}/rooms` });
		await lobby.refresh();
		assert.throws(() => lobby.join("   ", "a"), /ім'я/);
		assert.throws(() => lobby.join("Оля", "nope"), /кімнату/);
		assert.throws(() => lobby.join("Оля", "full"), /заповнена/);
		const joined = collect(lobby, "join");
		const choice = lobby.join("  Оля ", "a");
		assert.equal(choice.name, "Оля");
		assert.equal(joined[0].room.id, "a");
	});

	it("join зупиняє опитування", async () => {
		const lobby = new Lobby({ url: `${base}/rooms`, intervalMs: 30 });
		const rooms = collect(lobby, "rooms");
		lobby.start();
		await sleep(80);
		lobby.join("Оля", "a");
		const n = rooms.length;
		await sleep(150);
		assert.equal(rooms.length, n);
	});
});
