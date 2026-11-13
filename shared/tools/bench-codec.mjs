// node shared/tools/bench-codec.mjs [--players 4 --ticks 1800 --warmup 120 --seed 1 --rounds 7 --passes 10 --out файл.md]
// JSON проти binary на знімках справжньої гри: розмір, трафік, час encode/decode.
import { writeFileSync } from "node:fs";
import os from "node:os";
import { pathToFileURL } from "node:url";
import { binary } from "../codec/binary.js";
import { json } from "../codec/json.js";
import { make } from "../protocol/index.js";
import { createScenario, scriptedInput } from "../sim/scenario.js";
import { eventToWire, takeSnapshot } from "../sim/snapshot.js";
import { TICK_RATE } from "../sim/time.js";

export const DEFAULTS = {
	players: 4,
	ticks: 1800,
	warmup: 120,
	seed: 1,
	rounds: 7,
	passes: 10,
};
const CODECS = { json, binary };
const LABELS = { json: "JSON", binary: "Binary (`DataView`)" };
const BUS_EVENTS = [
	"fired",
	"hit",
	"exploded",
	"scored",
	"pickup",
	"crash",
	"respawned",
];
const MAX_EVENTS = 64; // як у Match
const encoder = new TextEncoder();

const byteSize = (data) =>
	typeof data === "string" ? encoder.encode(data).length : data.byteLength;

function summary(values) {
	const xs = [...values].sort((a, b) => a - b);
	const n = xs.length;
	return {
		n,
		mean: xs.reduce((a, b) => a + b, 0) / n,
		min: xs[0],
		max: xs[n - 1],
		p95: xs[Math.min(n - 1, Math.ceil(0.95 * n) - 1)],
	};
}

function median(values) {
	const xs = [...values].sort((a, b) => a - b);
	const m = xs.length >> 1;
	return xs.length % 2 ? xs[m] : (xs[m - 1] + xs[m]) / 2;
}

// ---------- дані ----------
// знімки в тому ж вигляді, що йдуть кодеку на сервері (ack = tick)
export function collectSnapshots({
	players = DEFAULTS.players,
	ticks = DEFAULTS.ticks,
	warmup = DEFAULTS.warmup,
	seed = DEFAULTS.seed,
} = {}) {
	const sc = createScenario({ seed, players });
	const events = [];
	for (const type of BUS_EVENTS) {
		sc.game.world.bus.addEventListener(type, (e) => {
			const wire = eventToWire(type, e.detail);
			if (wire) events.push(wire);
		});
	}
	const out = [];
	for (let i = 0; i < warmup + ticks; i++) {
		sc.step();
		const evs = events.splice(0).slice(0, MAX_EVENTS);
		if (i < warmup) continue;
		out.push(
			make("snapshot", {
				...takeSnapshot(sc.game),
				events: evs,
				ack: sc.game.tick,
			}),
		);
	}
	return out;
}

// input із тим самим сценарієм клавіш; seq росте, як у справжній грі
export function collectInputs(ticks = DEFAULTS.ticks) {
	return Array.from({ length: ticks }, (_, i) => ({
		seq: i + 1,
		keys: scriptedInput(i),
	}));
}

export function averageCounts(snapshots) {
	const keys = ["ships", "obstacles", "bullets", "pickups", "events"];
	return Object.fromEntries(
		keys.map((k) => [
			k,
			snapshots.reduce((n, m) => n + m[k].length, 0) / snapshots.length,
		]),
	);
}

// ---------- розміри ----------
export function measureSizes(snapshots, inputs, codecs = CODECS) {
	const out = {};
	for (const [name, codec] of Object.entries(codecs)) {
		const snap = summary(
			snapshots.map((m) => byteSize(codec.encodeSnapshot(m))),
		);
		const inp = summary(
			inputs.map((i) => byteSize(codec.encodeInput(i.seq, i.keys))),
		);
		out[name] = {
			snapshot: snap,
			input: inp,
			downKBs: (snap.mean * TICK_RATE) / 1024,
			upKBs: (inp.mean * TICK_RATE) / 1024,
		};
	}
	return out;
}

// ---------- час ----------
let sink = 0; // результати операцій: V8 не викине роботу
export const sinkValue = () => sink;

// µs на елемент: медіана раундів; перший прохід це розігрів JIT
function bench(op, items, { rounds, passes }) {
	const once = () => {
		const t = performance.now();
		for (let p = 0; p < passes; p++) {
			for (const item of items) sink += op(item);
		}
		return ((performance.now() - t) * 1000) / (passes * items.length);
	};
	once();
	return median(Array.from({ length: rounds }, once));
}

export function measureTime(
	codec,
	snapshots,
	inputs,
	{ rounds = DEFAULTS.rounds, passes = DEFAULTS.passes } = {},
) {
	const o = { rounds, passes };
	const encSnaps = snapshots.map((m) => codec.encodeSnapshot(m));
	const encInputs = inputs.map((i) => codec.encodeInput(i.seq, i.keys));
	return {
		snapshot: {
			encode: bench((m) => byteSize(codec.encodeSnapshot(m)), snapshots, o),
			decode: bench((d) => codec.decodeSnapshot(d).tick, encSnaps, o),
			both: bench(
				(m) => codec.decodeSnapshot(codec.encodeSnapshot(m)).tick,
				snapshots,
				o,
			),
		},
		input: {
			encode: bench(
				(i) => byteSize(codec.encodeInput(i.seq, i.keys)),
				inputs,
				o,
			),
			decode: bench((d) => codec.decodeInput(d).seq, encInputs, o),
			both: bench(
				(i) => codec.decodeInput(codec.encodeInput(i.seq, i.keys)).seq,
				inputs,
				o,
			),
		},
	};
}

// ---------- запуск і звіт ----------
function check(o) {
	const int = (v, min, max) => Number.isInteger(v) && v >= min && v <= max;
	if (!int(o.players, 1, 8)) throw new RangeError("players: ціле 1–8");
	if (!int(o.ticks, 1, 1e6)) throw new RangeError("ticks: ціле ≥ 1");
	if (!int(o.warmup, 0, 1e6)) throw new RangeError("warmup: ціле ≥ 0");
	if (!int(o.seed, 0, 0xffffffff)) throw new RangeError("seed: ціле 0–2³²−1");
	if (!int(o.rounds, 1, 1000)) throw new RangeError("rounds: ціле ≥ 1");
	if (!int(o.passes, 1, 1000)) throw new RangeError("passes: ціле ≥ 1");
}

export function runBench(options = {}) {
	const o = { ...DEFAULTS, ...options };
	check(o);
	const snapshots = collectSnapshots(o);
	const inputs = collectInputs(o.ticks);
	const times = {};
	for (const [name, codec] of Object.entries(CODECS)) {
		times[name] = measureTime(codec, snapshots, inputs, o);
	}
	return {
		options: o,
		env: {
			node: process.version,
			platform: `${os.platform()} ${os.arch()}`,
			cpu: os.cpus()[0]?.model ?? "?",
		},
		counts: averageCounts(snapshots),
		sizes: measureSizes(snapshots, inputs),
		times,
	};
}

const fmt = (v, digits) => v.toFixed(digits);

export function toMarkdown(r) {
	const { options: o, env, counts: c, sizes, times } = r;
	const keys = ["json", "binary"];
	const main = keys.map(
		(k) =>
			`| ${LABELS[k]} | ${Math.round(sizes[k].snapshot.mean)} | ${fmt(sizes[k].downKBs, 2)} | ${fmt(sizes[k].upKBs, 2)} | ${fmt(times[k].snapshot.both, 1)} |`,
	);
	const detail = keys.map(
		(k) =>
			`| ${LABELS[k]} | ${sizes[k].snapshot.min} | ${Math.round(sizes[k].snapshot.p95)} | ${sizes[k].snapshot.max} | ${fmt(times[k].snapshot.encode, 1)} | ${fmt(times[k].snapshot.decode, 1)} | ${Math.round(sizes[k].input.mean)} | ${fmt(times[k].input.both, 2)} |`,
	);
	const snapRatio = sizes.json.snapshot.mean / sizes.binary.snapshot.mean;
	const inputRatio = sizes.json.input.mean / sizes.binary.input.mean;
	return [
		"## JSON проти binary",
		"",
		`${o.players} гравців, ${TICK_RATE} Гц, ${o.ticks} тіків після розігріву ${o.warmup}, seed ${o.seed}. У середньому в знімку: кораблів ${fmt(c.ships, 1)}, хмарок ${fmt(c.obstacles, 1)}, куль ${fmt(c.bullets, 1)}, бонусів ${fmt(c.pickups, 1)}, подій ${fmt(c.events, 1)}.`,
		"",
		"| Codec | Bytes/snapshot | KB/s per client (down) | KB/s per client (up) | Encode+decode µs |",
		"|---|---:|---:|---:|---:|",
		...main,
		"",
		`Знімок у binary менший у ${fmt(snapRatio, 1)} раза, input у ${fmt(inputRatio, 1)} раза.`,
		"",
		"| Codec | Знімок мін, байт | p95 | макс | encode, µs | decode, µs | Input, байт | Input encode+decode, µs |",
		"|---|---:|---:|---:|---:|---:|---:|---:|",
		...detail,
		"",
		"Примітки:",
		"- Розмір це корисне навантаження кадру без заголовків WebSocket (вниз 2–4 байти, вгору 6–8) і TCP; netgraph рахує так само.",
		`- KB/s = байт × ${TICK_RATE} / 1024; вгору це input ${TICK_RATE} разів на секунду.`,
		`- Час: медіана з ${o.rounds} раундів по ${o.passes} проходів усіх знімків (перший прохід це розігрів), один потік.`,
		"- У сценарії гравці стріляють приблизно половину часу; у реальній грі куль зазвичай менше.",
		`- Середовище: Node ${env.node}, ${env.platform}, ${env.cpu}.`,
	].join("\n");
}

export function parseArgs(argv) {
	const out = {};
	for (let i = 0; i < argv.length; i += 2) {
		const key = argv[i]?.replace(/^--/, "");
		const value = argv[i + 1];
		if (key === "out" && value) {
			out.out = value;
			continue;
		}
		const n = Number(value);
		if (!Object.hasOwn(DEFAULTS, key) || !Number.isFinite(n)) {
			throw new Error(
				`використання: --${Object.keys(DEFAULTS).join(" N --")} N --out файл (отримано "${argv[i]} ${value}")`,
			);
		}
		out[key] = n;
	}
	return out;
}

if (
	process.argv[1] &&
	import.meta.url === pathToFileURL(process.argv[1]).href
) {
	try {
		const { out, ...options } = parseArgs(process.argv.slice(2));
		const md = toMarkdown(runBench(options));
		console.log(md);
		if (out) {
			writeFileSync(out, `${md}\n`);
			console.log(`\nзаписано ${out}`);
		}
	} catch (error) {
		console.error(error.message);
		process.exitCode = 1;
	}
}
