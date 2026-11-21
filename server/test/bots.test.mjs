import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { setTimeout as sleep } from "node:timers/promises";
import { afterAll, beforeAll, describe, it } from "vitest";
import { createApp } from "../src/app.ts";
import { createBots, decide } from "../src/bots.ts";
import { Room, RoomManager } from "../src/rooms.ts";

const ship = (player, x, y, extra = {}) => ({
	id: player,
	player,
	x,
	y,
	vx: 0,
	vy: 0,
	pitch: 0,
	facing: 1,
	hp: 100,
	cooldown: 0,
	shield: 0,
	rapid: 0,
	homing: 0,
	...extra,
});
const world = (ships, extra = {}) => ({
	tick: 1,
	players: [],
	ships,
	obstacles: [],
	bullets: [],
	pickups: [],
	...extra,
});
const ARENA = {
	obstacles: 0,
	pickupEvery: 8,
	homingChance: 0,
	speed: 1,
	refillEvery: 2,
};

describe("decide: рішення бота", () => {
	it("без свого корабля нічого не тисне", () => {
		const keys = decide(world([ship("a", 0, 0)]), "bot");
		assert.deepEqual(Object.values(keys), [false, false, false, false, false]);
	});

	it("переслідує ціль і стріляє, коли вона прямо перед носом", () => {
		const keys = decide(
			world([ship("bot", 100, 450), ship("a", 500, 450)]),
			"bot",
		);
		assert.equal(keys.right, true);
		assert.equal(keys.left, false);
		assert.equal(keys.fire, true);
	});

	it("не стріляє, коли ціль позаду або далеко", () => {
		const behind = decide(
			world([ship("bot", 500, 450), ship("a", 100, 450)]),
			"bot",
		);
		assert.equal(behind.fire, false);
		const far = decide(
			world([ship("bot", 100, 450), ship("a", 1000, 450)]),
			"bot",
		);
		assert.equal(far.fire, false);
	});

	it("ухиляється від перешкоди, а не рветься до цілі", () => {
		const keys = decide(
			world([ship("bot", 400, 450), ship("a", 900, 450)], {
				obstacles: [{ id: "o", x: 500, y: 450, vx: 0, vy: 0, r: 45 }],
			}),
			"bot",
		);
		assert.equal(keys.left, true);
		assert.equal(keys.right, false);
	});

	it("ухиляється від чужої кулі, власні кулі ігнорує", () => {
		const bullet = (owner) => ({
			id: "b",
			owner,
			seq: 0,
			x: 450,
			y: 450,
			vx: 0,
			vy: 0,
			ttl: 1,
		});
		const solo = [ship("bot", 400, 450)];
		assert.equal(
			decide(world(solo, { bullets: [bullet("a")] }), "bot").left,
			true,
		);
		assert.equal(
			decide(world(solo, { bullets: [bullet("bot")] }), "bot").left,
			false,
		);
	});

	it("spray: стріляє завжди", () => {
		const keys = decide(world([ship("bot", 100, 450)]), "bot", { spray: true });
		assert.equal(keys.fire, true);
	});

	it("без цілей іде до центру арени", () => {
		const keys = decide(world([ship("bot", 100, 100)]), "bot");
		assert.equal(keys.right, true);
		assert.equal(keys.down, true);
	});
});

describe("BotManager", () => {
	const snap = { snapshot: world([ship("x", 1, 1)]), acks: new Map() };

	it("боти заходять у кімнату й шлють input із зростаючим seq", () => {
		const room = new Room({ id: "r", name: "R", max: 4, arena: ARENA });
		const bots = createBots();
		const inputs = [];
		room.on("input", (m) => inputs.push(m));

		const ids = bots.add(room, 2);
		assert.equal(ids.length, 2);
		assert.equal(room.players.size, 2);
		assert.equal(bots.count(room), 2);

		room.emit("snapshot", snap);
		room.emit("snapshot", snap);
		const first = inputs.filter((m) => m.playerId === ids[0]);
		assert.deepEqual(
			first.map((m) => m.seq),
			[1, 2],
		);
	});

	it("clear виводить ботів і перестає слухати знімки", () => {
		const room = new Room({ id: "r", name: "R", max: 4, arena: ARENA });
		const bots = createBots();
		const inputs = [];
		room.on("input", (m) => inputs.push(m));
		bots.add(room, 3);
		assert.equal(bots.clear(room), 3);
		assert.equal(room.players.size, 0);
		room.emit("snapshot", snap);
		assert.equal(inputs.length, 0);
		assert.equal(bots.clear(room), 0);
	});

	it("повна кімната: RoomError full", () => {
		const room = new Room({ id: "r", name: "R", max: 2, arena: ARENA });
		const bots = createBots();
		assert.throws(() => bots.add(room, 3), { code: "full" });
		bots.dispose();
	});
});

describe("POST /api/rooms/:id/bots", () => {
	let app;
	let base;
	let roomId;

	beforeAll(async () => {
		const rooms = new RoomManager();
		roomId = rooms.create({
			name: "B",
			max: 8,
			arena: ARENA,
			permanent: true,
		}).id;
		app = createApp(
			{ port: 0, host: "127.0.0.1", clientDir: tmpdir(), logDir: tmpdir() },
			{ rooms, game: true, matchLog: false },
		);
		const { port } = await app.listen();
		base = `http://127.0.0.1:${port}`;
	});
	afterAll(() => app.close());

	const call = (path, method, body) =>
		fetch(`${base}${path}`, {
			method,
			headers: { "content-type": "application/json" },
			body: body === undefined ? undefined : JSON.stringify(body),
		});
	const stats = async () => await (await fetch(`${base}/api/stats`)).json();

	it("додає ботів, гра їх рахує, видаляє їх", async () => {
		const r = await call(`/api/rooms/${roomId}/bots`, "POST", {
			count: 3,
			spray: true,
		});
		assert.equal(r.status, 201);
		const body = await r.json();
		assert.equal(body.added.length, 3);
		assert.equal(body.bots, 3);

		await sleep(400);
		const s = await stats();
		const room = s.rooms.find((x) => x.id === roomId);
		assert.equal(room.players, 3);
		assert.ok(room.ticks > 3, `ticks=${room.ticks}`);
		assert.ok(room.tickMs.p99 >= room.tickMs.p50);
		assert.equal(typeof s.eventLoop.utilization, "number");
		assert.ok(s.eventLoop.delayMs.p99 >= 0);
		assert.ok(s.memory.heapUsed > 0);

		const del = await call(`/api/rooms/${roomId}/bots`, "DELETE");
		assert.deepEqual(await del.json(), { removed: 3 });
	});

	it("помилки: немає кімнати, зайве поле, переповнення, метод", async () => {
		assert.equal((await call("/api/rooms/nope/bots", "POST", {})).status, 404);
		assert.equal(
			(await call(`/api/rooms/${roomId}/bots`, "POST", { count: 99 })).status,
			400,
		);
		assert.equal(
			(await call(`/api/rooms/${roomId}/bots`, "POST", { extra: 1 })).status,
			400,
		);
		assert.equal(
			(await call(`/api/rooms/${roomId}/bots`, "POST", { count: 9 })).status,
			409,
		);
		const get = await call(`/api/rooms/${roomId}/bots`, "GET");
		assert.equal(get.status, 405);
		assert.equal(get.headers.get("allow"), "POST, DELETE");
	});
});
