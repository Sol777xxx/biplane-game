// Вимірювання продуктивності клієнта (лаб 7). Вимкнене за замовчуванням: без ?perf у адресі
// begin/end/frame це порожні функції, тож звичайна гра нічого не платить.
//   ?perf        кільцеві буфери тривалостей: дешево, не створює об'єктів на кадр
//   ?perf=marks  додатково performance.mark/measure: спани видно на треку Timings у DevTools
// Підсумок: window.perfStats.dump() (у консолі або з Playwright).

export const SPANS = ["simulate", "render", "decode", "reconcile"] as const;
export type Span = (typeof SPANS)[number];

export const FRAME_BUDGET_MS = 1000 / 60;

export interface PerfSummary {
	readonly n: number;
	readonly avg: number;
	readonly p50: number;
	readonly p95: number;
	readonly p99: number;
	readonly max: number;
}

export interface PerfDump {
	readonly frame: PerfSummary;
	readonly slowFrames: number; // кадри довші за 16.7 мс
	readonly spans: Readonly<Record<Span, PerfSummary>>;
	readonly heapUsed: number | null; // лише Chrome (performance.memory)
}

export interface Perf {
	readonly enabled: boolean;
	begin(span: Span): void;
	end(span: Span): void;
	// тривалість роботи одного кадру, мс
	frame(ms: number): void;
	dump(): PerfDump | null;
	reset(): void;
}

export interface PerfOptions {
	readonly enabled?: boolean;
	readonly marks?: boolean;
	readonly now?: () => number;
	readonly size?: number; // записів у кожному буфері
}

const r3 = (v: number): number => Math.round(v * 1000) / 1000;
const EMPTY: PerfSummary = { n: 0, avg: 0, p50: 0, p95: 0, p99: 0, max: 0 };

class Ring {
	readonly #buf: Float64Array;
	#count = 0;
	#next = 0;

	constructor(size: number) {
		this.#buf = new Float64Array(size);
	}

	add(v: number): void {
		this.#buf[this.#next] = v;
		this.#next = (this.#next + 1) % this.#buf.length;
		if (this.#count < this.#buf.length) this.#count++;
	}

	clear(): void {
		this.#count = 0;
		this.#next = 0;
	}

	summary(): PerfSummary {
		const n = this.#count;
		if (n === 0) return EMPTY;
		const xs = Array.from(this.#buf.subarray(0, n)).sort((a, b) => a - b);
		const at = (q: number): number =>
			xs[Math.min(n - 1, Math.ceil(q * n) - 1)] ?? 0;
		return {
			n,
			avg: r3(xs.reduce((a, b) => a + b, 0) / n),
			p50: r3(at(0.5)),
			p95: r3(at(0.95)),
			p99: r3(at(0.99)),
			max: r3(xs[n - 1] ?? 0),
		};
	}
}

const NOOP: Perf = Object.freeze({
	enabled: false,
	begin: () => undefined,
	end: () => undefined,
	frame: () => undefined,
	dump: () => null,
	reset: () => undefined,
});

// імена міток обчислюються один раз: конкатенація рядка на кожен виклик теж алокація
const START = Object.fromEntries(SPANS.map((s) => [s, `${s}:start`])) as Record<
	Span,
	string
>;
const END = Object.fromEntries(SPANS.map((s) => [s, `${s}:end`])) as Record<
	Span,
	string
>;
const CLEAR_EVERY = 600; // кадрів між очищеннями буфера User Timing

export function createPerf({
	enabled = false,
	marks = false,
	now = () => performance.now(),
	size = 4096,
}: PerfOptions = {}): Perf {
	if (!enabled) return NOOP;

	const rings = Object.fromEntries(
		SPANS.map((s) => [s, new Ring(size)]),
	) as Record<Span, Ring>;
	const starts = Object.fromEntries(SPANS.map((s) => [s, 0])) as Record<
		Span,
		number
	>;
	const frames = new Ring(size);
	let slow = 0;
	let frameCount = 0;

	return {
		enabled: true,
		begin(span) {
			if (marks) performance.mark(START[span]);
			starts[span] = now();
		},
		end(span) {
			rings[span].add(now() - starts[span]);
			if (marks) {
				performance.mark(END[span]);
				performance.measure(span, START[span], END[span]);
			}
		},
		frame(ms) {
			frames.add(ms);
			if (ms > FRAME_BUDGET_MS) slow++;
			// без очищення User Timing накопичує записи й сам створює тиск на GC
			if (marks && ++frameCount % CLEAR_EVERY === 0) {
				performance.clearMarks();
				performance.clearMeasures();
			}
		},
		dump() {
			const heap: unknown = Reflect.get(performance, "memory");
			const used =
				typeof heap === "object" && heap !== null
					? Reflect.get(heap, "usedJSHeapSize")
					: null;
			return {
				frame: frames.summary(),
				slowFrames: slow,
				spans: Object.fromEntries(
					SPANS.map((s) => [s, rings[s].summary()]),
				) as Record<Span, PerfSummary>,
				heapUsed: typeof used === "number" ? used : null,
			};
		},
		reset() {
			for (const s of SPANS) rings[s].clear();
			frames.clear();
			slow = 0;
			frameCount = 0;
		},
	};
}

// глобальний екземпляр: модулі (connection, main) беруть його без передавання по параметрах
const flag =
	typeof location === "undefined"
		? null
		: new URLSearchParams(location.search).get("perf");
export const perf: Perf = createPerf({
	enabled: flag !== null,
	marks: flag === "marks",
});
