// Експеримент лаб 7 (M4): чи варто виносити decodeSnapshot у Worker? Рішення go/no-go за числами.
//
//   node perf/experiments/worker.mjs
//
// Міряє на справжньому знімку (8 кораблів, кулі, перешкоди з детермінованої симуляції):
//  A. скільки main-потік платить за decodeSnapshot без Worker;
//  B. скільки він платить, якщо декодує Worker: структуроване клонування результату назад
//     (structuredClone на main це той самий алгоритм, що й десеріалізація повідомлення)
//     і затримку круга main → worker → main;
//  C. «Prove it»: 50 МБ ArrayBuffer клоном і transfer.
// Це worker_threads Node, а не Web Worker браузера, але структуроване клонування в обох
// однакове (V8), тож співвідношення вартостей переноситься; абсолютні числа ні.
import { mkdirSync, writeFileSync } from "node:fs";
import { isMainThread, parentPort, Worker } from "node:worker_threads";
import { decodeSnapshot, encodeSnapshot } from "biplane-shared/codec/binary.ts";

if (!isMainThread) {
	// Worker: приймає кадр (або будь-який вантаж), декодує й відповідає
	parentPort.on("message", (m) => {
		if (m.kind === "decode") {
			const t0 = performance.now();
			const msg = decodeSnapshot(m.frame);
			parentPort.postMessage({
				kind: "decoded",
				msg,
				ms: performance.now() - t0,
			});
		} else if (m.kind === "payload") {
			parentPort.postMessage({ kind: "ack", bytes: m.buf.byteLength });
		}
	});
}

const pct = (xs, q) => {
	const s = [...xs].sort((a, b) => a - b);
	return s[Math.min(s.length - 1, Math.ceil(q * s.length) - 1)];
};
const us = (ms) => Math.round(ms * 1000 * 10) / 10; // мс -> мкс з десятими
const stat = (msList) => ({
	p50: us(pct(msList, 0.5)),
	p99: us(pct(msList, 0.99)),
	mean: us(msList.reduce((a, b) => a + b, 0) / msList.length),
});

async function sampleSnapshot() {
	const { createScenario } = await import("biplane-shared/sim/scenario.ts");
	const { takeSnapshot } = await import("biplane-shared/sim/snapshot.ts");
	// найбільш завантажений момент 1500 тіків: найгірший випадок для декодера
	const s = createScenario({ seed: 7, players: 8 });
	let best = null;
	let bestSize = -1;
	for (let i = 0; i < 1500; i++) {
		s.step();
		const snap = takeSnapshot(s.game);
		const size =
			snap.ships.length +
			snap.bullets.length +
			snap.obstacles.length +
			snap.pickups.length;
		if (size > bestSize) {
			best = snap;
			bestSize = size;
		}
	}
	return { v: 1, type: "snapshot", ...best, ack: 1, events: [] };
}

async function timeMany(n, fn) {
	const out = [];
	for (let i = 0; i < n; i++) {
		const t0 = performance.now();
		fn();
		out.push(performance.now() - t0);
	}
	return out;
}

function roundTrip(worker, message, transfer) {
	return new Promise((resolve) => {
		const t0 = performance.now();
		worker.once("message", (reply) =>
			resolve({ reply, ms: performance.now() - t0 }),
		);
		worker.postMessage(message, transfer);
	});
}

async function main() {
	const msg = await sampleSnapshot();
	const frame = encodeSnapshot(msg);
	const shape = `${msg.ships.length} кораблів, ${msg.bullets.length} куль, ${msg.obstacles.length} перешкод, ${msg.pickups.length} бонусів, кадр ${frame.byteLength} Б`;
	console.log(`знімок: ${shape}`);

	// A. декодування на main
	for (let i = 0; i < 3000; i++) decodeSnapshot(frame); // розігрів JIT
	const decodeMain = stat(await timeMany(20000, () => decodeSnapshot(frame)));

	// B. що платить main, коли декодує Worker
	const decoded = decodeSnapshot(frame);
	for (let i = 0; i < 3000; i++) structuredClone(decoded);
	const receiveClone = stat(
		await timeMany(20000, () => structuredClone(decoded)),
	);

	const worker = new Worker(new URL(import.meta.url));
	await roundTrip(worker, { kind: "decode", frame: frame.slice() }, []); // розігрів
	const rtts = [];
	const inWorker = [];
	for (let i = 0; i < 3000; i++) {
		const copy = frame.slice(); // новий буфер на кожен знімок, як з сокета
		const { reply, ms } = await roundTrip(
			worker,
			{ kind: "decode", frame: copy },
			[copy.buffer],
		);
		rtts.push(ms);
		inWorker.push(reply.ms);
	}
	const roundTripStat = stat(rtts);
	const workerDecode = stat(inWorker);

	// C. 50 МБ: клон проти transfer
	const MB50 = 50 * 1024 * 1024;
	async function payload(transfer) {
		const buf = new ArrayBuffer(MB50);
		new Uint8Array(buf)[0] = 1;
		const t0 = performance.now();
		const p = roundTrip(
			worker,
			{ kind: "payload", buf },
			transfer ? [buf] : [],
		);
		const sendMs = performance.now() - t0; // скільки main заблоковано в postMessage
		const { ms } = await p;
		return {
			sendMs: Math.round(sendMs * 100) / 100,
			totalMs: Math.round(ms * 100) / 100,
			detachedAfter: buf.byteLength === 0,
		};
	}
	await payload(true); // розігрів
	const clone50 = [];
	const transfer50 = [];
	for (let i = 0; i < 5; i++) {
		clone50.push(await payload(false));
		transfer50.push(await payload(true));
	}
	await worker.terminate();
	const med = (rows, k) =>
		pct(
			rows.map((r) => r[k]),
			0.5,
		);

	// рішення: Worker виграє, лише якщо main економить більше, ніж платить за отримання результату
	const saved = decodeMain.mean - receiveClone.mean;
	const perSecond = 30; // знімків на секунду
	const result = {
		node: process.version,
		sample: shape,
		decodeOnMainUs: decodeMain,
		decodeInWorkerUs: workerDecode,
		receiveCloneOnMainUs: receiveClone,
		roundTripUs: roundTripStat,
		mainSavingPerSnapshotUs: Math.round(saved * 10) / 10,
		mainSavingPerSecondMs: Math.round(((saved * perSecond) / 1000) * 100) / 100,
		fiftyMb: {
			cloneSendMs: med(clone50, "sendMs"),
			cloneTotalMs: med(clone50, "totalMs"),
			transferSendMs: med(transfer50, "sendMs"),
			transferTotalMs: med(transfer50, "totalMs"),
			bufferDetachedAfterTransfer: transfer50.every((r) => r.detachedAfter),
			bufferDetachedAfterClone: clone50.some((r) => r.detachedAfter),
		},
		decision: saved > 0 && saved * perSecond > 2000 ? "GO" : "NO-GO",
	};
	result.reason =
		result.decision === "GO"
			? `Worker звільняє main приблизно на ${result.mainSavingPerSecondMs} мс/с`
			: `Worker не економить main-потік: decodeSnapshot на main коштує ${decodeMain.mean} мкс, а лише отримання готового результату з Worker (структуроване клонування) ${receiveClone.mean} мкс. Різниця ${result.mainSavingPerSnapshotUs} мкс на знімок (${result.mainSavingPerSecondMs} мс/с), до того ж круг main → worker → main додає ${roundTripStat.p50} мкс затримки`;

	console.log(JSON.stringify(result, null, "\t"));
	mkdirSync("docs/perf", { recursive: true });
	writeFileSync(
		"docs/perf/worker-experiment.json",
		`${JSON.stringify(result, null, "\t")}\n`,
	);
	console.log("\nзбережено: docs/perf/worker-experiment.json");
}

if (isMainThread) await main();
