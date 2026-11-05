// Відтворення звуків. Підписується на world.bus, сам sim про звук нічого не знає.
const MASTER = 0.7;
const MIN_GAP = 0.04; // с, захист від «каші» при дуже частих подіях

// fallback: якщо власного файлу немає, беремо інший звук зі зміною тону
const SOUNDS = {
	shoot: { volume: 0.5 },
	hit: { volume: 0.6 },
	cloudPop: { volume: 0.8, fallback: "hit", rate: 0.7 },
	planeBoom: { volume: 0.9, fallback: "cloudPop", rate: 0.6 },
	bump: { volume: 0.8, fallback: "hit", rate: 0.5 },
	pickup: { volume: 0.7 },
	respawn: { volume: 0.7, fallback: "pickup", rate: 0.8 },
};

export function createAudio() {
	const Ctx = window.AudioContext ?? window.webkitAudioContext;
	const ctx = new Ctx();
	const master = ctx.createGain();
	master.gain.value = MASTER;
	master.connect(ctx.destination);

	const buffers = {};
	const last = {};

	// браузер вмикає звук лише після дії користувача
	const unlock = () => {
		if (ctx.state !== "running") ctx.resume();
	};
	window.addEventListener("pointerdown", unlock);
	window.addEventListener("keydown", unlock);

	function play(name) {
		if (ctx.state !== "running") return;
		let id = name;
		let rate = 1;
		while (!buffers[id]) {
			const cfg = SOUNDS[id];
			if (!cfg?.fallback) return;
			rate *= cfg.rate ?? 1;
			id = cfg.fallback;
		}
		const now = ctx.currentTime;
		if (now - (last[name] ?? -1) < MIN_GAP) return;
		last[name] = now;

		const src = ctx.createBufferSource();
		src.buffer = buffers[id];
		src.playbackRate.value = rate * (0.96 + Math.random() * 0.08); // легка варіація
		const gain = ctx.createGain();
		gain.gain.value = SOUNDS[name].volume;
		src.connect(gain).connect(master);
		src.start();
	}

	return {
		ctx,
		// assets: результат loadAll; беремо лише успішно декодовані звуки
		setBuffers(assets) {
			for (const name of Object.keys(SOUNDS)) {
				if (assets[name] instanceof AudioBuffer) buffers[name] = assets[name];
			}
		},
		attach(bus) {
			bus.addEventListener("fired", () => play("shoot"));
			bus.addEventListener("hit", () => play("hit"));
			bus.addEventListener("exploded", (e) =>
				play(e.detail.kind === "biplane" ? "planeBoom" : "cloudPop"),
			);
			bus.addEventListener("crash", () => play("bump"));
			bus.addEventListener("pickup", () => play("pickup"));
			bus.addEventListener("respawned", () => play("respawn"));
		},
	};
}
