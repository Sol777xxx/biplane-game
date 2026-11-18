import type { Interpolator } from "../net/interpolator.ts";
import type { Predictor } from "../net/predictor.ts";
import type { NetsimState, RoomSession } from "../net/roomSession.ts";
import type { SnapshotView } from "../net/snapshotView.ts";
import { formatNet, type NetStats } from "../netStats.ts";
import { el } from "./dom.ts";

const GRAPH_W = 240;
const GRAPH_H = 44;
const GRAPH_MAX_MS = 200; // висота графіка
const GRAPH_BARS = 120;
const REFRESH_MS = 250;

export interface NetPreset {
	readonly label: string;
	readonly lag: number;
	readonly jitter: number;
	readonly loss: number;
}

// пресети штучної мережі (кнопки лише якщо сервер дозволяє netsim)
export const PRESETS: readonly NetPreset[] = [
	{ label: "0", lag: 0, jitter: 0, loss: 0 },
	{ label: "100 ± 30", lag: 100, jitter: 30, loss: 0 },
	{ label: "100 ± 30 + 2%", lag: 100, jitter: 30, loss: 2 },
];

// стовпчики це проміжки між знімками: рівний ряд ≈33 мс здоровий, високі стовпчики це затримки
function drawGraph(
	canvas: HTMLCanvasElement,
	intervals: readonly number[],
): void {
	const dpr = window.devicePixelRatio || 1;
	if (canvas.width !== Math.round(GRAPH_W * dpr)) {
		canvas.width = Math.round(GRAPH_W * dpr);
		canvas.height = Math.round(GRAPH_H * dpr);
	}
	const g = canvas.getContext("2d");
	if (!g) return;
	g.setTransform(dpr, 0, 0, dpr, 0, 0);
	g.clearRect(0, 0, GRAPH_W, GRAPH_H);

	const barW = GRAPH_W / GRAPH_BARS;
	intervals.forEach((ms, i) => {
		const h = Math.max(1, Math.min(1, ms / GRAPH_MAX_MS) * GRAPH_H);
		g.fillStyle = ms > 100 ? "#c2417d" : ms > 50 ? "#f08ab4" : "#82dcbe";
		const x = GRAPH_W - (intervals.length - i) * barW;
		g.fillRect(x, GRAPH_H - h, Math.max(1, barW - 0.5), h);
	});

	// пунктир на 33 мс: ідеальний інтервал при 30 Гц
	const y = GRAPH_H - (1000 / 30 / GRAPH_MAX_MS) * GRAPH_H;
	g.strokeStyle = "rgba(107, 91, 138, 0.6)";
	g.lineWidth = 1;
	g.setLineDash([3, 3]);
	g.beginPath();
	g.moveTo(0, y);
	g.lineTo(GRAPH_W, y);
	g.stroke();
	g.setLineDash([]);
}

export interface NetgraphOptions {
	readonly session: RoomSession;
	readonly view: SnapshotView;
	readonly stats: NetStats;
	// необов'язкові: кнопка prediction і повзунок затримки
	readonly predictor?: Predictor | null;
	readonly interp?: Interpolator | null;
	readonly visible?: boolean;
}

// Панель мережі; клавіша N ховає/показує (за замовчуванням схована),
// update() викликається щокадру.
export function mountNetgraph(
	root: HTMLElement,
	{
		session,
		view,
		stats,
		predictor = null,
		interp = null,
		visible = false,
	}: NetgraphOptions,
) {
	const ac = new AbortController();
	const { signal } = ac;

	const text = el("pre", { className: "net-text" });
	const graph = el("canvas", { className: "net-graph" });
	graph.style.width = `${GRAPH_W}px`;
	graph.style.height = `${GRAPH_H}px`;
	const children: HTMLElement[] = [text, graph];

	if (interp) {
		const slider = el("input", {
			type: "range",
			className: "net-range",
			min: "0",
			max: "300",
			step: "10",
			value: String(interp.delay),
			title: "затримка інтерполяції, мс",
		});
		slider.addEventListener(
			"input",
			() => {
				interp.delay = Number(slider.value);
			},
			{ signal },
		);
		// після відпускання повертаємо клавіатуру грі
		slider.addEventListener("change", () => slider.blur(), { signal });
		children.push(slider);
	}

	if (predictor) {
		const btn = el("button", { type: "button", className: "net-preset" });
		const label = (): void => {
			btn.textContent = `prediction: ${predictor.enabled ? "on" : "off"}`;
		};
		label();
		btn.addEventListener(
			"click",
			() => {
				predictor.enabled = !predictor.enabled;
				stats.clearCorrection();
				label();
				btn.blur(); // щоб клавіші керування не «натискали» кнопку
			},
			{ signal },
		);
		children.push(el("div", { className: "net-presets" }, btn));
	}

	const presets = el("div", { className: "net-presets", hidden: true });
	const presetButtons: { preset: NetPreset; btn: HTMLButtonElement }[] = [];
	for (const preset of PRESETS) {
		const btn = el("button", {
			type: "button",
			className: "net-preset",
			textContent: preset.label,
			title: `lag ${preset.lag} мс, jitter ${preset.jitter} мс, втрати ${preset.loss}%`,
		});
		btn.addEventListener(
			"click",
			() => {
				session.setNetsim(preset);
				btn.blur();
			},
			{ signal },
		);
		presetButtons.push({ preset, btn });
		presets.append(btn);
	}
	// підсвічуємо кнопку, чиї значення зараз діють на сервері
	const markActive = (s: NetsimState | null): void => {
		for (const { preset, btn } of presetButtons) {
			btn.classList.toggle(
				"active",
				Boolean(s) &&
					s?.lag === preset.lag &&
					s.jitter === preset.jitter &&
					s.loss === preset.loss,
			);
		}
	};
	children.push(presets);
	root.replaceChildren(...children);
	root.hidden = !visible;

	// вимірювання йдуть і при схованій панелі
	const offs = [
		session.listen("snapshot", () => stats.snapshot(performance.now())),
		session.listen("pong", (pong) => stats.pong(pong.rtt)),
		session.listen("netsim", (s) => {
			presets.hidden = !s.enabled;
			markActive(s);
		}),
	];
	signal.addEventListener(
		"abort",
		() => {
			for (const off of offs) off();
		},
		{ once: true },
	);
	if (session.netsim) {
		presets.hidden = !session.netsim.enabled;
		markActive(session.netsim);
	}

	session.ping();
	const pingTimer = setInterval(() => session.ping(), 1000);

	window.addEventListener(
		"keydown",
		(e) => {
			if (e.code !== "KeyN" || e.repeat) return;
			if (e.ctrlKey || e.metaKey || e.altKey) return;
			if (document.activeElement !== document.body) return; // друкуємо в полі
			root.hidden = !root.hidden;
		},
		{ signal },
	);

	let lastDraw = 0;
	let lastText = "";

	return {
		update(time: number = performance.now()): void {
			if (root.hidden || time - lastDraw < REFRESH_MS) return;
			lastDraw = time;
			stats.sample(session.traffic, time);
			const r = stats.read(time);
			const next = formatNet(r, {
				unacked: Math.max(0, session.lastSeq - view.ack),
				tick: view.tick,
				netsim: session.netsim,
				interp: interp?.stats() ?? null,
			});
			if (next !== lastText) {
				text.textContent = next;
				lastText = next;
			}
			drawGraph(graph, r.intervals);
		},
		dispose(): void {
			clearInterval(pingTimer);
			ac.abort();
		},
	};
}

export type Netgraph = ReturnType<typeof mountNetgraph>;
