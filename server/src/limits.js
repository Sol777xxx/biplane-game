// Token bucket: у відрі до `capacity` токенів, поповнюється `refillPerSec` токенів за секунду.
// Дозволяє короткий сплеск (відро повне) і обмежує середню швидкість.
// Годинник підміняється в тестах, за замовчуванням монотонний performance.now().
export class TokenBucket {
	#capacity;
	#refillPerMs;
	#now;
	#tokens;
	#last;

	constructor({ capacity, refillPerSec, now = () => performance.now() }) {
		if (!(capacity >= 1) || !(refillPerSec > 0)) {
			throw new RangeError("capacity ≥ 1 і refillPerSec > 0");
		}
		this.#capacity = capacity;
		this.#refillPerMs = refillPerSec / 1000;
		this.#now = now;
		this.#tokens = capacity;
		this.#last = now();
	}

	// true: дію дозволено (токен списано), false: ліміт вичерпано
	take(cost = 1) {
		const t = this.#now();
		this.#tokens = Math.min(
			this.#capacity,
			this.#tokens + (t - this.#last) * this.#refillPerMs,
		);
		this.#last = t;
		if (this.#tokens < cost) return false;
		this.#tokens -= cost;
		return true;
	}
}
