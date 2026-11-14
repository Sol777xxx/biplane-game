import { Game } from "./game.js";
import { hashGame } from "./hash.ts";
import { TICK_DT } from "./time.ts";

// Скриптований input: чиста функція номера кроку, без випадковості.
export function scriptedInput(tick) {
	return {
		right: tick % 120 < 80,
		left: tick % 120 >= 100,
		up: tick % 90 < 30,
		down: tick % 90 >= 60,
		fire: tick % 20 < 10,
	};
}

export function createScenario({ seed = 1, players = 2 } = {}) {
	const game = new Game({}, { seed });
	const ids = Array.from({ length: players }, (_, i) => `p${i}`);
	for (const id of ids) game.addPlayer(id);
	return {
		game,
		step() {
			const inputs = new Map(
				ids.map((id, i) => [id, scriptedInput(game.tick + i * 37)]),
			);
			game.step(TICK_DT, inputs);
		},
	};
}

// Те саме викликаємо в Node (тест) і в Chrome (?hash): хеші мають збігтися.
export function runScenario({ ticks = 1000, seed = 1, players = 2 } = {}) {
	const scenario = createScenario({ seed, players });
	for (let i = 0; i < ticks; i++) scenario.step();
	return hashGame(scenario.game).toString(16).padStart(8, "0");
}

// Хеш після вибраних кроків: видно, де Node і Chrome вперше розходяться.
// Хеш після вибраних кроків: видно, де Node і Chrome вперше розходяться.
export function traceScenario({
	marks = [1, 2, 3, 5, 10, 20, 50, 100, 200, 500, 1000],
	seed = 1,
	players = 2,
} = {}) {
	const scenario = createScenario({ seed, players });
	const out = [];
	for (let i = 1; i <= marks[marks.length - 1]; i++) {
		scenario.step();
		if (marks.includes(i)) {
			out.push(
				`${i}: ${hashGame(scenario.game).toString(16).padStart(8, "0")}`,
			);
		}
	}
	return out;
}

const DUMP_KEYS = ["hp", "pitch", "facing", "cooldown", "flash", "ttl", "life"];

// Стан після кроку tick: рядок на сутність, числа повністю (ті самі поля, що в хеші).
export function dumpScenario(tick, { seed = 1, players = 2 } = {}) {
	const scenario = createScenario({ seed, players });
	for (let i = 0; i < tick; i++) scenario.step();
	const rows = [];
	for (const e of scenario.game.world) {
		const extra = DUMP_KEYS.filter((k) => typeof e[k] === "number")
			.map((k) => `${k}=${e[k]}`)
			.join(" ");
		const fx = e.effects
			? ` shield=${e.effects.shield} rapid=${e.effects.rapid} homing=${e.effects.homing}`
			: "";
		rows.push(
			`${e.kind}#${e.id} alive=${e.alive} pos=${e.pos.x},${e.pos.y} vel=${e.vel.x},${e.vel.y} ${extra}${fx}`,
		);
	}
	return rows;
}
