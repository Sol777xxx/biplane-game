import { NETSIM_LIMITS } from "biplane-shared/protocol/index.js";

// Штучна мережа для розробки: затримка, розкид і втрати на шляху повідомлень.
//   lag    : затримка RTT, мс. Ділиться порівну між напрямками: у кожен бік lag / 2.
//   jitter : розкид RTT, мс. До кожного напрямку додається випадкове з [-jitter/2, +jitter/2],
//            тож RTT вкладається в lag ± jitter.
//   loss   : % втрат. Губляться лише повідомлення з lossy: true (snapshot і input);
//            керування (join, chat, ping...) не губиться, бо TCP справжнього сокета їх теж не губить.
// Порядок повідомлень у кожному напрямку зберігається (WebSocket іде по TCP і не переставляє
// кадри): повідомлення, якому випав менший розкид, чекає за попереднім. Для цього в кожного
// напрямку одна черга й один таймер, а не окремий setTimeout на повідомлення.

const clamp = (value, [min, max]) => Math.min(max, Math.max(min, value));
const fix = (value, limits) =>
	typeof value === "number" && Number.isFinite(value)
		? clamp(value, limits)
		: 0;

// "100", "2.5": лише невід'ємні числа до 4 цифр; усе інше це 0
function fromText(raw, limits) {
	if (raw === null || !/^\d{1,4}(\.\d{1,2})?$/.test(raw)) return 0;
	return clamp(Number(raw), limits);
}

// параметри з адреси сокета: /ws?lag=100&jitter=30&loss=2
export function parseNetsimUrl(url) {
	const params = new URL(url, "http://x").searchParams;
	return {
		lag: fromText(params.get("lag"), NETSIM_LIMITS.lag),
		jitter: fromText(params.get("jitter"), NETSIM_LIMITS.jitter),
		loss: fromText(params.get("loss"), NETSIM_LIMITS.loss),
	};
}

export class NetSim {
	#lag = 0;
	#jitter = 0;
	#loss = 0;
	#random;
	#now;
	#setTimer;
	#clearTimer;
	#onError;
	#queues = { in: [], out: [] };
	#timers = { in: null, out: null };
	#last = { in: 0, out: 0 }; // найпізніший призначений час: нижче нього не опускаємось
	dropped = 0;
	delayed = 0;

	constructor({
		lag = 0,
		jitter = 0,
		loss = 0,
		random = Math.random,
		now = () => performance.now(),
		setTimer = setTimeout,
		clearTimer = clearTimeout,
		onError,
	} = {}) {
		this.#random = random;
		this.#now = now;
		this.#setTimer = setTimer;
		this.#clearTimer = clearTimer;
		this.#onError = onError;
		this.set({ lag, jitter, loss });
	}

	get settings() {
		return { lag: this.#lag, jitter: this.#jitter, loss: this.#loss };
	}

	get active() {
		return this.#lag > 0 || this.#jitter > 0 || this.#loss > 0;
	}

	// замінює всі три значення: відсутнє стає нулем
	set({ lag, jitter, loss } = {}) {
		this.#lag = fix(lag, NETSIM_LIMITS.lag);
		this.#jitter = fix(jitter, NETSIM_LIMITS.jitter);
		this.#loss = fix(loss, NETSIM_LIMITS.loss);
	}

	// Повертає true, якщо fn виконано або поставлено в чергу, false, якщо повідомлення втрачено.
	inbound(fn, { lossy = false } = {}) {
		return this.#run("in", fn, lossy);
	}

	outbound(fn, { lossy = false } = {}) {
		return this.#run("out", fn, lossy);
	}

	#run(dir, fn, lossy) {
		const queue = this.#queues[dir];
		// вимкнено й нічого не чекає: виконуємо одразу, без жодних накладних витрат
		if (!this.active && queue.length === 0) {
			this.#call(fn);
			return true;
		}
		if (lossy && this.#loss > 0 && this.#random() * 100 < this.#loss) {
			this.dropped++;
			return false;
		}

		const now = this.#now();
		const spread = (this.#random() * 2 - 1) * (this.#jitter / 2);
		const wanted = now + Math.max(0, this.#lag / 2 + spread);
		const due = Math.max(wanted, this.#last[dir]);
		if (queue.length === 0 && due <= now) {
			this.#call(fn);
			return true;
		}

		this.#last[dir] = due;
		queue.push({ due, fn });
		this.delayed++;
		this.#arm(dir, now);
		return true;
	}

	#arm(dir, now) {
		if (this.#timers[dir] !== null) return;
		const head = this.#queues[dir][0];
		if (!head) return;
		const delay = Math.max(0, Math.ceil(head.due - now));
		this.#timers[dir] = this.#setTimer(() => this.#drain(dir), delay);
	}

	#drain(dir) {
		this.#timers[dir] = null;
		const queue = this.#queues[dir];
		const now = this.#now();
		while (queue.length > 0 && queue[0].due <= now)
			this.#call(queue.shift().fn);
		// таймер міг спрацювати на мілісекунду раніше: тоді ставимо наступний
		this.#arm(dir, this.#now());
	}

	// виняток в одному повідомленні не має зупиняти решту черги
	#call(fn) {
		try {
			fn();
		} catch (error) {
			this.#onError?.(error);
		}
	}

	dispose() {
		for (const dir of ["in", "out"]) {
			if (this.#timers[dir] !== null) this.#clearTimer(this.#timers[dir]);
			this.#timers[dir] = null;
			this.#queues[dir].length = 0;
		}
	}
}
