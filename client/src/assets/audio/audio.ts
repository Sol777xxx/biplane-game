import type { Subscribable } from "biplane-shared/sim/bus.ts";
import type { NetBusEvents } from "../../net/events.ts";

// Відтворення звуків. Підписується на шину, сам sim про звук нічого не знає.
const MASTER = 0.7;
const MIN_GAP = 0.04; // с, захист від «каші» при дуже частих подіях

export type AudioEvents = Pick<
	NetBusEvents,
	"fired" | "hit" | "exploded" | "crash" | "pickup" | "respawned"
>;

export type SoundName =
	| "shoot"
	| "hit"
	| "cloudPop"
	| "planeBoom"
	| "bump"
	| "pickup"
	| "respawn";

interface SoundConfig {
	readonly volume: number;
	readonly fallback?: SoundName;
	readonly rate?: number;
}

// fallback: якщо власного файлу немає, беремо інший звук зі зміною тону.
// Тип Record вимагає запис для КОЖНОГО SoundName.
const SOUNDS: Readonly<Record<SoundName, SoundConfig>> = {
	shoot: { volume: 0.5 },
	hit: { volume: 0.6 },
	cloudPop: { volume: 0.8, fallback: "hit", rate: 0.7 },
	planeBoom: { volume: 0.9, fallback: "cloudPop", rate: 0.6 },
	bump: { volume: 0.8, fallback: "hit", rate: 0.5 },
	pickup: { volume: 0.7 },
	respawn: { volume: 0.7, fallback: "pickup", rate: 0.8 },
};

const isSoundName = (name: string): name is SoundName =>
	Object.hasOwn(SOUNDS, name);

export function createAudio() {
	// Safari до 14.1 мав лише префіксований webkitAudioContext; його вже не підтримуємо
	const ctx = new window.AudioContext();
	const master = ctx.createGain();
	master.gain.value = MASTER;
	master.connect(ctx.destination);

	const buffers: Partial<Record<SoundName, AudioBuffer>> = {};
	const last: Partial<Record<SoundName, number>> = {};

	// браузер вмикає звук лише після дії користувача
	const unlock = (): void => {
		if (ctx.state !== "running") ctx.resume();
	};
	window.addEventListener("pointerdown", unlock);
	window.addEventListener("keydown", unlock);

	function play(name: SoundName): void {
		if (ctx.state !== "running") return;
		let id: SoundName = name;
		let rate = 1;
		let buffer = buffers[id];
		while (!buffer) {
			const cfg = SOUNDS[id];
			if (!cfg.fallback) return;
			rate *= cfg.rate ?? 1;
			id = cfg.fallback;
			buffer = buffers[id];
		}
		const now = ctx.currentTime;
		if (now - (last[name] ?? -1) < MIN_GAP) return;
		last[name] = now;

		const src = ctx.createBufferSource();
		src.buffer = buffer;
		src.playbackRate.value = rate * (0.96 + Math.random() * 0.08); // легка варіація
		const gain = ctx.createGain();
		gain.gain.value = SOUNDS[name].volume;
		src.connect(gain).connect(master);
		src.start();
	}

	return {
		ctx,
		// assets: результат loadAll; беремо лише успішно декодовані звуки
		setBuffers(assets: Readonly<Record<string, unknown>>): void {
			for (const [name, asset] of Object.entries(assets)) {
				if (isSoundName(name) && asset instanceof AudioBuffer) {
					buffers[name] = asset;
				}
			}
		},
		attach(bus: Subscribable<AudioEvents>): void {
			bus.on("fired", () => play("shoot"));
			bus.on("hit", () => play("hit"));
			bus.on("exploded", (d) =>
				play(d.kind === "biplane" ? "planeBoom" : "cloudPop"),
			);
			bus.on("crash", () => play("bump"));
			bus.on("pickup", () => play("pickup"));
			bus.on("respawned", () => play("respawn"));
		},
	};
}

export type Audio = ReturnType<typeof createAudio>;
