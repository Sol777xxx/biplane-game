// Кільцевий буфер останніх N вимірів: середнє, p95, максимум і розкид (стандартне відхилення).
const r3 = (v) => Math.round(v * 1000) / 1000;

export class RollingStats {
	#buf;
	#count = 0;
	#next = 0;

	constructor(size = 300) {
		this.#buf = new Float64Array(size);
	}

	add(value) {
		this.#buf[this.#next] = value;
		this.#next = (this.#next + 1) % this.#buf.length;
		if (this.#count < this.#buf.length) this.#count++;
	}

	summary() {
		const n = this.#count;
		if (n === 0) return { n: 0, avg: 0, p95: 0, max: 0, jitter: 0 };
		const xs = Array.from(this.#buf.subarray(0, n));
		const avg = xs.reduce((a, b) => a + b, 0) / n;
		const variance = xs.reduce((a, b) => a + (b - avg) ** 2, 0) / n;
		xs.sort((a, b) => a - b);
		return {
			n,
			avg: r3(avg),
			p95: r3(xs[Math.min(n - 1, Math.ceil(0.95 * n) - 1)]),
			max: r3(xs[n - 1]),
			jitter: r3(Math.sqrt(variance)),
		};
	}
}
