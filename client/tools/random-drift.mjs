// npm run drift -w client: поправки звірки без Math.random() і з ним у Biplane.update.
// Сервер і клієнт в одному процесі, мережа це затримка в тіках. Math.random без seed,
// тож числа трохи різняться між запусками.
import { Biplane } from "biplane-shared/sim/biplane.js";
import { Game } from "biplane-shared/sim/game.js";
import { scriptedInput } from "biplane-shared/sim/scenario.js";
import { takeSnapshot } from "biplane-shared/sim/snapshot.js";
import { TICK_DT } from "biplane-shared/sim/time.ts";
import { createPredictor } from "../src/net/predictor.js";
import { summarize } from "../src/netStats.js";

const TICKS = 900; // 30 с
const NOISE = 120; // шум швидкості: ±60 px/с за крок
const RTTS = [0, 100, 200];

// обгортка поверх update: після кроку додає випадкову швидкість (і серверу, і клієнту)
const original = Biplane.prototype.update;
let noise = 0;
Biplane.prototype.update = function update(dt, input) {
	original.call(this, dt, input);
	if (noise) this.vel.x += (Math.random() - 0.5) * noise;
};

function run(rttMs, amplitude) {
	noise = amplitude;
	const delay = Math.round(rttMs / 2 / (1000 / 30)); // тіків в один бік
	const game = new Game({ obstacles: 0 }, { seed: 1 });
	game.addPlayer("a");
	const predictor = createPredictor({ smooth: 0 });
	const toServer = [];
	const toClient = [];
	const queue = [];
	const corrections = [];
	let keys = scriptedInput(0);
	let ack = 0;
	for (let k = 1; k <= TICKS; k++) {
		const pressed = scriptedInput(k);
		predictor.step(k, pressed);
		toServer.push({ at: k + delay, seq: k, keys: pressed });
		while (toServer.length && toServer[0].at <= k) queue.push(toServer.shift());
		const next = queue.shift();
		if (next) {
			keys = next.keys;
			ack = next.seq;
		}
		game.step(TICK_DT, new Map([["a", keys]]));
		toClient.push({ at: k + delay, snap: { ...takeSnapshot(game), ack } });
		while (toClient.length && toClient[0].at <= k) {
			const r = predictor.reconcile(toClient.shift().snap, "a");
			if (!r.reset && r.correction !== null) corrections.push(r.correction);
		}
	}
	return summarize(corrections);
}

const rows = [];
for (const amplitude of [0, NOISE]) {
	for (const rtt of RTTS) {
		rows.push({
			"Math.random в update": amplitude ? `±${amplitude / 2} px/с` : "ні",
			"RTT, мс": rtt,
			...run(rtt, amplitude),
		});
	}
}
noise = 0;
console.table(rows);
