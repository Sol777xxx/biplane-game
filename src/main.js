import { createAudio } from "./assets/audio/audio.js";
import { fetchJson, loadAll, sleep, withRetry } from "./assets/loader.js";
import { createHud } from "./hud.js";
import { createInput } from "./input.js";
import { createLoadingScreen } from "./loadingScreen.js";
import { Lobby } from "./lobby.js";
import { createLoop } from "./loop.js";
import { DEFAULT_PILOT, PILOTS } from "./render/pilots/index.js";
import { createRenderer } from "./render/renderer.js";
import { downloadSheet, initSprites } from "./render/sprites.js";
import { Biplane } from "./sim/biplane.js";
import { Game } from "./sim/game.js";
import { showLobby } from "./ui/lobbyView.js";
import { createPilotPicker } from "./ui/pilotPicker.js";

const STORAGE_KEY = "biplane-pilot";
const PROBE_SECONDS = 5;

const params = new URLSearchParams(location.search);
// режим експерименту з лаб 1: ?exp=block | interval | variable
const exp = params.get("exp");
// лаб 3: ?chaos=404|404hard|timeout|abort|badjson, ?latency=300 (мс на файл), ?seq
const chaos = params.get("chaos");
const latency = Number(params.get("latency") ?? 0);
const sequential = params.has("seq");

// читання збереженого героя
function loadPilot() {
	try {
		const saved = localStorage.getItem(STORAGE_KEY);
		return saved && PILOTS[saved] ? saved : DEFAULT_PILOT;
	} catch {
		return DEFAULT_PILOT;
	}
}

function savePilot(id) {
	try {
		localStorage.setItem(STORAGE_KEY, id);
	} catch {
		// сховище недоступне
	}
}

// синхронне блокування потоку
function busyWait(ms) {
	const end = performance.now() + ms;
	while (performance.now() < end) {
		// навмисне блокування
	}
}

const canvas = document.querySelector("#game");
const hud = document.querySelector("#hud");
const status = document.querySelector("#status");
const retryBtn = document.querySelector("#retry");

// ---------- збої для галереї (діють лише на першу спробу, Retry йде вже чисто) ----------
function withChaos(manifest, mode) {
	const m = structuredClone(manifest);
	const find = (id) => m.assets.find((a) => a.id === id);
	if (latency || mode === "abort") {
		const ms = latency || 1500;
		for (const a of m.assets) {
			a.url += `${a.url.includes("?") ? "&" : "?"}delay=${ms}`;
		}
	}
	if (mode === "404") {
		// необов'язковий: гра стартує без нього
		m.assets.push({
			id: "bonus-sprites",
			type: "image",
			url: "/assets/missing.png",
			optional: true,
		});
	} else if (mode === "404hard") {
		// обов'язковий: екран помилки і Retry
		m.assets.push({
			id: "required-sprite",
			type: "image",
			url: "/assets/missing.png",
		});
	} else if (mode === "timeout") {
		m.assets.push({
			id: "slow",
			type: "json",
			url: "/assets/slow.json?delay=60000",
			timeoutMs: 1200,
			attempts: 2,
		});
	} else if (mode === "badjson") {
		find("arena").url = "/assets/broken.json";
	}
	return m;
}

// ---------- завантаження з екрана, з Retry ----------
async function loadEverything(audioCtx, screen) {
	let mode = chaos;
	for (;;) {
		const ctl = new AbortController();
		screen.start();
		if (mode === "abort") setTimeout(() => ctl.abort(), 600);
		try {
			const raw = await withRetry(
				() =>
					fetchJson("/assets/manifest.json", {
						signal: ctl.signal,
						timeoutMs: 5000,
					}),
				{ signal: ctl.signal },
			);
			const manifest = withChaos(raw, mode);
			const result = await loadAll(manifest, {
				ctx: audioCtx,
				signal: ctl.signal,
				onProgress: (e) => screen.progress(e),
				mode: sequential ? "sequential" : "concurrent",
			});
			const kind = sequential ? "sequential" : "concurrent";
			console.log(
				`assets [${kind}${latency ? `, +${latency}мс/файл` : ""}]: ${result.ms.toFixed(0)} мс, ${manifest.assets.length} файлів, пропущено ${result.failures.length}`,
			);
			if (result.failures.length) {
				for (const f of result.failures) {
					console.warn(`пропущено ${f.id}:`, f.error);
				}
				screen.setWarnings(
					result.failures.map(
						(f) =>
							`${f.id}: ${f.error.name === "HttpError" ? `HTTP ${f.error.status}` : f.error.name}`,
					),
				);
				await sleep(1800); // даємо прочитати, гра все одно стартує
			} else {
				await sleep(250);
			}
			return result;
		} catch (error) {
			console.error("завантаження не вдалось:", error);
			mode = null; // Retry без навмисного збою
			await screen.fail(error); // чекаємо натискання Retry
		}
	}
}

// ---------- гра (код лаб 1-2 без змін, лише загорнутий у функцію) ----------
function startGame(audio, session) {
	console.log(
		`гравець ${session.name}, кімната ${session.room.id}`,
		session.room.arena,
	);
	const pilotId = loadPilot();
	const input = createInput();
	const game = new Game();
	const floaters = createHud(game.world.bus);
	const renderer = createRenderer(canvas, { pilotId, overlay: floaters });
	audio.attach(game.world.bus);
	let probe = null; // вимірювання: окремий біплан поза світом
	let frameCount = 0;
	let lastStatus = "";

	// доступ із консолі для експериментів: ?debug
	if (params.has("debug")) window.game = game;

	createPilotPicker(document.querySelector("#pilots"), {
		current: pilotId,
		onSelect(id) {
			renderer.setPilot(id);
			savePilot(id);
		},
	});

	const loop = createLoop({
		mode: exp === "variable" ? "variable" : "fixed",
		driver: exp === "interval" ? "interval" : "raf",
		update(dt) {
			if (input.justPressed("hud")) hud.hidden = !hud.hidden;

			// вимірювання: 5 с симуляційного часу з постійним «вправо»
			if (input.justPressed("probe")) {
				probe = { plane: new Biplane(), time: 0, steps: 0 };
			}
			if (probe) {
				probe.plane.update(dt, { right: true });
				probe.time += dt;
				probe.steps++;
				if (probe.time >= PROBE_SECONDS) {
					console.log(
						`probe [${exp ?? "fixed"}]: x=${probe.plane.pos.x.toFixed(2)} y=${probe.plane.pos.y.toFixed(2)} steps=${probe.steps}`,
					);
					probe = null;
				}
			}

			game.step(dt, input.snapshot());
			input.endStep();
		},
		render(alpha) {
			frameCount++;
			// експеримент 1: блокування 100 мс кожен 60-й кадр
			if (exp === "block" && frameCount % 60 === 0) busyWait(100);
			renderer.draw(game, alpha, performance.now());

			const p = game.plane;
			const fx = Object.entries(p.effects)
				.filter(([, t]) => t > 0)
				.map(([name, t]) => `${name} ${Math.ceil(t)}`)
				.join(" ");
			const text =
				`HP: ${p.alive ? p.hp : "—"}   рахунок: ${game.score}   ` +
				`збито: ${game.destroyed}   зіткнень: ${game.crashes}` +
				(fx ? `   [${fx}]` : "");
			if (text !== lastStatus) {
				status.textContent = text;
				lastStatus = text;
			}
		},
		onStats({ stepsPerSec, framesPerSec, frameMs, minMs, maxMs, jitterMs }) {
			let text =
				`steps/s:  ${stepsPerSec.toFixed(1)}\n` +
				`frames/s: ${framesPerSec.toFixed(1)}\n` +
				`frame:    ${frameMs.toFixed(1)} ms`;

			// додаткові метрики лише в режимах експериментів
			if (exp) {
				text =
					`mode:     ${exp}\n${text}\n` +
					`min/max:  ${minMs.toFixed(1)} / ${maxMs.toFixed(1)} ms\n` +
					`jitter:   ${jitterMs.toFixed(2)} ms`;
			}
			hud.textContent = text;
		},
	});

	loop.start();
}

// ---------- точка входу: loading → game ----------
async function main() {
	// AudioContext створюється тут: decodeAudioData декодує звуки на екрані завантаження,
	// а запускається контекст лише після жесту гравця (див. audio.js)
	const audio = createAudio();
	const screen = createLoadingScreen(canvas, retryBtn);

	const result = await loadEverything(audio.ctx, screen);
	screen.stop();
	audio.setBuffers(result.assets);
	const sprites = initSprites(result.assets);
	console.log(`спрайти: ${sprites.count} шт., ${sprites.source}`);
	if (params.has("bake")) downloadSheet();
	if (params.has("debug")) window.assets = result.assets;
	// ?delay=мс у адресі сторінки затримує і запити лобі (див. vite.config.js)
	const lobby = new Lobby({ url: `/api/rooms${location.search}` });
	const session = await showLobby(document.querySelector("#lobby"), lobby);
	startGame(audio, session);
	console.log(`спрайти: ${sprites.count} шт., ${sprites.source}`);
	if (params.has("bake")) downloadSheet();
	if (params.has("debug")) window.assets = result.assets;
	startGame(audio);
}

main().catch((error) => {
	console.error(error);
	status.textContent = `Помилка запуску: ${error.message}`;
});
