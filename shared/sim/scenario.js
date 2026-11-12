import { Game } from "./game.js";
import { hashGame } from "./hash.js";
import { TICK_DT } from "./time.js";

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
