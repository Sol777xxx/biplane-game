import {
	monitorEventLoopDelay,
	performance as perfHooks,
} from "node:perf_hooks";
import type { MatchStats } from "./match.ts";

const WINDOW_SAMPLES = 10; // швидкість рахуємо за останні ~10 с
const RESOLUTION_MS = 10;

interface Sample {
	readonly t: number;
	readonly messagesIn: number;
	readonly messagesOut: number;
	readonly bytesIn: number;
	readonly bytesOut: number;
}

// Звідки метрики беруть те, чого самі не рахують
export interface MetricsSources {
	readonly players: () => number;
	readonly rooms: () => number;
	readonly connections: () => number;
	readonly matches: () => readonly MatchStats[];
	readonly gitSha: string;
}

const r3 = (value: number): number => Math.round(value * 1000) / 1000;

type Row = readonly [labels: string, value: number];

// Лічильники трафіку й формат Prometheus (text exposition) для GET /metrics.
// Без prom-client: потрібно кілька десятків рядків тексту, а не бібліотека.
export class Metrics {
	messagesIn = 0;
	messagesOut = 0;
	bytesIn = 0;
	bytesOut = 0;
	readonly #violations = new Map<number, number>(); // код закриття -> скільки разів
	readonly #refused = new Map<string, number>(); // причина відмови рукостискання -> скільки
	readonly #samples: Sample[] = [];
	readonly #loop = monitorEventLoopDelay({ resolution: RESOLUTION_MS });
	#elu = perfHooks.eventLoopUtilization();
	#timer: NodeJS.Timeout | null = null;

	received(bytes: number): void {
		this.messagesIn++;
		this.bytesIn += bytes;
	}

	sent(bytes: number): void {
		this.messagesOut++;
		this.bytesOut += bytes;
	}

	// з'єднання закрито за порушення протоколу (кодом 4000..4009)
	violation(code: number): void {
		this.#violations.set(code, (this.#violations.get(code) ?? 0) + 1);
	}

	upgradeRefused(reason: string): void {
		this.#refused.set(reason, (this.#refused.get(reason) ?? 0) + 1);
	}

	start(): void {
		if (this.#timer) return;
		this.#loop.enable();
		this.#timer = setInterval(() => {
			this.#samples.push(this.#sample());
			if (this.#samples.length > WINDOW_SAMPLES) this.#samples.shift();
		}, 1000);
		this.#timer.unref();
	}

	stop(): void {
		if (this.#timer) clearInterval(this.#timer);
		this.#timer = null;
		this.#loop.disable();
	}

	#sample(): Sample {
		return {
			t: performance.now(),
			messagesIn: this.messagesIn,
			messagesOut: this.messagesOut,
			bytesIn: this.bytesIn,
			bytesOut: this.bytesOut,
		};
	}

	// середня швидкість від найстарішого відліку у вікні до зараз
	rates(): {
		messagesIn: number;
		messagesOut: number;
		bytesIn: number;
		bytesOut: number;
	} {
		const first = this.#samples[0];
		const now = this.#sample();
		const seconds = first ? (now.t - first.t) / 1000 : 0;
		if (!first || seconds <= 0) {
			return { messagesIn: 0, messagesOut: 0, bytesIn: 0, bytesOut: 0 };
		}
		return {
			messagesIn: (now.messagesIn - first.messagesIn) / seconds,
			messagesOut: (now.messagesOut - first.messagesOut) / seconds,
			bytesIn: (now.bytesIn - first.bytesIn) / seconds,
			bytesOut: (now.bytesOut - first.bytesOut) / seconds,
		};
	}

	render(src: MetricsSources): string {
		const out: string[] = [];
		const metric = (
			name: string,
			type: "gauge" | "counter",
			help: string,
			rows: readonly Row[],
		): void => {
			out.push(`# HELP ${name} ${help}`, `# TYPE ${name} ${type}`);
			for (const [labels, value] of rows)
				out.push(`${name}${labels} ${r3(value)}`);
		};

		const matches = src.matches();
		const running = matches.filter((m) => m.running);
		const tickP50 = running.length
			? running.reduce((sum, m) => sum + m.tickMs.p50, 0) / running.length
			: 0;
		const tickP99 = Math.max(0, ...running.map((m) => m.tickMs.p99));
		const lateP99 = Math.max(0, ...running.map((m) => m.lateMs.p99));
		const rate = this.rates();

		// затримка циклу подій: гістограма містить і сам інтервал опитування, тож віднімаємо його
		const delay = (ns: number): number => Math.max(0, ns / 1e6 - RESOLUTION_MS);
		const elu = perfHooks.eventLoopUtilization(this.#elu);
		this.#elu = perfHooks.eventLoopUtilization();
		const loopRows: Row[] = [
			['{quantile="0.5"}', delay(this.#loop.percentile(50))],
			['{quantile="0.99"}', delay(this.#loop.percentile(99))],
			['{quantile="1"}', delay(this.#loop.max)],
		];
		this.#loop.reset();
		const mem = process.memoryUsage();

		metric("biplane_build_info", "gauge", "Збірка (git SHA у мітці).", [
			[`{sha="${src.gitSha}"}`, 1],
		]);
		metric("biplane_uptime_seconds", "gauge", "Скільки працює процес.", [
			["", process.uptime()],
		]);
		metric("biplane_players", "gauge", "Гравців у всіх кімнатах.", [
			["", src.players()],
		]);
		metric("biplane_rooms", "gauge", "Кімнат на сервері.", [["", src.rooms()]]);
		metric("biplane_matches_running", "gauge", "Матчів, що рахуються зараз.", [
			["", running.length],
		]);
		metric("biplane_ws_connections", "gauge", "Відкритих WebSocket-з'єднань.", [
			["", src.connections()],
		]);
		metric("biplane_messages_total", "counter", "Повідомлень WebSocket.", [
			['{direction="in"}', this.messagesIn],
			['{direction="out"}', this.messagesOut],
		]);
		metric("biplane_bytes_total", "counter", "Байтів WebSocket-кадрів.", [
			['{direction="in"}', this.bytesIn],
			['{direction="out"}', this.bytesOut],
		]);
		metric(
			"biplane_messages_per_second",
			"gauge",
			"Повідомлень за секунду (вікно ~10 с).",
			[
				['{direction="in"}', rate.messagesIn],
				['{direction="out"}', rate.messagesOut],
			],
		);
		metric(
			"biplane_bytes_per_second",
			"gauge",
			"Байтів за секунду (вікно ~10 с).",
			[
				['{direction="in"}', rate.bytesIn],
				['{direction="out"}', rate.bytesOut],
			],
		);
		metric(
			"biplane_ws_violations_total",
			"counter",
			"З'єднань закрито за порушення протоколу, за кодом закриття.",
			[...this.#violations].map(([code, n]) => [`{code="${code}"}`, n]),
		);
		metric(
			"biplane_ws_upgrades_refused_total",
			"counter",
			"Відхилених рукостискань WebSocket, за причиною.",
			[...this.#refused].map(([reason, n]) => [`{reason="${reason}"}`, n]),
		);
		metric(
			"biplane_tick_ms",
			"gauge",
			"Час кроку гри, мс (p50 усереднено по матчах, p99 найгірший).",
			[
				['{quantile="0.5"}', tickP50],
				['{quantile="0.99"}', tickP99],
			],
		);
		metric(
			"biplane_tick_late_ms",
			"gauge",
			"Запізнення тіку відносно графіка, мс (p99, найгірший матч).",
			[["", lateP99]],
		);
		metric(
			"biplane_tick_overruns",
			"gauge",
			"Тіки довші за інтервал, сума по матчах.",
			[["", matches.reduce((sum, m) => sum + m.overruns, 0)]],
		);
		metric(
			"biplane_event_loop_utilization",
			"gauge",
			"Зайнятість циклу подій від 0 до 1 (від попереднього читання).",
			[["", elu.utilization]],
		);
		metric(
			"biplane_event_loop_delay_ms",
			"gauge",
			"Затримка циклу подій, мс (від попереднього читання).",
			loopRows,
		);
		metric("biplane_memory_bytes", "gauge", "Пам'ять процесу.", [
			['{type="rss"}', mem.rss],
			['{type="heap_used"}', mem.heapUsed],
			['{type="heap_total"}', mem.heapTotal],
			['{type="external"}', mem.external],
		]);
		return `${out.join("\n")}\n`;
	}
}
