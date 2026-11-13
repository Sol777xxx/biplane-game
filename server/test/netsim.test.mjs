import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { after, afterEach, describe, it } from "node:test";
import { setTimeout as sleep } from "node:timers/promises";
import WebSocket from "ws";
import { createApp } from "../src/app.js";
import { silentLogger } from "../src/logger.js";
import { NetSim, parseNetsimUrl } from "../src/netsim.js";
import { CLOSE, validate } from "../src/protocol.js";
import { RoomManager } from "../src/rooms.js";

// Підроблений годинник: advance(ms) запускає таймери за порядком часу.
function fakeClock() {
	let t = 0;
	let id = 0;
	const timers = new Map();
	return {
		now: () => t,
		setTimer(fn, ms) {
			const key = ++id;
			timers.set(key, { at: t + ms, fn });
			return key;
		},
		clearTimer(key) {
			timers.delete(key);
		},
		get pending() {
			return timers.size;
		},
		advance(ms) {
			const target = t + ms;
			for (;;) {
				let best = null;
				for (const [key, timer] of timers) {
					if (!best || timer.at < best.timer.at) best = { key, timer };
				}
				if (!best || best.timer.at > target) break;
				timers.delete(best.key);
				t = Math.max(t, best.timer.at);
				best.timer.fn();
			}
			t = target;
		},
	};
}

// «випадкові» числа з масиву по колу
const seq = (...values) => {
	let i = 0;
	return () => values[i++ % values.length];
};

function make(options = {}) {
	const clock = fakeClock();
	const sim = new NetSim({
		now: clock.now,
		setTimer: clock.setTimer,
		clearTimer: clock.clearTimer,
		...options,
	});
	return { clock, sim };
}

describe("NetSim", () => {
	it("вимкнений: виконує одразу, без таймерів", () => {
		const { clock, sim } = make();
		const got = [];
		assert.equal(sim.active, false);
		assert.equal(
			sim.outbound(() => got.push("a")),
			true,
		);
		assert.deepEqual(got, ["a"]);
		assert.equal(clock.pending, 0);
	});

	it("lag ділиться порівну між напрямками: 100 мс RTT це 50 мс в один бік", () => {
		const { clock, sim } = make({ lag: 100 });
		const got = [];
		sim.outbound(() => got.push(clock.now()));
		clock.advance(49);
		assert.deepEqual(got, []);
		clock.advance(1);
		assert.deepEqual(got, [50]);
	});

	it("jitter: затримка в межах lag/2 ± jitter/2", () => {
		const lo = make({ lag: 100, jitter: 40, random: seq(0) });
		const hi = make({ lag: 100, jitter: 40, random: seq(1) });
		const at = (m) => {
			let when = null;
			m.sim.outbound(() => {
				when = m.clock.now();
			});
			m.clock.advance(200);
			return when;
		};
		assert.equal(at(lo), 30); // 50 − 20
		assert.equal(at(hi), 70); // 50 + 20
	});

	it("порядок зберігається: менший розкид не обганяє попереднє повідомлення", () => {
		const { clock, sim } = make({ lag: 100, jitter: 40, random: seq(1, 0) });
		const got = [];
		sim.outbound(() => got.push(["a", clock.now()])); // 70
		sim.outbound(() => got.push(["b", clock.now()])); // хотіло 30, чекає за a
		clock.advance(69);
		assert.deepEqual(got, []);
		clock.advance(1);
		assert.deepEqual(got, [
			["a", 70],
			["b", 70],
		]);
	});

	it("втрати: лише lossy-повідомлення, решта не губиться", () => {
		const { sim } = make({ loss: 50, random: seq(0.1, 0.9, 0.1, 0.9) });
		const got = [];
		// 0.1 → 10 < 50: втрачено
		assert.equal(
			sim.outbound(() => got.push("snap1"), { lossy: true }),
			false,
		);
		// 0.9 → 90: доставлено (наступне випадкове число йде на розкид)
		assert.equal(
			sim.outbound(() => got.push("snap2"), { lossy: true }),
			true,
		);
		// не lossy: ніколи не губиться, навіть при «поганому» числі
		assert.equal(
			sim.outbound(() => got.push("chat")),
			true,
		);
		assert.deepEqual(got, ["snap2", "chat"]);
		assert.equal(sim.dropped, 1);
	});

	it("вхідний і вихідний напрямки незалежні", () => {
		const { clock, sim } = make({ lag: 100 });
		const got = [];
		sim.inbound(() => got.push("in"));
		clock.advance(30);
		sim.outbound(() => got.push("out"));
		clock.advance(20);
		assert.deepEqual(got, ["in"]); // 50 мс від старту
		clock.advance(30);
		assert.deepEqual(got, ["in", "out"]); // 80 = 30 + 50
	});

	it("вимкнення при повідомленнях у черзі не ламає порядок", () => {
		const { clock, sim } = make({ lag: 100 });
		const got = [];
		sim.outbound(() => got.push("a")); // 50 мс
		sim.set({ lag: 0 });
		sim.outbound(() => got.push("b")); // нове, але a ще чекає: стає за ним
		assert.deepEqual(got, []);
		clock.advance(50);
		assert.deepEqual(got, ["a", "b"]);
	});

	it("settings і set: відсутнє стає нулем, значення обмежені", () => {
		const { sim } = make({ lag: 100, jitter: 30, loss: 2 });
		assert.deepEqual(sim.settings, { lag: 100, jitter: 30, loss: 2 });
		sim.set({ lag: 1e9, loss: 99 });
		assert.deepEqual(sim.settings, { lag: 1000, jitter: 0, loss: 50 });
		sim.set({ lag: Number.NaN, jitter: "x" });
		assert.deepEqual(sim.settings, { lag: 0, jitter: 0, loss: 0 });
		assert.equal(sim.active, false);
	});

	it("dispose скасовує відкладене й знімає таймери", () => {
		const { clock, sim } = make({ lag: 100 });
		const got = [];
		sim.outbound(() => got.push("a"));
		assert.equal(clock.pending, 1);
		sim.dispose();
		assert.equal(clock.pending, 0);
		clock.advance(500);
		assert.deepEqual(got, []);
	});

	it("виняток в одному повідомленні не зупиняє решту", () => {
		const errors = [];
		const { clock, sim } = make({
			lag: 100,
			onError: (error) => errors.push(error.message),
		});
		const got = [];
		sim.outbound(() => {
			throw new Error("boom");
		});
		sim.outbound(() => got.push("b"));
		clock.advance(50);
		assert.deepEqual(errors, ["boom"]);
		assert.deepEqual(got, ["b"]);
	});
});

describe("parseNetsimUrl", () => {
	it("читає lag, jitter, loss з адреси", () => {
		assert.deepEqual(parseNetsimUrl("/ws?lag=100&jitter=30&loss=2"), {
			lag: 100,
			jitter: 30,
			loss: 2,
		});
		assert.deepEqual(parseNetsimUrl("/ws?loss=2.5"), {
			lag: 0,
			jitter: 0,
			loss: 2.5,
		});
	});

	it("немає параметрів або сміття: нулі", () => {
		const zero = { lag: 0, jitter: 0, loss: 0 };
		assert.deepEqual(parseNetsimUrl("/ws"), zero);
		for (const bad of ["abc", "-5", "1e3", "", "99999", " 5"]) {
			assert.deepEqual(parseNetsimUrl(`/ws?lag=${bad}`), zero, bad);
		}
	});

	it("завелике значення обмежується межею", () => {
		assert.deepEqual(parseNetsimUrl("/ws?lag=5000&jitter=900&loss=75"), {
			lag: 1000,
			jitter: 500,
			loss: 50,
		});
	});
});

describe("validate: netsim", () => {
	const OK = { v: 1, type: "netsim", lag: 100, jitter: 30, loss: 2 };

	it("правильне повідомлення проходить", () => {
		const r = validate({ ...OK });
		assert.equal(r.ok, true);
		assert.deepEqual(r.msg, OK);
		assert.equal(validate({ ...OK, loss: 2.5 }).ok, true);
		assert.equal(validate({ ...OK, lag: 0, jitter: 0, loss: 0 }).ok, true);
	});

	it("зламане: BAD_FORMAT", () => {
		const { lag: _lag, ...noLag } = OK;
		const bad = [
			noLag,
			{ ...OK, extra: 1 },
			{ ...OK, lag: -1 },
			{ ...OK, lag: 1001 },
			{ ...OK, lag: 1.5 },
			{ ...OK, lag: "100" },
			{ ...OK, jitter: 501 },
			{ ...OK, loss: 50.1 },
			{ ...OK, loss: -1 },
			{ ...OK, loss: Number.NaN },
			{ ...OK, loss: null },
		];
		for (const raw of bad) {
			const r = validate(raw);
			assert.equal(r.ok, false, JSON.stringify(raw));
			assert.equal(r.code, CLOSE.BAD_FORMAT, JSON.stringify(raw));
		}
	});
});

// ---------- наскрізно: справжній сервер, справжні сокети, справжній час ----------
const apps = [];
const open = [];

async function startApp({ netsim, game = false }) {
	const rooms = new RoomManager();
	const room = rooms.create({ name: "N", max: 8, permanent: true });
	const config = {
		port: 0,
		host: "127.0.0.1",
		clientDir: tmpdir(),
		logDir: tmpdir(),
		enableNetsim: netsim,
	};
	const app = createApp(config, {
		rooms,
		log: silentLogger,
		matchLog: false,
		game,
	});
	const { port } = await app.listen();
	apps.push(app);
	return { app, rooms, room, url: `ws://127.0.0.1:${port}/ws` };
}

afterEach(() => {
	for (const ws of open.splice(0)) ws.terminate();
});
after(() => Promise.all(apps.map((app) => app.close())));

async function waitFor(condition, ms = 4000) {
	const end = Date.now() + ms;
	while (!condition()) {
		if (Date.now() > end) throw new Error("waitFor: час вийшов");
		await sleep(5);
	}
}

async function join(url, roomId, name = "p") {
	const ws = new WebSocket(url);
	open.push(ws);
	const messages = [];
	const closed = new Promise((resolve) =>
		ws.on("close", (code) => resolve(code)),
	);
	ws.on("message", (data) => messages.push(JSON.parse(data.toString())));
	ws.on("error", () => {});
	await new Promise((resolve) => ws.once("open", resolve));
	const send = (message) => ws.send(JSON.stringify({ v: 1, ...message }));
	send({ type: "join", room: roomId, name });
	await waitFor(() => messages.some((m) => m.type === "joined"));
	return { ws, messages, closed, send };
}

async function rtt(c) {
	const t = performance.now();
	c.send({ type: "ping", t });
	await waitFor(() => c.messages.some((m) => m.type === "pong" && m.t === t));
	return performance.now() - t;
}

const netsimMessages = (c) => c.messages.filter((m) => m.type === "netsim");

describe("штучна мережа на сервері", { timeout: 30_000 }, () => {
	it("вимкнена на сервері: параметри ігноруються, netsim отримує enabled: false", async () => {
		const { room, url } = await startApp({ netsim: false });
		const c = await join(`${url}?lag=300`, room.id);
		assert.ok((await rtt(c)) < 150);
		assert.equal(netsimMessages(c).length, 0); // сервер нічого не пропонує

		c.send({ type: "netsim", lag: 200, jitter: 0, loss: 0 });
		await waitFor(() => netsimMessages(c).length === 1);
		assert.deepEqual(
			{ ...netsimMessages(c)[0], v: undefined, type: undefined },
			{
				v: undefined,
				type: undefined,
				enabled: false,
				lag: 0,
				jitter: 0,
				loss: 0,
			},
		);
		assert.ok((await rtt(c)) < 150); // значення не застосовано, сокет відкритий
	});

	it("увімкнена: стан приходить після join, RTT не менший за lag", async () => {
		const { room, url } = await startApp({ netsim: true });
		const c = await join(`${url}?lag=100`, room.id);
		await waitFor(() => netsimMessages(c).length === 1);
		const state = netsimMessages(c)[0];
		assert.equal(state.enabled, true);
		assert.equal(state.lag, 100);
		const ms = await rtt(c);
		assert.ok(ms >= 90, `RTT ${ms}`);
		assert.ok(ms < 500, `RTT ${ms}`);
	});

	it("наживо: netsim змінює затримку без перепідключення", async () => {
		const { room, url } = await startApp({ netsim: true });
		const c = await join(url, room.id);
		const fast = await rtt(c);
		assert.ok(fast < 80, `RTT ${fast}`);

		c.send({ type: "netsim", lag: 200, jitter: 0, loss: 0 });
		await waitFor(() => netsimMessages(c).some((m) => m.lag === 200));
		const slow = await rtt(c);
		assert.ok(slow >= 180, `RTT ${slow}`);

		c.send({ type: "netsim", lag: 0, jitter: 0, loss: 0 });
		await waitFor(() => netsimMessages(c).at(-1)?.lag === 0);
		const back = await rtt(c);
		assert.ok(back < 80, `RTT ${back}`);
	});

	it("некоректний netsim закриває з'єднання 4000", async () => {
		const { room, url } = await startApp({ netsim: true });
		const c = await join(url, room.id);
		c.send({ type: "netsim", lag: -5, jitter: 0, loss: 0 });
		assert.equal(await c.closed, 4000);
	});

	it("netsim до join: 4003", async () => {
		const { url } = await startApp({ netsim: true });
		const ws = new WebSocket(url);
		open.push(ws);
		const closed = new Promise((resolve) =>
			ws.on("close", (code) => resolve(code)),
		);
		ws.on("error", () => {});
		await new Promise((resolve) => ws.once("open", resolve));
		ws.send(
			JSON.stringify({ v: 1, type: "netsim", lag: 0, jitter: 0, loss: 0 }),
		);
		assert.equal(await closed, 4003);
	});

	it("loss=50: знімки губляться, pong і chat ні", async () => {
		const { room, url } = await startApp({ netsim: true, game: true });
		const c = await join(`${url}?loss=50`, room.id);

		c.send({ type: "chat", text: "привіт" });
		for (let i = 0; i < 10; i++) {
			c.send({ type: "ping", t: 1000 + i });
			await sleep(150);
		}
		await waitFor(
			() => c.messages.filter((m) => m.type === "pong").length === 10,
		);
		assert.ok(c.messages.some((m) => m.type === "chat"));

		const snaps = c.messages.filter((m) => m.type === "snapshot");
		const lastTick = Math.max(...snaps.map((s) => s.tick));
		assert.ok(lastTick >= 30, `tick ${lastTick}`);
		assert.ok(
			snaps.length < lastTick * 0.8,
			`дійшло ${snaps.length} з ${lastTick}`,
		);
		assert.ok(snaps.length > lastTick * 0.2);
	});

	it("loss=50: частина input не доходить до кімнати", async () => {
		const { room, url } = await startApp({ netsim: true });
		const c = await join(`${url}?loss=50`, room.id);
		const got = [];
		room.on("input", (event) => got.push(event.seq));
		for (let seq = 1; seq <= 80; seq++) {
			c.send({
				type: "input",
				seq,
				up: false,
				down: false,
				left: false,
				right: true,
				fire: false,
			});
			await sleep(20);
		}
		await sleep(100);
		room.removeAllListeners("input");
		assert.ok(got.length > 10 && got.length < 70, `дійшло ${got.length} з 80`);
		assert.deepEqual(
			got,
			[...got].sort((a, b) => a - b),
		); // порядок зберігся
	});
});
