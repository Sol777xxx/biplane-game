import { Game } from "./game.ts";
import { hashGame } from "./hash.ts";
import { TICK_DT } from "./time.ts";
import type { InputState } from "./types.ts";
import { isSimEntity } from "./world.ts";

// Скриптований input: чиста функція номера кроку, без випадковості.
export function scriptedInput(tick: number): InputState {
	return {
		right: tick % 120 < 80,
		left: tick % 120 >= 100,
		up: tick % 90 < 30,
		down: tick % 90 >= 60,
		fire: tick % 20 < 10,
	};
}

export interface ScenarioOptions {
	readonly seed?: number;
	readonly players?: number;
}

export interface Scenario {
	readonly game: Game;
	step(): void;
}

export function createScenario({
	seed = 1,
	players = 2,
}: ScenarioOptions = {}): Scenario {
	const game = new Game({}, { seed });
	const ids = Array.from({ length: players }, (_, i) => `p${i}`);
	for (const id of ids) game.addPlayer(id);
	return {
		game,
		step() {
			const inputs = new Map(
				ids.map((id, i): [string, InputState] => [
					id,
					scriptedInput(game.tick + i * 37),
				]),
			);
			game.step(TICK_DT, inputs);
		},
	};
}

const hex = (h: number): string => h.toString(16).padStart(8, "0");

export interface RunOptions extends ScenarioOptions {
	readonly ticks?: number;
}

// Те саме викликаємо в Node (тест) і в Chrome (?hash): хеші мають збігтися.
export function runScenario({
	ticks = 1000,
	seed = 1,
	players = 2,
}: RunOptions = {}): string {
	const scenario = createScenario({ seed, players });
	for (let i = 0; i < ticks; i++) scenario.step();
	return hex(hashGame(scenario.game));
}

export interface TraceOptions extends ScenarioOptions {
	readonly marks?: readonly number[];
}

// Хеш після вибраних кроків: видно, де Node і Chrome вперше розходяться.
export function traceScenario({
	marks = [1, 2, 3, 5, 10, 20, 50, 100, 200, 500, 1000],
	seed = 1,
	players = 2,
}: TraceOptions = {}): string[] {
	const scenario = createScenario({ seed, players });
	const out: string[] = [];
	const last = marks.at(-1) ?? 0; // at(-1) може бути undefined для порожнього списку
	for (let i = 1; i <= last; i++) {
		scenario.step();
		if (marks.includes(i)) out.push(`${i}: ${hex(hashGame(scenario.game))}`);
	}
	return out;
}

const DUMP_KEYS: readonly string[] = [
	"hp",
	"pitch",
	"facing",
	"cooldown",
	"flash",
	"ttl",
	"life",
];

// числове поле за іменем; тип поля невідомий, тому unknown і перевірка typeof
function numberField(e: object, key: string): number | undefined {
	const value: unknown = Reflect.get(e, key);
	return typeof value === "number" ? value : undefined;
}

// Стан після кроку tick: рядок на сутність, числа повністю (ті самі поля, що в хеші).
export function dumpScenario(
	tick: number,
	{ seed = 1, players = 2 }: ScenarioOptions = {},
): string[] {
	const scenario = createScenario({ seed, players });
	for (let i = 0; i < tick; i++) scenario.step();
	const rows: string[] = [];
	for (const e of scenario.game.world) {
		const extra = DUMP_KEYS.flatMap((k) => {
			const v = numberField(e, k);
			return v === undefined ? [] : [`${k}=${v}`];
		}).join(" ");
		const fx =
			isSimEntity(e) && e.kind === "biplane"
				? ` shield=${e.effects.shield} rapid=${e.effects.rapid} homing=${e.effects.homing}`
				: "";
		rows.push(
			`${e.kind}#${e.id} alive=${e.alive} pos=${e.pos.x},${e.pos.y} vel=${e.vel.x},${e.vel.y} ${extra}${fx}`,
		);
	}
	return rows;
}
