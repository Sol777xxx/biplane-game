import { Biplane } from "biplane-shared/sim/biplane.js";
import { runScenario } from "biplane-shared/sim/scenario.js";
import { TICK_DT } from "biplane-shared/sim/time.js";
import { createAudio } from "./assets/audio/audio.js";
import { fetchJson, loadAll, sleep, withRetry } from "./assets/loader.js";
import { createFx } from "./fx.js";
import { createHud } from "./hud.js";
import { createInput } from "./input.js";
import { createLoadingScreen } from "./loadingScreen.js";
import { Lobby } from "./lobby.js";
import { createLoop } from "./loop.js";
import { createPredictor } from "./net/predictor.js";
import { joinRoom } from "./net/roomSession.js";
import { createSnapshotView } from "./net/snapshotView.js";
import { createNetStats, summarize } from "./netStats.js";
import { DEFAULT_PILOT, PILOTS } from "./render/pilots/index.js";
import { createRenderer } from "./render/renderer.js";
import { downloadSheet, initSprites } from "./render/sprites.js";
import { mountChat } from "./ui/chatPanel.js";
import { showLobby } from "./ui/lobbyView.js";
import { mountNetgraph } from "./ui/netgraph.js";
import { createPilotPicker } from "./ui/pilotPicker.js";

const STORAGE_KEY = "biplane-pilot";
const PROBE_SECONDS = 5;
const params = new URLSearchParams(location.search);
// ?lag=100&jitter=30&loss=2 йдуть серверу в адресі сокета (потрібен ENABLE_NETSIM=1)
const netsimQuery = new URLSearchParams(
	["lag", "jitter", "loss"]
		.filter((key) => params.has(key))
		.map((key) => [key, params.get(key)]),
).toString();
const WS_URL = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws${netsimQuery ? `?${netsimQuery}` : ""}`;
// лаб 5: ?smooth=мс: згладжування поправки (за замовчуванням 100, 0 вимикає)
const smoothMs = /^\d{1,4}$/.test(params.get("smooth") ?? "")
	? Number(params.get("smooth"))
	: 100;
// лаб 1: ?exp=block | interval | variable
const exp = params.get("exp");
// лаб 3: ?chaos=404|404hard|timeout|abort|badjson, ?latency=300 (мс на файл), ?seq
const chaos = params.get("chaos");
const latency = Number(params.get("latency") ?? 0);
const sequential = params.has("seq");

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

// навмисне блокування потоку
function busyWait(ms) {
	const end = performance.now() + ms;
	while (performance.now() < end) {
		// порожньо
	}
}

const canvas = document.querySelector("#game");
const hud = document.querySelector("#hud");
hud.hidden = true; // діагностика схована, поки гравець не натисне H
const status = document.querySelector("#status");
const retryBtn = document.querySelector("#retry");

// збої для галереї (діють лише на першу спробу, Retry йде чисто)
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

// завантаження з екрана, з Retry
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
			await screen.fail(error);
		}
	}
}

// гра: світ рахує сервер, клієнт шле input, передбачає свій корабель і малює знімки
function startGame(audio, session) {
	const net = session.roomSession;
	console.log(
		`гравець ${session.name}, кімната ${session.room.id}`,
		session.room.arena,
	);
	const pilotId = loadPilot();
	const input = createInput();
	const predictor = createPredictor({ smooth: smoothMs / 1000 });
	const netStats = createNetStats();
	const view = createSnapshotView({
		you: () => net.you?.id,
		local: () => predictor.pose,
	});

	// ?debug: журнал поправок; corr() віддає підсумок від попереднього виклику
	const corrLog = params.has("debug") ? [] : null;

	// знімок: показ, потім звірка передбачення
	const onSnapshot = (msg) => {
		view.apply(msg);
		const r = predictor.reconcile(msg, net.you?.id);
		if (r.correction === null) netStats.clearCorrection();
		else {
			netStats.correction(r.correction);
			if (!r.reset) corrLog?.push(r.correction);
		}
	};
	if (net.snapshot) onSnapshot(net.snapshot); // знімок міг прийти до старту гри
	net.addEventListener("snapshot", (e) => onSnapshot(e.detail));
	// після перепідключення seq починається з 1: старий буфер недійсний
	net.addEventListener("status", (e) => {
		if (e.detail.state === "online") predictor.reset();
	});

	mountChat(document.querySelector("#chat"), net);
	const netgraph = mountNetgraph(document.querySelector("#netgraph"), {
		session: net,
		view,
		stats: netStats,
		predictor,
	});
	const floaters = createHud(view.bus);
	const fx = createFx(view.bus);
	const scene = fx.view(view);
	const renderer = createRenderer(canvas, { pilotId, overlay: floaters });
	audio.attach(view.bus);
	let probe = null; // вимірювання: окремий біплан поза світом
	let frameCount = 0;
	let lastStatus = "";
	let sendClock = 0;

	// доступ із консолі: ?debug
	if (params.has("debug")) {
		window.net = view;
		window.netStats = netStats;
		window.predictor = predictor;
		window.corr = () => {
			const s = summarize(corrLog);
			corrLog.length = 0;
			return s;
		};
	}

	createPilotPicker(document.querySelector("#pilots"), {
		current: pilotId,
		onSelect(id) {
			renderer.setPilot(id);
			savePilot(id);
		},
	});

	const loop = createLoop({
		step: TICK_DT, // той самий крок, що й на сервері
		mode: exp === "variable" ? "variable" : "fixed",
		driver: exp === "interval" ? "interval" : "raf",
		update(dt) {
			if (input.justPressed("hud")) hud.hidden = !hud.hidden;
			predictor.tick(dt); // згасання видимого зсуву

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

			// не частіше одного input за TICK_DT (у variable кроки частіші, ліміт сервера 40/с);
			// що надіслано, те й передбачаємо
			sendClock += dt;
			if (sendClock >= TICK_DT * 0.999) {
				sendClock = 0;
				const keys = input.snapshot();
				const seq = net.sendInput(keys);
				if (seq) predictor.step(seq, keys);
			}
			fx.step(dt);
			input.endStep();
		},
		render(alpha) {
			frameCount++;
			// експеримент 1: блокування 100 мс кожен 60-й кадр
			if (exp === "block" && frameCount % 60 === 0) busyWait(100);
			renderer.draw(scene, alpha, performance.now());
			netgraph.update(performance.now());

			const { ship, player } = view.me();
			const active = ship
				? Object.entries(ship.effects)
						.filter(([, t]) => t > 0)
						.map(([name, t]) => `${name} ${Math.ceil(t)}`)
						.join(" ")
				: "";
			const text =
				`${session.name} · ${session.room.name}   ` +
				`HP: ${ship ? ship.hp : "—"}   рахунок: ${player?.score ?? 0}   ` +
				`збито: ${player?.destroyed ?? 0}   зіткнень: ${player?.crashes ?? 0}` +
				(active ? `   [${active}]` : "");
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

// точка входу: loading → lobby → game
async function main() {
	// ?hash: той самий сценарій, що й у тесті Node; хеші мають збігтися
	if (params.has("hash")) {
		console.log(`hash (1000 кроків, seed 1): ${runScenario()}`);
	}

	// AudioContext створюється тут, щоб decodeAudioData встиг на екрані завантаження;
	// запускається він після жесту гравця (див. audio.js)
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
	const session = await showLobby(document.querySelector("#lobby"), lobby, {
		// відмова повертає гравця в лобі з поясненням
		enter: async ({ name, room }) => ({
			roomSession: await joinRoom(WS_URL, { room: room.id, name }),
		}),
	});
	startGame(audio, session);
}

main().catch((error) => {
	console.error(error);
	status.textContent = `Помилка запуску: ${error.message}`;
});
