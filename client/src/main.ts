import type {
	RoomSummary,
	SnapshotMessage,
} from "biplane-shared/protocol/index.ts";
import { Biplane } from "biplane-shared/sim/biplane.ts";
import { toSeq } from "biplane-shared/sim/ids.ts";
import { assertNever } from "biplane-shared/sim/never.ts";
import {
	dumpScenario,
	runScenario,
	traceScenario,
} from "biplane-shared/sim/scenario.ts";
import { TICK_DT } from "biplane-shared/sim/time.ts";
import { type Audio, createAudio } from "./assets/audio/audio.ts";
import {
	fetchJson,
	HttpError,
	type LoadResult,
	loadAll,
	type Manifest,
	parseManifest,
	sleep,
	withRetry,
} from "./assets/loader.ts";
import { createFx } from "./fx.ts";
import { createHud } from "./hud.ts";
import { createInput } from "./input.ts";
import { createLoadingScreen, type LoadingScreen } from "./loadingScreen.ts";
import { Lobby } from "./lobby.ts";
import { createLoop } from "./loop.ts";
import { createInterpolator } from "./net/interpolator.ts";
import { createPredictor } from "./net/predictor.ts";
import { joinRoom, type RoomSession } from "./net/roomSession.ts";
import { createSnapshotView } from "./net/snapshotView.ts";
import { createNetStats, summarize } from "./netStats.ts";
import { perf } from "./perf.ts";
import { registerServiceWorker } from "./pwa.ts";
import {
	DEFAULT_PILOT,
	isPilotId,
	type PilotId,
} from "./render/pilots/index.ts";
import { createRenderer } from "./render/renderer.ts";
import { downloadSheet, initSprites } from "./render/sprites.ts";
import { mountChat } from "./ui/chatPanel.ts";
import { messageOf, query } from "./ui/dom.ts";
import { showLobby } from "./ui/lobbyView.ts";
import { mountNetgraph } from "./ui/netgraph.ts";
import { createPilotPicker } from "./ui/pilotPicker.ts";

const STORAGE_KEY = "biplane-pilot";
const PROBE_SECONDS = 5;
const params = new URLSearchParams(location.search);
// ?lag=100&jitter=30&loss=2 йдуть серверу в адресі сокета (потрібен ENABLE_NETSIM=1)
const netsimQuery = new URLSearchParams(
	["lag", "jitter", "loss"]
		.filter((key) => params.has(key))
		.map((key) => [key, params.get(key) ?? ""]),
).toString();
const WS_URL = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws${netsimQuery ? `?${netsimQuery}` : ""}`;
// лаб 5: ?codec=json вмикає JSON для порівняння (за замовчуванням binary)
const codec = params.get("codec") === "json" ? "json" : "binary";
// ?smooth=мс (згладжування поправки, 0 вимикає), ?interp=мс (затримка інтерполяції)
const num = (name: string, fallback: number): number =>
	/^\d{1,4}$/.test(params.get(name) ?? "")
		? Number(params.get(name))
		: fallback;
const smoothMs = num("smooth", 100);
const interpMs = num("interp", 100);
// лаб 1: ?exp=block | interval | variable
type Experiment = "block" | "interval" | "variable";
const EXPERIMENTS: readonly Experiment[] = ["block", "interval", "variable"];
const exp: Experiment | null =
	EXPERIMENTS.find((e) => e === params.get("exp")) ?? null;
// лаб 3: ?chaos=404|404hard|timeout|abort|badjson, ?latency=300 (мс на файл), ?seq
type Chaos = "404" | "404hard" | "timeout" | "abort" | "badjson";
const CHAOS_MODES: readonly Chaos[] = [
	"404",
	"404hard",
	"timeout",
	"abort",
	"badjson",
];
const chaos: Chaos | null =
	CHAOS_MODES.find((c) => c === params.get("chaos")) ?? null;
const latency = Number(params.get("latency") ?? 0);
const sequential = params.has("seq");

function loadPilot(): PilotId {
	try {
		// у сховищі може лежати що завгодно, тож isPilotId, а не PILOTS[saved]
		const saved = localStorage.getItem(STORAGE_KEY);
		return isPilotId(saved) ? saved : DEFAULT_PILOT;
	} catch {
		return DEFAULT_PILOT;
	}
}

function savePilot(id: PilotId): void {
	try {
		localStorage.setItem(STORAGE_KEY, id);
	} catch {
		// сховище недоступне
	}
}

// навмисне блокування потоку
function busyWait(ms: number): void {
	const end = performance.now() + ms;
	while (performance.now() < end) {
		// порожньо
	}
}

const canvas = query("#game", HTMLCanvasElement);
const hud = query("#hud", HTMLElement);
hud.hidden = true; // діагностика схована, поки гравець не натисне H
const status = query("#status", HTMLElement);
registerServiceWorker();
const retryBtn = query("#retry", HTMLButtonElement);

// збої для галереї (діють лише на першу спробу, Retry йде чисто)
function withChaos(manifest: Manifest, mode: Chaos | null): Manifest {
	const m = structuredClone(manifest);
	if (latency || mode === "abort") {
		const ms = latency || 1500;
		for (const a of m.assets) {
			a.url += `${a.url.includes("?") ? "&" : "?"}delay=${ms}`;
		}
	}
	// null це «без збою»; default: never вимагає гілку для кожного нового режиму
	switch (mode) {
		case null:
		case "abort": // лише затримка вище, скасування робить loadEverything
			break;
		case "404":
			// необов'язковий: гра стартує без нього
			m.assets.push({
				id: "bonus-sprites",
				type: "image",
				url: "/assets/missing.png",
				optional: true,
			});
			break;
		case "404hard":
			// обов'язковий: екран помилки і Retry
			m.assets.push({
				id: "required-sprite",
				type: "image",
				url: "/assets/missing.png",
			});
			break;
		case "timeout":
			m.assets.push({
				id: "slow",
				type: "json",
				url: "/assets/slow.json?delay=60000",
				timeoutMs: 1200,
				attempts: 2,
			});
			break;
		case "badjson": {
			const arena = m.assets.find((a) => a.id === "arena");
			if (arena) arena.url = "/assets/broken.json";
			break;
		}
		default:
			assertNever(mode, "режим chaos");
	}
	return m;
}

// завантаження з екрана, з Retry
async function loadEverything(
	audioCtx: BaseAudioContext,
	screen: LoadingScreen,
): Promise<LoadResult> {
	let mode: Chaos | null = chaos;
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
			// маніфест прийшов з мережі: форму перевіряє Zod, а не наша довіра
			const manifest = withChaos(parseManifest(raw), mode);
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
							`${f.id}: ${f.error instanceof HttpError ? `HTTP ${f.error.status}` : f.error instanceof Error ? f.error.name : "помилка"}`,
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

// гра: сервер рахує світ; клієнт шле input, передбачає свій корабель і кулі, чужі інтерполює
function startGame(
	audio: Audio,
	session: { name: string; room: RoomSummary; roomSession: RoomSession },
): void {
	const net = session.roomSession;

	// вкладку закрито, натиснуто «Назад» або браузер приспав сторінку: закриваємо сокет самі,
	// інакше сервер тримає гравця до heartbeat (~30 с), і інші бачать «привида»
	window.addEventListener("pagehide", () => net.leave());
	// сторінку відновлено з кеша «Назад/Вперед»: сокет уже закрито, повертаємось у лобі
	window.addEventListener("pageshow", (event) => {
		if (event.persisted) location.reload();
	});
	console.log(
		`гравець ${session.name}, кімната ${session.room.id}, кодек ${net.codec}`,
		session.room.arena,
	);
	const pilotId = loadPilot();
	const input = createInput();
	// локальний постріл: подія для звуку, поки куля сервера ще летить до нас
	const predictor = createPredictor({
		smooth: smoothMs / 1000,
		onFire: (at) =>
			view.bus.emit("fired", { by: { playerId: net.you?.id ?? null }, at }),
	});
	const interp = createInterpolator({ delay: interpMs });
	const netStats = createNetStats();
	const view = createSnapshotView({
		you: () => net.you?.id ?? null,
		local: () => predictor.pose,
		interp,
		shots: () => (predictor.enabled ? predictor.shots : null),
	});

	// ?debug: журнал поправок; corr() віддає підсумок від попереднього виклику
	const corrLog: number[] | null = params.has("debug") ? [] : null;

	// знімок: у буфер інтерполяції, потім звірка передбачення
	const onSnapshot = (msg: SnapshotMessage): void => {
		view.apply(msg);
		perf.begin("reconcile");
		const r = predictor.reconcile(msg, net.you?.id ?? null);
		perf.end("reconcile");
		if (r.correction === null) netStats.clearCorrection();
		else {
			netStats.correction(r.correction);
			if (!r.reset) corrLog?.push(r.correction);
		}
	};
	if (net.snapshot) onSnapshot(net.snapshot); // знімок міг прийти до старту гри
	net.listen("snapshot", onSnapshot);
	// після перепідключення seq починається з 1, буфери недійсні
	net.listen("status", (st) => {
		if (st.state !== "online") return;
		predictor.reset();
		view.reset();
	});
	// Сеанс закрито остаточно (сервер зупинився, перепідключення не допомогли): назад у лобі.
	// Перезавантаження дає чистий стан, а лобі саме покаже, чи сервер знову доступний.
	net.listen("status", (st) => {
		if (st.state !== "closed") return;
		ended = true;
		status.textContent =
			st.reason === "server shutting down"
				? "Сервер перезапускається. Повертаємось у лобі…"
				: `З'єднання втрачено (${st.code}). Повертаємось у лобі…`;
		setTimeout(() => location.reload(), 1500);
	});

	mountChat(query("#chat", HTMLElement), net);
	const netgraph = mountNetgraph(query("#netgraph", HTMLElement), {
		session: net,
		view,
		stats: netStats,
		predictor,
		interp,
	});
	const floaters = createHud(view.bus);
	const fx = createFx(view.bus);
	const scene = fx.view(view);
	const renderer = createRenderer(canvas, { pilotId, overlay: floaters });
	audio.attach(view.bus);
	let probe: { plane: Biplane; time: number; steps: number } | null = null; // вимірювання: окремий біплан поза світом
	let frameCount = 0;
	let lastStatus = "";
	let ended = false; // сеанс закрито: рядок статусу більше не перезаписуємо
	let sendClock = 0;

	// доступ із консолі: ?debug
	// (Reflect.set замість window.x = …: не треба розширювати тип Window)
	if (params.has("debug")) {
		Reflect.set(window, "net", view);
		Reflect.set(window, "netStats", netStats);
		Reflect.set(window, "predictor", predictor);
		Reflect.set(window, "interp", interp);
		Reflect.set(window, "corr", () => {
			const s = summarize(corrLog ?? []);
			corrLog?.splice(0);
			return s;
		});
	}

	// ?perf: підсумок вимірювань для консолі й автоматичного прогону
	if (perf.enabled) Reflect.set(window, "perfStats", perf);

	createPilotPicker(query("#pilots", HTMLElement), {
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
		onFrame: perf.enabled ? perf.frame : undefined,
		update(dt) {
			perf.begin("simulate");
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
				if (seq) predictor.step(toSeq(seq), keys); // 0 означає «не надіслано»
			}
			fx.step(dt);
			input.endStep();
			perf.end("simulate");
		},
		render(alpha) {
			perf.begin("render");
			frameCount++;
			// експеримент 1: блокування 100 мс кожен 60-й кадр
			if (exp === "block" && frameCount % 60 === 0) busyWait(100);
			const now = performance.now();
			view.update(now); // чужі сутності на момент now − delay
			renderer.draw(scene, alpha, now);
			netgraph.update(now);

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
			if (text !== lastStatus && !ended) {
				status.textContent = text;
				lastStatus = text;
			}
			perf.end("render");
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
async function main(): Promise<void> {
	// ?hash: той самий сценарій, що й у тесті Node; хеші мають збігтися
	if (params.has("hash")) {
		console.log(`hash (1000 кроків, seed 1): ${runScenario()}`);
		const marks = Array.from({ length: 20 }, (_, i) => i + 1);
		console.log(traceScenario({ marks }).join("\n"));
		const dump = Number(params.get("dump"));
		if (dump > 0) console.log(dumpScenario(dump).join("\n"));
	}

	// AudioContext створюється тут, щоб decodeAudioData встиг на екрані завантаження;
	// запускається він після жесту гравця (див. audio.ts)
	const audio = createAudio();
	const screen = createLoadingScreen(canvas, retryBtn);

	const result = await loadEverything(audio.ctx, screen);
	screen.stop();
	audio.setBuffers(result.assets);
	const sprites = initSprites(result.assets);
	console.log(`спрайти: ${sprites.count} шт., ${sprites.source}`);
	if (params.has("bake")) downloadSheet();
	if (params.has("debug")) Reflect.set(window, "assets", result.assets);

	// ?delay=мс у адресі сторінки затримує і запити лобі (див. vite.config.ts)
	const lobby = new Lobby({ url: `/api/rooms${location.search}` });
	const session = await showLobby(query("#lobby", HTMLElement), lobby, {
		// відмова повертає гравця в лобі з поясненням
		enter: async ({ name, room }) => ({
			roomSession: await joinRoom(WS_URL, { room: room.id, name, codec }),
		}),
	});
	startGame(audio, session);
}

main().catch((error: unknown) => {
	console.error(error);
	status.textContent = `Помилка запуску: ${messageOf(error)}`;
});
