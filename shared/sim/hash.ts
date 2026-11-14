import type { Vec2 } from "./vector.ts";

// FNV-1a по 32-бітних словах. Числа з рухомою комою округляємо до 1e-6 і хешуємо
// за бітами (DataView, little-endian). Math.sin/cos/atan2 у Node і Chrome можуть
// різнитися в останньому біті; заокруглення прибирає цей шум, а реальна
// розбіжність стану (≥ 1e-6) змінює хеш.
const FNV_OFFSET = 2166136261;
const FNV_PRIME = 16777619;
const QUANT = 1e6;
const bits = new DataView(new ArrayBuffer(8));

// Хеш читає лише ці поля. Game і Entity не імпортуємо: їм досить мати таку форму.
type NumberKey =
	| "hp"
	| "pitch"
	| "facing"
	| "cooldown"
	| "flash"
	| "ttl"
	| "life";
type EffectKey = "shield" | "rapid" | "homing";

interface HashableEntity {
	readonly kind: string;
	readonly id: number;
	readonly alive: boolean;
	readonly pos: Vec2;
	readonly vel: Vec2;
	readonly hp?: number;
	readonly pitch?: number;
	readonly facing?: number;
	readonly cooldown?: number;
	readonly flash?: number;
	readonly ttl?: number;
	readonly life?: number;
	readonly effects?: Readonly<Record<EffectKey, number>>;
}

interface HashablePlayer {
	readonly id: string;
	readonly score: number;
	readonly destroyed: number;
	readonly crashes: number;
	readonly deaths: number;
	readonly respawnIn: number;
}

export interface HashableGame {
	readonly tick: number;
	readonly rng: { state(): number };
	readonly world: Iterable<HashableEntity>;
	readonly players: { values(): Iterable<HashablePlayer> };
}

const word = (h: number, n: number): number =>
	Math.imul(h ^ n, FNV_PRIME) >>> 0;

function float(h: number, value: number): number {
	// + 0 перетворює -0 на 0, щоб знак нуля не міняв хеш
	bits.setFloat64(0, Math.round(value * QUANT) + 0, true);
	return word(word(h, bits.getUint32(0, true)), bits.getUint32(4, true));
}

function text(h: number, s: string): number {
	let out = h;
	for (let i = 0; i < s.length; i++) out = word(out, s.charCodeAt(i));
	return out;
}

const NUMBER_KEYS: readonly NumberKey[] = [
	"hp",
	"pitch",
	"facing",
	"cooldown",
	"flash",
	"ttl",
	"life",
];
const EFFECT_KEYS: readonly EffectKey[] = ["shield", "rapid", "homing"];

// Порядок обходу фіксований: сутності в порядку створення, ключі в заданому порядку.
export function hashGame(game: HashableGame): number {
	let h = FNV_OFFSET;
	h = word(h, game.tick);
	h = word(h, game.rng.state());

	for (const e of game.world) {
		h = text(h, e.kind);
		h = word(h, e.id);
		h = word(h, e.alive ? 1 : 0);
		h = float(h, e.pos.x);
		h = float(h, e.pos.y);
		h = float(h, e.vel.x);
		h = float(h, e.vel.y);
		for (const key of NUMBER_KEYS) {
			const value = e[key];
			if (typeof value === "number") h = float(h, value);
		}
		if (e.effects) {
			for (const key of EFFECT_KEYS) h = float(h, e.effects[key]);
		}
	}

	for (const p of game.players.values()) {
		h = text(h, String(p.id));
		h = word(h, p.score);
		h = word(h, p.destroyed);
		h = word(h, p.crashes);
		h = word(h, p.deaths);
		h = float(h, p.respawnIn);
	}
	return h >>> 0;
}
