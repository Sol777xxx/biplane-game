// Сценарії збоїв (лаб 8). Кожен перевіряє поведінку сервера, а не клієнтського коду, і завершується
// кодом 1, якщо вимога порушена.
//
//   node perf/chaos.mjs vanish   клієнт зникає посеред матчу (обрив без close-кадру)
//   node perf/chaos.mjs kill     сервер зупиняють: SIGTERM (чемно) і SIGKILL (раптово)
//   node perf/chaos.mjs flood    ~1000 поганих кадрів/с з кількох з'єднань; тік інших кімнат
//   node perf/chaos.mjs all      усі три, результат у docs/chaos/chaos-<label>.{json,md}
//
// За замовчуванням сервер піднімається локально (node server/src/index.ts). Образ Docker:
//   docker run -d --rm --name chaos -p 4182:3000 -e MAX_CONN_PER_IP=100000 -e MAX_ROOMS=1000 biplane-game
//   node perf/chaos.mjs vanish --url http://127.0.0.1:4182   (kill потребує власного процесу)
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { parseArgs } from "node:util";
import { getCodec } from "biplane-shared/codec/index.ts";
import WebSocket from "ws";

const { values: args, positionals } = parseArgs({
	allowPositionals: true,
	options: {
		label: { type: "string", default: "local" },
		port: { type: "string", default: "4182" },
		url: { type: "string" },
		seconds: { type: "string", default: "10" },
		attackers: { type: "string", default: "3" },
		rate: { type: "string", default: "1000" }, // кадрів за секунду з одного атакувальника
	},
});
const SCENARIOS = ["vanish", "kill", "flood"];
const wanted = positionals[0] ?? "all";
const todo = wanted === "all" ? SCENARIOS : [wanted];
if (todo.some((s) => !SCENARIOS.includes(s))) {
	console.error("Використання: node perf/chaos.mjs vanish|kill|flood|all");
	process.exit(2);
}
const SECONDS = Number(args.seconds);
const TICK_BUDGET_MS = 1000 / 30;
const codec = getCodec("binary");

// ---------- спільне ----------
const results = [];
const check = (scenario, name, ok, detail) => {
	results.push({ scenario, name, ok, detail });
	console.log(
		`  ${ok ? "ПРОЙШЛО" : "ПРОВАЛ  "}  ${name}${detail ? `: ${detail}` : ""}`,
	);
};

const skip = (scenario, name, detail) => {
	results.push({ scenario, name, ok: true, skipped: true, detail });
	console.log(`  ПРОПУЩЕНО ${name}: ${detail}`);
};

async function startServer(port = args.port) {
	const logs = [];
	const child = spawn(process.execPath, ["server/src/index.ts"], {
		env: {
			...process.env,
			PORT: port,
			HOST: "127.0.0.1",
			MAX_ROOMS: "1000",
			MAX_CONN_PER_IP: "100000",
			MAX_PLAYERS: "100000",
			LOG_DIR: mkdtempSync(join(tmpdir(), "biplane-chaos-")),
		},
		stdio: ["ignore", "pipe", "inherit"],
	});
	child.stdout.on("data", (d) => logs.push(d.toString()));
	const exited = new Promise((resolve) =>
		child.once("exit", (code, signal) =>
			resolve({ code, signal, at: performance.now() }),
		),
	);
	const base = `http://127.0.0.1:${port}`;
	for (let i = 0; i < 100; i++) {
		try {
			if ((await fetch(`${base}/ready`)).ok)
				return { child, base, exited, logs };
		} catch {}
		await sleep(100);
	}
	child.kill("SIGKILL");
	throw new Error("сервер не піднявся");
}

const api = async (base, path, method = "GET", body) => {
	const res = await fetch(`${base}${path}`, {
		method,
		headers: { "content-type": "application/json" },
		body: body === undefined ? undefined : JSON.stringify(body),
	});
	if (!res.ok)
		throw new Error(`${method} ${path}: ${res.status} ${await res.text()}`);
	return res.json();
};

const newRoom = async (base, name, max = 8) =>
	(await api(base, "/api/rooms", "POST", { name, max })).room.id;

// Гравець: join, потім input 30/с, як справжній клієнт. Усе, що прийшло, лишається в полях.
function player(base, room, name) {
	const wsUrl = `${base.replace(/^http/, "ws")}/ws?codec=binary`;
	return new Promise((resolve, reject) => {
		const ws = new WebSocket(wsUrl);
		const p = { ws, name, snapshots: 0, types: [], close: null, timer: null };
		ws.once("error", reject);
		ws.on("open", () =>
			ws.send(JSON.stringify({ v: 1, type: "join", room, name })),
		);
		ws.on("message", (data, isBinary) => {
			if (isBinary) {
				p.snapshots++;
				return;
			}
			const msg = JSON.parse(data.toString());
			p.types.push(msg.type);
			if (msg.type === "error") reject(new Error(`${name}: ${msg.message}`));
			if (msg.type !== "joined") return;
			let seq = 0;
			p.timer = setInterval(() => {
				if (ws.readyState === WebSocket.OPEN) {
					ws.send(
						codec.encodeInput(++seq, {
							up: false,
							down: false,
							left: false,
							right: true,
							fire: true,
						}),
					);
				}
			}, 1000 / 30);
			resolve(p);
		});
		ws.on("close", (code, reason) => {
			clearInterval(p.timer);
			p.close = { code, reason: reason.toString(), at: performance.now() };
		});
	});
}

const roomPlayers = async (base, id) => {
	const { rooms } = await api(base, "/api/rooms");
	return rooms.find((r) => r.id === id)?.players ?? null;
};

const waitUntil = async (fn, ms, step = 50) => {
	const end = performance.now() + ms;
	for (;;) {
		const v = await fn();
		if (v) return performance.now();
		if (performance.now() > end) return null;
		await sleep(step);
	}
};

// ---------- 1. клієнт зникає посеред матчу ----------
async function vanish() {
	console.log("\n[vanish] клієнт зникає посеред матчу");
	const srv = args.url
		? { base: args.url.replace(/\/$/, "") }
		: await startServer();
	try {
		const room = await newRoom(srv.base, `vanish-${Date.now()}`);
		const [a, b, c] = await Promise.all(
			["A", "B", "C"].map((n) => player(srv.base, room, n)),
		);
		await sleep(1500);
		check(
			"vanish",
			"у кімнаті 3 гравці",
			(await roomPlayers(srv.base, room)) === 3,
		);

		const before = b.snapshots;
		const t0 = performance.now();
		a.ws.terminate(); // TCP обривається без close-кадру: так зникає закритий ноутбук чи вимкнений Wi-Fi
		const gone = await waitUntil(
			async () => (await roomPlayers(srv.base, room)) === 2,
			5000,
		);
		check(
			"vanish",
			"сервер прибирає зниклого гравця з кімнати",
			gone !== null,
			gone ? `за ${Math.round(gone - t0)} мс` : "не прибрав за 5 с",
		);

		await sleep(1500);
		check(
			"vanish",
			"решта гравців далі отримують знімки",
			b.snapshots - before > 30 && c.snapshots > 30,
			`B +${b.snapshots - before} знімків`,
		);
		check(
			"vanish",
			"решта гравців дізналася про вихід (roster)",
			b.types.filter((t) => t === "roster").length >= 2,
		);
		check(
			"vanish",
			"сокети решти відкриті",
			b.ws.readyState === WebSocket.OPEN && c.ws.readyState === WebSocket.OPEN,
		);

		// той самий гравець повертається під тим самим іменем: старе місце не має його блокувати
		const again = await player(srv.base, room, "A").then(
			(p) => p,
			(e) => e,
		);
		check(
			"vanish",
			"зниклий може повернутися під тим самим іменем",
			!(again instanceof Error),
			again instanceof Error ? again.message : "",
		);
		for (const p of [a, b, c, again]) if (p.ws) p.ws.terminate();
	} finally {
		if (srv.child) {
			srv.child.kill("SIGTERM");
			await srv.exited;
		}
	}
}

// ---------- 2. сервер зупиняють ----------
async function kill() {
	console.log("\n[kill] сервер зупиняють");
	if (args.url) {
		console.log(
			"  пропущено: сценарій керує власним процесом сервера, --url не підходить",
		);
		return;
	}
	for (const signal of ["SIGTERM", "SIGKILL"]) {
		if (signal === "SIGTERM" && process.platform === "win32") {
			// у Windows kill("SIGTERM") це негайне вбивство процесу, чемної зупинки там не буває
			skip(
				"kill",
				"SIGTERM: чемна зупинка",
				"Windows не вміє SIGTERM; перевіряє `npm run docker:verify` (docker stop) і CI на Linux",
			);
			continue;
		}
		const srv = await startServer();
		const rooms = await Promise.all(
			[0, 1].map((i) => newRoom(srv.base, `kill-${signal}-${i}`)),
		);
		const players = await Promise.all(
			rooms.flatMap((r, i) =>
				[0, 1, 2].map((k) => player(srv.base, r, `p${i}${k}`)),
			),
		);
		await sleep(1500);
		const t0 = performance.now();
		srv.child.kill(signal);
		const exit = await srv.exited;
		await sleep(300);
		const closed = players.filter((p) => p.close);
		const lastClose = Math.max(...closed.map((p) => p.close.at - t0));
		if (signal === "SIGTERM") {
			check(
				"kill",
				"SIGTERM: сервер вийшов із кодом 0",
				exit.code === 0,
				`код ${exit.code}, ${Math.round(exit.at - t0)} мс`,
			);
			check("kill", "SIGTERM: вийшов швидше за 10 с", exit.at - t0 < 10_000);
			check(
				"kill",
				"SIGTERM: усі 6 клієнтів отримали shutdown",
				players.every((p) => p.types.includes("shutdown")),
				`${players.filter((p) => p.types.includes("shutdown")).length}/6`,
			);
			check(
				"kill",
				"SIGTERM: усі сокети закрито з кодом 1001",
				closed.length === 6 && closed.every((p) => p.close.code === 1001),
				`коди ${[...new Set(closed.map((p) => p.close.code))].join(",")}, останній через ${Math.round(lastClose)} мс`,
			);
			const log = srv.logs.join("");
			check(
				"kill",
				"SIGTERM: логи скинуто, є запис «зупинено»",
				log.includes("зупинено"),
			);
			const lines = log.split("\n").filter(Boolean);
			check(
				"kill",
				"SIGTERM: усі рядки логу це JSON",
				lines.every((l) => {
					try {
						JSON.parse(l);
						return true;
					} catch {
						return false;
					}
				}),
				`${lines.length} рядків`,
			);
		} else {
			check(
				"kill",
				"SIGKILL: усі клієнти помітили обрив",
				closed.length === 6,
				`${closed.length}/6 сокетів закрито, коди ${[...new Set(closed.map((p) => p.close.code))].join(",")}`,
			);
			// після такого обриву клієнт пробує перепідключитися; сервера немає, тож порт відмовляє
			const refused = await fetch(`${srv.base}/health`, {
				signal: AbortSignal.timeout(2000),
			}).then(
				() => false,
				() => true,
			);
			check(
				"kill",
				"SIGKILL: нових з'єднань сервер не приймає (клієнт піде в лобі)",
				refused,
			);
		}
	}
}

// ---------- 3. ~1000 поганих кадрів за секунду ----------
// Атакувальник входить у свою кімнату й шле кадри з заданою швидкістю; щойно сервер його закриває,
// з'єднується заново. Так навантаження на розбір кадрів тримається всі SECONDS секунд.
function attacker(base, room, mode, rate, stopSignal, tally) {
	const wsUrl = `${base.replace(/^http/, "ws")}/ws?codec=binary`;
	const bad = {
		garbage: () => "not json{{{",
		spam: () => JSON.stringify({ v: 1, type: "ping", t: 1 }),
	}[mode];
	return (async () => {
		while (!stopSignal.stop) {
			await new Promise((done) => {
				const ws = new WebSocket(wsUrl);
				const opened = performance.now();
				let sent = 0;
				let timer = null;
				ws.on("open", () => {
					ws.send(
						JSON.stringify({
							v: 1,
							type: "join",
							room,
							name: `atk${Math.random().toString(36).slice(2, 7)}`,
						}),
					);
					const batch = Math.max(1, Math.round(rate / 100));
					timer = setInterval(() => {
						for (
							let i = 0;
							i < batch && ws.readyState === WebSocket.OPEN;
							i++
						) {
							ws.send(bad());
							sent++;
						}
					}, 10);
				});
				ws.on("error", () => {});
				ws.on("close", (code) => {
					clearInterval(timer);
					tally.connections++;
					tally.frames += sent;
					tally.codes[code] = (tally.codes[code] ?? 0) + 1;
					tally.lifeMs.push(performance.now() - opened);
					done();
				});
				setTimeout(() => ws.terminate(), 5000);
			});
			await sleep(20);
		}
	})();
}

const victimWindow = async (base, victimRooms, victims) => {
	await api(base, "/api/stats"); // скидає вікно циклу подій
	const s0 = victims.map((p) => p.snapshots);
	await sleep(SECONDS * 1000);
	const stats = await api(base, "/api/stats");
	const mine = stats.rooms.filter((r) => victimRooms.includes(r.id));
	const max = (xs) => xs.reduce((a, b) => Math.max(a, b), 0);
	return {
		rooms: mine.length,
		tickP99: max(mine.map((r) => r.tickMs.p99)),
		tickMax: max(mine.map((r) => r.tickMs.max)),
		lateP99: max(mine.map((r) => r.lateMs.p99)),
		skipped: mine.reduce((s, r) => s + r.skipped, 0),
		loopUtilization: stats.eventLoop?.utilization ?? null,
		loopDelayP99: stats.eventLoop?.delayMs.p99 ?? null,
		snapshotsPerClientPerSec:
			Math.round(
				(victims.reduce((s, p, i) => s + p.snapshots - s0[i], 0) /
					victims.length /
					SECONDS) *
					10,
			) / 10,
	};
};

async function flood() {
	console.log("\n[flood] поганий трафік з кількох з'єднань");
	const srv = args.url
		? { base: args.url.replace(/\/$/, "") }
		: await startServer();
	const attackers = Number(args.attackers);
	const rate = Number(args.rate);
	try {
		const victimRooms = await Promise.all(
			[0, 1, 2, 3].map((i) => newRoom(srv.base, `victims-${i}-${Date.now()}`)),
		);
		const victims = await Promise.all(
			victimRooms.flatMap((r, i) =>
				Array.from({ length: 8 }, (_, k) => player(srv.base, r, `v${i}${k}`)),
			),
		);
		// порожні кімнати сервер прибирає, тож у кімнаті атакувальників тримаємо звичайного гравця
		const atkRoom = await newRoom(srv.base, `attack-${Date.now()}`, 16);
		const keeper = await player(srv.base, atkRoom, "keeper");
		await sleep(3000);

		const base = await victimWindow(srv.base, victimRooms, victims);
		console.log(
			`  без атаки: тік p99 ${base.tickP99} мс, пропущено ${base.skipped}, цикл ${base.loopUtilization}`,
		);

		const stopSignal = { stop: false };
		const tally = { connections: 0, frames: 0, codes: {}, lifeMs: [] };
		const runs = Array.from({ length: attackers }, (_, i) =>
			attacker(
				srv.base,
				atkRoom,
				i % 2 ? "spam" : "garbage",
				rate,
				stopSignal,
				tally,
			),
		);
		await sleep(1000);
		const under = await victimWindow(srv.base, victimRooms, victims);
		stopSignal.stop = true;
		await Promise.all(runs);
		const seconds = SECONDS + 1;
		const fps = Math.round(tally.frames / seconds);
		console.log(
			`  під атакою: тік p99 ${under.tickP99} мс, пропущено ${under.skipped}, цикл ${under.loopUtilization}`,
		);
		console.log(
			`  атакувальники: ${tally.connections} з'єднань, ${tally.frames} кадрів (${fps}/с), коди закриття ${JSON.stringify(tally.codes)}`,
		);

		const protocolCodes = Object.keys(tally.codes).filter(
			(c) => c >= 4000 && c <= 4009,
		);
		const closedByServer = protocolCodes.reduce(
			(s, c) => s + tally.codes[c],
			0,
		);
		const medianLife =
			[...tally.lifeMs].sort((a, b) => a - b)[
				Math.floor(tally.lifeMs.length / 2)
			] ?? 0;
		check(
			"flood",
			`атакувальники шлють ≥ ${Math.round(rate * attackers * 0.2)} кадрів/с`,
			fps >= rate * attackers * 0.2,
			`${fps} кадрів/с з ${attackers} з'єднань`,
		);
		check(
			"flood",
			"сервер закриває порушників кодом 4000-4009",
			closedByServer >= tally.connections * 0.9,
			`${closedByServer}/${tally.connections}, медіана життя ${Math.round(medianLife)} мс`,
		);
		check(
			"flood",
			"тік інших кімнат у межах бюджету 33,3 мс",
			under.tickP99 <= TICK_BUDGET_MS,
			`p99 ${under.tickP99} мс (без атаки ${base.tickP99} мс)`,
		);
		check(
			"flood",
			"інші кімнати не пропускають тіки",
			under.skipped <= base.skipped + 2,
			`${under.skipped} проти ${base.skipped} без атаки`,
		);
		check(
			"flood",
			"гравці в інших кімнатах не відключені",
			victims.every((p) => p.ws.readyState === WebSocket.OPEN),
		);
		check(
			"flood",
			"знімки в інших кімнатах не просіли",
			under.snapshotsPerClientPerSec >= base.snapshotsPerClientPerSec * 0.9,
			`${under.snapshotsPerClientPerSec}/с проти ${base.snapshotsPerClientPerSec}/с`,
		);
		results.push({
			scenario: "flood",
			name: "_data",
			ok: true,
			data: {
				base,
				under,
				attackers,
				rate,
				framesPerSec: fps,
				tally: {
					...tally,
					lifeMs: undefined,
					medianLifeMs: Math.round(medianLife),
				},
			},
		});
		for (const p of [...victims, keeper]) p.ws.terminate();
	} finally {
		if (srv.child) {
			srv.child.kill("SIGTERM");
			await srv.exited;
		}
	}
}

// ---------- запуск і звіт ----------
const run = { vanish, kill, flood };
for (const name of todo) await run[name]();

const checks = results.filter((r) => r.name !== "_data");
const failed = checks.filter((r) => !r.ok);
const skipped = checks.filter((r) => r.skipped);
const dir = "docs/chaos";
mkdirSync(dir, { recursive: true });
const out = join(dir, `chaos-${args.label}`);
const md = [
	`# Збої: ${args.label}`,
	"",
	`Запущено ${new Date().toISOString()}, Node ${process.version}, сценарії: ${todo.join(", ")}.`,
	"",
	"| Сценарій | Перевірка | Результат | Деталі |",
	"|---|---|---|---|",
	...checks.map(
		(r) =>
			`| ${r.scenario} | ${r.name} | ${r.skipped ? "пропущено" : r.ok ? "пройшло" : "**провал**"} | ${r.detail ?? ""} |`,
	),
	"",
].join("\n");
writeFileSync(
	`${out}.json`,
	`${JSON.stringify({ label: args.label, when: new Date().toISOString(), node: process.version, results }, null, "\t")}\n`,
);
writeFileSync(`${out}.md`, md);
console.log(
	`\n${checks.length - failed.length - skipped.length}/${checks.length - skipped.length} перевірок пройшло${skipped.length ? `, пропущено ${skipped.length}` : ""}. Збережено: ${out}.{json,md}`,
);
process.exit(failed.length ? 1 : 0);
