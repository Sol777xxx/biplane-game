// npm run dogfight -w client -- --lag 100 --jitter 30 --loss 2 --interp 100 --seconds 10
// Сервер у процесі й боти на справжньому клієнтському коді. Параметри: lag, jitter, loss, interp,
// smooth (мс), seconds (вимірювання), warmup (розігрів), bots, binary (1 бінарний, 0 JSON).
import { tmpdir } from "node:os";
import { setTimeout as sleep } from "node:timers/promises";
import { pathToFileURL } from "node:url";
import { ARENA, wrapDelta } from "biplane-shared/sim/arena.ts";
import { scriptedInput } from "biplane-shared/sim/scenario.js";
import { TICK_DT } from "biplane-shared/sim/time.ts";
import { createApp } from "../../server/src/app.js";
import { silentLogger } from "../../server/src/logger.js";
import { RoomManager } from "../../server/src/rooms.js";
import { createInterpolator } from "../src/net/interpolator.js";
import { createPredictor } from "../src/net/predictor.js";
import { joinRoom } from "../src/net/roomSession.js";
import { createSnapshotView } from "../src/net/snapshotView.js";
import { summarize } from "../src/netStats.js";

export const DEFAULTS = {
	lag: 100,
	jitter: 30,
	loss: 2,
	interp: 100,
	smooth: 100,
	seconds: 10,
	warmup: 2,
	bots: 2,
	binary: 1,
};

// Бот: клієнтський стек без DOM. Метрики збираються лише після розігріву.
async function createBot({
	url,
	room,
	name,
	index,
	interp,
	smooth,
	warmup,
	binary,
}) {
	const session = await joinRoom(url, {
		room,
		name,
		codec: binary ? "binary" : "json",
	});
	const predictor = createPredictor({ smooth: smooth / 1000 });
	const interpolator = createInterpolator({ delay: interp });
	const view = createSnapshotView({
		you: () => session.you.id,
		local: () => predictor.pose,
		interp: interpolator,
		shots: () => predictor.shots,
	});

	const m = {
		corr: [],
		intervals: [],
		rtt: [],
		unacked: [],
		steps: [],
		snaps: 0,
		frames: 0,
		starved: 0,
		fast: 0,
		stalls: 0,
	};
	let recording = false;
	let t0 = 0;
	let traffic0 = session.traffic;
	let lastSnap = null;
	const prev = new Map(); // id чужого корабля -> позиція в попередньому кадрі

	// лічимо кадри й голод, не змінюючи поведінку інтерполятора
	const sample = interpolator.sample.bind(interpolator);
	interpolator.sample = (now) => {
		const s = sample(now);
		if (recording) {
			m.frames++;
			if (s.starved) m.starved++;
		}
		return s;
	};

	session.addEventListener("snapshot", (e) => {
		const now = performance.now();
		if (recording) {
			m.snaps++;
			if (lastSnap !== null) m.intervals.push(now - lastSnap);
		}
		lastSnap = now;
		view.apply(e.detail);
		const r = predictor.reconcile(e.detail, session.you.id);
		if (recording && !r.reset && r.correction !== null)
			m.corr.push(r.correction);
	});
	session.addEventListener("pong", (e) => {
		if (recording) m.rtt.push(e.detail.rtt);
	});

	let tick = 0;
	const timers = [
		// input 30/с за детермінованим сценарієм
		setInterval(() => {
			const keys = scriptedInput(tick++ + index * 37);
			const seq = session.sendInput(keys);
			if (seq) predictor.step(seq, keys);
			predictor.tick(TICK_DT);
		}, 1000 / 30),
		setInterval(() => session.ping(), 500),
		// «кадр» 60 Гц: чужі сутності на момент now − delay, потім міряємо рух чужого корабля
		setInterval(() => {
			view.update(performance.now());
			if (!recording) return;
			m.unacked.push(Math.max(0, session.lastSeq - view.ack));
			for (const s of view.world.ofKind("biplane")) {
				if (s.mine) continue;
				const p = prev.get(s.id);
				if (p) {
					const moved = Math.hypot(
						wrapDelta(p.x, s.pos.x, ARENA.width),
						wrapDelta(p.y, s.pos.y, ARENA.height),
					);
					// телепорт (відродження) не рахуємо; стоїть = швидкий корабель без руху
					if (moved < 200 && Math.hypot(s.vel.x, s.vel.y) > 100) {
						m.fast++;
						m.steps.push(moved);
						if (moved < 0.05) m.stalls++;
					}
				}
				prev.set(s.id, { x: s.pos.x, y: s.pos.y });
			}
		}, 16),
	];
	const starter = setTimeout(() => {
		recording = true;
		t0 = performance.now();
		traffic0 = session.traffic;
	}, warmup * 1000);

	return {
		report() {
			const sec = (performance.now() - t0) / 1000;
			const tr = session.traffic;
			return {
				name,
				rtt: summarize(m.rtt),
				snapsPerSec: m.snaps / sec,
				interval: summarize(m.intervals),
				starvedPct: (100 * m.starved) / Math.max(1, m.frames),
				corr: summarize(m.corr),
				bigPct:
					(100 * m.corr.filter((c) => c > 1).length) /
					Math.max(1, m.corr.length),
				unacked: summarize(m.unacked),
				stallPct: (100 * m.stalls) / Math.max(1, m.fast),
				stepP95: summarize(m.steps).p95,
				downKBs: (tr.bytesIn - traffic0.bytesIn) / 1024 / sec,
				upKBs: (tr.bytesOut - traffic0.bytesOut) / 1024 / sec,
			};
		},
		stop() {
			clearTimeout(starter);
			for (const t of timers) clearInterval(t);
			session.leave();
		},
	};
}

export async function runDogfight(options = {}) {
	const o = { ...DEFAULTS, ...options };
	const rooms = new RoomManager();
	const room = rooms.create({ name: "Dogfight", max: 8, permanent: true });
	const config = {
		port: 0,
		host: "127.0.0.1",
		clientDir: tmpdir(),
		logDir: tmpdir(),
		enableNetsim: true,
	};
	const app = createApp(config, {
		rooms,
		log: silentLogger,
		matchLog: false,
		game: true,
	});
	const { port } = await app.listen();
	const url = `ws://127.0.0.1:${port}/ws?lag=${o.lag}&jitter=${o.jitter}&loss=${o.loss}`;
	const bots = [];
	try {
		for (let i = 0; i < o.bots; i++) {
			bots.push(
				await createBot({
					url,
					room: room.id,
					name: `bot${i}`,
					index: i,
					...o,
				}),
			);
		}
		await sleep((o.warmup + o.seconds) * 1000);
		return {
			options: o,
			bots: bots.map((b) => b.report()),
			server: app.matches.stats().find((s) => s.id === room.id),
		};
	} finally {
		for (const b of bots) b.stop();
		await app.close();
	}
}

const f = (v) => Math.round(v * 10) / 10;

export function printReport(r) {
	const o = r.options;
	console.log(
		`lag ${o.lag} ± ${o.jitter} мс, втрати ${o.loss}%, інтерполяція ${o.interp} мс, згладжування ${o.smooth} мс, кодек ${o.binary ? "binary" : "json"}, ${o.seconds} с`,
	);
	console.table(
		r.bots.map((b) => ({
			бот: b.name,
			"RTT сер.": f(b.rtt.mean),
			"RTT макс": f(b.rtt.max),
			"знімків/с": f(b.snapsPerSec),
			"інтервал p95": f(b.interval.p95),
			"інтервал макс": f(b.interval.max),
			"голод %": f(b.starvedPct),
			"поправка сер.": b.corr.mean,
			"поправка p95": b.corr.p95,
			"поправка макс": b.corr.max,
			"поправок >1px %": f(b.bigPct),
			"без ack сер.": f(b.unacked.mean),
			"стоїть %": f(b.stallPct),
			"крок p95 px": b.stepP95,
			"↓ КБ/с": f(b.downKBs),
			"↑ КБ/с": f(b.upKBs),
		})),
	);
	const s = r.server;
	console.log(
		`сервер: тіків ${s.ticks}, пропущено ${s.skipped}, довгих ${s.overruns}, тік макс ${s.tickMs.max} мс, input повторено ${s.inputs.repeated}, відкинуто ${s.inputs.dropped}`,
	);
}

function parseArgs(argv) {
	const out = {};
	for (let i = 0; i < argv.length; i += 2) {
		const key = argv[i]?.replace(/^--/, "");
		const value = Number(argv[i + 1]);
		if (!(key in DEFAULTS) || !Number.isFinite(value)) {
			throw new Error(
				`використання: --${Object.keys(DEFAULTS).join(" N --")} N (отримано "${argv[i]} ${argv[i + 1]}")`,
			);
		}
		out[key] = value;
	}
	return out;
}

if (
	process.argv[1] &&
	import.meta.url === pathToFileURL(process.argv[1]).href
) {
	try {
		printReport(await runDogfight(parseArgs(process.argv.slice(2))));
	} catch (error) {
		console.error(error.message);
		process.exitCode = 1;
	}
}
