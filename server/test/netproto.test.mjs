import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { after, afterEach, before, describe, it } from "node:test";
import { setTimeout as sleep } from "node:timers/promises";
import WebSocket from "ws";
import { createApp } from "../src/app.js";
import { silentLogger } from "../src/logger.js";
import { RoomManager } from "../src/rooms.js";

let app;
let rooms;
let room;
let url;
let counter = 0;
const open = [];

before(async () => {
	rooms = new RoomManager();
	room = rooms.create({ name: "T", max: 8, permanent: true });
	app = createApp(
		{ port: 0, host: "127.0.0.1", clientDir: tmpdir(), logDir: tmpdir() },
		{ rooms, log: silentLogger, matchLog: false },
	);
	const { port } = await app.listen();
	url = `ws://127.0.0.1:${port}/ws`;
});
afterEach(() => {
	for (const c of open.splice(0)) c.ws.terminate();
});
after(() => app.close());

const KEYS = { up: false, down: false, left: false, right: false, fire: false };
const input = (seq, extra = {}) => ({
	v: 1,
	type: "input",
	seq,
	...KEYS,
	...extra,
});

async function waitFor(condition, ms = 1500) {
	const end = Date.now() + ms;
	while (!condition()) {
		if (Date.now() > end) throw new Error("waitFor: час вийшов");
		await sleep(5);
	}
}

// сокет без join
async function connect() {
	const ws = new WebSocket(url);
	const messages = [];
	const closed = new Promise((resolve) =>
		ws.on("close", (code) => resolve(code)),
	);
	ws.on("message", (data) => messages.push(JSON.parse(data.toString())));
	ws.on("error", () => {});
	await new Promise((resolve) => ws.once("open", resolve));
	const c = {
		ws,
		messages,
		closed,
		send: (message) => ws.send(JSON.stringify(message)),
	};
	open.push(c);
	return c;
}

// сокет після join
async function joined() {
	const c = await connect();
	c.send({ v: 1, type: "join", room: room.id, name: `p${counter++}` });
	await waitFor(() => c.messages.some((m) => m.type === "joined"));
	c.you = c.messages.find((m) => m.type === "joined").you;
	return c;
}

// усі input, які кімната отримала, поки діє підписка
function collectInputs() {
	const got = [];
	const handler = (event) => got.push(event);
	room.on("input", handler);
	return { got, stop: () => room.off("input", handler) };
}

describe("ping і input", { timeout: 10_000 }, () => {
	it("ping до join: 4003", async () => {
		const c = await connect();
		c.send({ v: 1, type: "ping", t: 1 });
		assert.equal(await c.closed, 4003);
	});

	it("input до join: 4003", async () => {
		const c = await connect();
		c.send(input(1));
		assert.equal(await c.closed, 4003);
	});

	it("ping повертає pong із тим самим t", async () => {
		const c = await joined();
		c.send({ v: 1, type: "ping", t: 123.5 });
		await waitFor(() => c.messages.some((m) => m.type === "pong"));
		const pong = c.messages.find((m) => m.type === "pong");
		assert.deepEqual(pong, { v: 1, type: "pong", t: 123.5 });
	});

	it("input доходить до кімнати з id гравця й очищеними ключами", async () => {
		const c = await joined();
		const inputs = collectInputs();
		try {
			c.send(input(5, { right: true, fire: true }));
			await waitFor(() => inputs.got.length === 1);
			assert.deepEqual(inputs.got[0], {
				playerId: c.you.id,
				seq: 5,
				keys: { up: false, down: false, left: false, right: true, fire: true },
			});
		} finally {
			inputs.stop();
		}
	});

	it("зламаний input закриває з'єднання 4000", async () => {
		const { up: _up, ...noUp } = input(1);
		const bad = [
			{ ...input(1), seq: -1 },
			{ ...input(1), seq: 1.5 },
			{ ...input(1), seq: "1" },
			{ ...input(1), seq: 2 ** 32 },
			{ ...input(1), right: 1 },
			{ ...input(1), fire: "true" },
			{ ...input(1), turn: 1000 },
			noUp,
		];
		for (const message of bad) {
			const c = await joined();
			c.send(message);
			assert.equal(await c.closed, 4000, JSON.stringify(message));
		}
	});
});

describe("ліміти", { timeout: 10_000 }, () => {
	it("сплеск input понад відро: 4008, перші ~60 доходять", async () => {
		const c = await joined();
		const inputs = collectInputs();
		try {
			for (let seq = 1; seq <= 80; seq++) c.send(input(seq));
			assert.equal(await c.closed, 4008);
			assert.ok(inputs.got.length >= 60, `дійшло ${inputs.got.length}`);
			assert.ok(inputs.got.length < 80, `дійшло ${inputs.got.length}`);
		} finally {
			inputs.stop();
		}
	});

	it("input не з'їдає ліміт чату", async () => {
		const c = await joined();
		for (let seq = 1; seq <= 50; seq++) c.send(input(seq));
		c.send({ v: 1, type: "chat", text: "привіт" });
		await waitFor(() => c.messages.some((m) => m.type === "chat"));
		assert.equal(c.ws.readyState, WebSocket.OPEN);
	});

	it("спам чату, як і раніше, дає 4008", async () => {
		const c = await joined();
		for (let i = 0; i < 20; i++) {
			c.send({ v: 1, type: "chat", text: `спам ${i}` });
		}
		assert.equal(await c.closed, 4008);
	});

	it("стеля кадрів: 200 ping поспіль дають 4008", async () => {
		const c = await joined();
		for (let i = 0; i < 200; i++) c.send({ v: 1, type: "ping", t: i });
		assert.equal(await c.closed, 4008);
	});
});
