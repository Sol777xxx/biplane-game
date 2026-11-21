// Кільцевий буфер останніх N вимірів: середнє, p50, p95, p99, максимум і розкид (стандартне відхилення).
const r3 = (v: number): number => Math.round(v * 1000) / 1000;

export interface StatsSummary {
	readonly n: number;
	readonly avg: number;
	readonly p50: number;
	readonly p95: number;
	readonly p99: number;
	readonly max: number;
	readonly jitter: number;
}

// nearest-rank на відсортованому масиві
const rank = (sorted: readonly number[], q: number): number =>
	sorted[Math.min(sorted.length - 1, Math.ceil(q * sorted.length) - 1)] ?? 0;

export class RollingStats {
	readonly #buf: Float64Array;
	#count = 0;
	#next = 0;

	constructor(size = 300) {
		this.#buf = new Float64Array(size);
	}

	add(value: number): void {
		this.#buf[this.#next] = value;
		this.#next = (this.#next + 1) % this.#buf.length;
		if (this.#count < this.#buf.length) this.#count++;
	}

	summary(): StatsSummary {
		const n = this.#count;
		if (n === 0)
			return { n: 0, avg: 0, p50: 0, p95: 0, p99: 0, max: 0, jitter: 0 };
		const xs = Array.from(this.#buf.subarray(0, n));
		const avg = xs.reduce((a, b) => a + b, 0) / n;
		const variance = xs.reduce((a, b) => a + (b - avg) ** 2, 0) / n;
		xs.sort((a, b) => a - b);
		return {
			n,
			avg: r3(avg),
			p50: r3(rank(xs, 0.5)),
			p95: r3(rank(xs, 0.95)),
			p99: r3(rank(xs, 0.99)),
			max: r3(xs[n - 1] ?? 0),
			jitter: r3(Math.sqrt(variance)),
		};
	}
}
