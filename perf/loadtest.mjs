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
	},
});
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
function connect(room, name) {
	return new Promise((resolve, reject) => {
		const ws = new WebSocket(WS);
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

async function runLevel(clients) {
	const roomCount = Math.ceil(clients / PER_ROOM);
	const rooms = [];
	for (let i = 0; i < roomCount; i++) {
		const { room } = await api("/api/rooms", "POST", {
			name: `lt${clients}-${i}`,
			max: PER_ROOM,
		});
		rooms.push(room.id);
	}
	const open = [];
	try {
		// заходимо партіями: join має встигнути за 5 с, а відро керування обмежене
		for (let i = 0; i < clients; i += 16) {
			const batch = [];
			for (let k = i; k < Math.min(clients, i + 16); k++) {
				batch.push(connect(rooms[Math.floor(k / PER_ROOM)], `c${k}`));
			}
			open.push(...(await Promise.all(batch)));
		}
		await sleep(3000); // розігрів
		await api("/api/stats"); // скидає вікно циклу подій: далі міряємо лише сам тест
		const base = open.reduce((s, c) => s + c.snapshots, 0);
		const lag = monitorEventLoopDelay({ resolution: 10 });
		lag.enable();
		await sleep(SECONDS * 1000);
		lag.disable();
		const stats = await api("/api/stats");
		const snapshots = open.reduce((s, c) => s + c.snapshots, 0) - base;
		return summarizeLevel({
			clients,
			stats,
			snapshots,
			seconds: SECONDS,
			// затримка власного циклу генератора без базових 10 мс опитування
			generatorLagMs: Math.max(0, lag.percentile(99) / 1e6 - 10),
		});
	} finally {
		for (const c of open) {
			clearInterval(c.timer);
			c.ws.terminate();
		}
		await sleep(1500); // кімнати спорожніли, матчі зупинилися
	}
}

async function main() {
	const server = await startServer();
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
			const level = await runLevel(n);
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
			...capacity(levels),
			levels,
		};
		mkdirSync(OUT, { recursive: true });
		const base = join(OUT, `loadtest-${args.label}`);
		writeFileSync(`${base}.json`, `${JSON.stringify(result, null, "\t")}\n`);
		writeFileSync(`${base}.md`, toMarkdown(args.label, levels));
		writeFileSync(
			`${base}.svg`,
			renderChart(levels, {
				title: `Тік сервера під навантаженням (${args.label})`,
			}),
		);
		console.log(
			`\n${toMarkdown(args.label, levels)}\nзбережено: ${base}.{json,md,svg}`,
		);
	} finally {
		server?.kill();
	}
}

main().catch((error) => {
	console.error(error);
	process.exit(1);
});
