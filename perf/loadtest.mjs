// Навантажувальний тест сервера (лаб 7, M4): N справжніх WebSocket-клієнтів у кімнатах по
// PER_ROOM гравців, кожен шле input 30 разів на секунду й тримає вогонь. Вимірює тік сервера
// через /api/stats і знаходить ємність: найбільше N, де тік p99 ≤ 33,3 мс.
//
//   node perf/loadtest.mjs --label before
//   node perf/loadtest.mjs --levels 8,32,64,128 --seconds 20 --until-fail
//
// Результат: docs/perf/loadtest-<label>.{json,md,svg}
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { monitorEventLoopDelay } from "node:perf_hooks";
import { setTimeout as sleep } from "node:timers/promises";
import { parseArgs } from "node:util";
import {
	isMainThread,
	parentPort,
	Worker,
	workerData,
} from "node:worker_threads";
import { getCodec } from "biplane-shared/codec/index.ts";
import WebSocket from "ws";
import {
	capacity,
	holds,
	renderChart,
	summarizeLevel,
	toMarkdown,
} from "./loadreport.mjs";

const { values: args } = parseArgs({
	options: {
		label: { type: "string", default: "run" },
		levels: { type: "string", default: "8,32,64,128" },
		seconds: { type: "string", default: "20" },
		"per-room": { type: "string", default: "8" },
		port: { type: "string", default: "4181" },
		url: { type: "string" },
		"until-fail": { type: "boolean", default: false },
		"max-clients": { type: "string", default: "2048" },
		// скільки потоків створюють клієнтів: один потік сам стає вузьким місцем раніше за сервер
		shards: { type: "string", default: "4" },
	},
});
const SHARDS = Math.max(1, Number(args.shards));
const SECONDS = Number(args.seconds);
const PER_ROOM = Number(args["per-room"]);
const BASE = args.url ?? `http://127.0.0.1:${args.port}`;
const WS = `${BASE.replace(/^http/, "ws")}/ws?codec=binary`;
const OUT = "docs/perf";
const codec = getCodec("binary");

async function api(path, method = "GET", body) {
	const res = await fetch(`${BASE}${path}`, {
		method,
		headers: { "content-type": "application/json" },
		body: body === undefined ? undefined : JSON.stringify(body),
	});
	if (!res.ok)
		throw new Error(`${method} ${path}: ${res.status} ${await res.text()}`);
	return res.json();
}

async function startServer() {
	if (args.url) return null;
	const child = spawn(process.execPath, ["server/src/index.ts"], {
		env: {
			...process.env,
			PORT: args.port,
			HOST: "127.0.0.1",
			MAX_ROOMS: "1000",
			// усі клієнти з 127.0.0.1: ліміти хостингу (лаб 8) тут лише заважали б міряти тік
			MAX_CONN_PER_IP: "100000",
			MAX_PLAYERS: "100000",
			LOG_LEVEL: "error",
			LOG_DIR: mkdtempSync(join(tmpdir(), "biplane-load-")),
		},
		stdio: ["ignore", "ignore", "inherit"],
	});
	for (let i = 0; i < 100; i++) {
		try {
			await api("/api/rooms");
			return child;
		} catch {
			await sleep(100);
		}
	}
	child.kill();
	throw new Error("сервер не піднявся (чи зібрано клієнт: npm run build?)");
}

// Один клієнт: join, потім input 30/с з клавішами, що міняються, і вогнем.
function connect(wsUrl, room, name) {
	return new Promise((resolve, reject) => {
		const ws = new WebSocket(wsUrl);
		const client = { ws, snapshots: 0, timer: null };
		const fail = (e) => reject(e instanceof Error ? e : new Error(String(e)));
		ws.once("error", fail);
		ws.on("open", () =>
			ws.send(JSON.stringify({ v: 1, type: "join", room, name })),
		);
		ws.on("message", (data, isBinary) => {
			if (isBinary) {
				client.snapshots++;
				return;
			}
			const msg = JSON.parse(data.toString());
			if (msg.type === "error")
				fail(new Error(`${name}: ${msg.message ?? "помилка join"}`));
			if (msg.type !== "joined") return;
			let seq = 0;
			let keys = {
				up: false,
				down: false,
				left: false,
				right: true,
				fire: true,
			};
			client.timer = setInterval(() => {
				if (seq % 15 === 0) {
					keys = {
						up: Math.random() < 0.3,
						down: Math.random() < 0.3,
						left: Math.random() < 0.4,
						right: Math.random() < 0.4,
						fire: true,
					};
				}
				if (ws.readyState === WebSocket.OPEN)
					ws.send(codec.encodeInput(++seq, keys));
			}, 1000 / 30);
			resolve(client);
		});
		ws.on("close", (code) => {
			if (!client.timer)
				fail(new Error(`${name}: сокет закрито до joined, код ${code}`));
		});
	});
}

// ---------- потік-виконавець: тримає свою частину клієнтів ----------
async function runShard() {
	const { wsUrl } = workerData;
	let open = [];
	let lag = null;
	let base = 0;
	const total = () => open.reduce((s, c) => s + c.snapshots, 0);
	parentPort.on("message", async (m) => {
		try {
			if (m.cmd === "open") {
				// партіями: join має встигнути за 5 с, а відро керування обмежене
				for (let i = 0; i < m.clients.length; i += 16) {
					const batch = m.clients
						.slice(i, i + 16)
						.map((c) => connect(wsUrl, c.room, c.name));
					open.push(...(await Promise.all(batch)));
				}
				parentPort.postMessage({ id: m.id, n: open.length });
			} else if (m.cmd === "start") {
				base = total();
				lag = monitorEventLoopDelay({ resolution: 10 });
				lag.enable();
				parentPort.postMessage({ id: m.id });
			} else if (m.cmd === "stop") {
				lag?.disable();
				parentPort.postMessage({
					id: m.id,
					snapshots: total() - base,
					// затримка власного циклу без базових 10 мс опитування
					lagMs: Math.max(0, (lag?.percentile(99) ?? 0) / 1e6 - 10),
				});
			} else if (m.cmd === "close") {
				for (const c of open) {
					clearInterval(c.timer);
					c.ws.terminate();
				}
				open = [];
				parentPort.postMessage({ id: m.id });
			}
		} catch (error) {
			parentPort.postMessage({ id: m.id, error: String(error) });
		}
	});
}

if (!isMainThread) await runShard();

// ---------- головний потік ----------
let nextId = 0;
function call(worker, message) {
	const id = ++nextId;
	return new Promise((resolve, reject) => {
		const onMessage = (reply) => {
			if (reply.id !== id) return;
			worker.off("message", onMessage);
			if (reply.error) reject(new Error(reply.error));
			else resolve(reply);
		};
		worker.on("message", onMessage);
		worker.postMessage({ ...message, id });
	});
}

async function runLevel(workers, clients) {
	const roomCount = Math.ceil(clients / PER_ROOM);
	const rooms = [];
	for (let i = 0; i < roomCount; i++) {
		const { room } = await api("/api/rooms", "POST", {
			name: `lt${clients}-${i}`,
			max: PER_ROOM,
		});
		rooms.push(room.id);
	}
	// кімната цілком в одному потоці: room % кількість потоків
	const parts = workers.map(() => []);
	for (let k = 0; k < clients; k++) {
		const room = Math.floor(k / PER_ROOM);
		parts[room % workers.length].push({ room: rooms[room], name: `c${k}` });
	}
	try {
		await Promise.all(
			workers.map((w, i) => call(w, { cmd: "open", clients: parts[i] })),
		);
		await sleep(3000); // розігрів
		await api("/api/stats"); // скидає вікно циклу подій: далі міряємо лише сам тест
		await Promise.all(workers.map((w) => call(w, { cmd: "start" })));
		await sleep(SECONDS * 1000);
		const reports = await Promise.all(
			workers.map((w) => call(w, { cmd: "stop" })),
		);
		const stats = await api("/api/stats");
		return {
			...summarizeLevel({
				clients,
				stats,
				snapshots: reports.reduce((s, r) => s + r.snapshots, 0),
				seconds: SECONDS,
				generatorLagMs: Math.max(...reports.map((r) => r.lagMs)),
			}),
			shards: workers.length,
		};
	} finally {
		await Promise.all(workers.map((w) => call(w, { cmd: "close" })));
		await sleep(1500); // кімнати спорожніли, матчі зупинилися
	}
}

async function main() {
	const server = await startServer();
	const workers = Array.from(
		{ length: SHARDS },
		() => new Worker(new URL(import.meta.url), { workerData: { wsUrl: WS } }),
	);
	const levels = [];
	try {
		const plan = args.levels.split(",").map(Number);
		const next = () => {
			if (plan.length) return plan.shift();
			if (!args["until-fail"]) return null;
			const last = levels.at(-1);
			if (
				!last ||
				!holds(last) ||
				last.clients * 2 > Number(args["max-clients"])
			)
				return null;
			return last.clients * 2;
		};
		for (let n = next(); n !== null; n = next()) {
			console.log(`рівень ${n} клієнтів, ${SECONDS} с…`);
			const level = await runLevel(
				workers.slice(
					0,
					Math.max(1, Math.min(SHARDS, Math.ceil(n / PER_ROOM))),
				),
				n,
			);
			levels.push(level);
			console.log(
				`  тік p50/p99/max ${level.tickMs.p50}/${level.tickMs.p99}/${level.tickMs.max} мс, цикл ${level.loopUtilization === null ? "–" : Math.round(level.loopUtilization * 100)}%, пропущено ${level.skipped}, ${holds(level) ? "тримає" : "НЕ тримає"}`,
			);
		}
		const result = {
			label: args.label,
			when: new Date().toISOString(),
			perRoom: PER_ROOM,
			seconds: SECONDS,
			shards: SHARDS,
			...capacity(levels),
			levels,
		};
		mkdirSync(OUT, { recursive: true });
		const base = join(OUT, `loadtest-${args.label}`);
		writeFileSync(`${base}.json`, `${JSON.stringify(result, null, "\t")}\n`);
		writeFileSync(`${base}.md`, toMarkdown(args.label, levels));
		writeFileSync(
			`${base}.svg`,
			renderChart(levels, { title: `Навантаження на сервер (${args.label})` }),
		);
		console.log(
			`\n${toMarkdown(args.label, levels)}\nзбережено: ${base}.{json,md,svg}`,
		);
	} finally {
		await Promise.all(workers.map((w) => w.terminate()));
		server?.kill();
	}
}

if (isMainThread) {
	main().catch((error) => {
		console.error(error);
		process.exit(1);
	});
}
