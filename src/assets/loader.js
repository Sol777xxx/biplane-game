// Пайплайн ассетів: fetch + перевірка ok, retry з backoff і jitter, loadAll з прогресом.
// Модуль не залежить від DOM у момент імпорту (createImageBitmap викликається лише в loadImage),
// тож його можна тестувати в Node.

export class HttpError extends Error {
	constructor(status, url) {
		super(`HTTP ${status} для ${url}`);
		this.name = "HttpError";
		this.status = status;
		this.url = url;
	}
}

// об'єднує кілька сигналів в один (будь-який спрацював, значить скасовано)
function anySignal(...signals) {
	const real = signals.filter(Boolean);
	return real.length === 1 ? real[0] : AbortSignal.any(real);
}

// fetch, який перетворює HTTP-помилки на відхилений проміс.
// Таймаут діє на весь запит разом із читанням тіла, бо сигнал передано у fetch.
export async function fetchResponse(url, { signal, timeoutMs = 8000 } = {}) {
	const res = await fetch(url, {
		signal: anySignal(signal, AbortSignal.timeout(timeoutMs)),
	});
	if (!res.ok) throw new HttpError(res.status, url);
	return res;
}

// єдина точка читання JSON: ok перевіряється тут, у решті коду fetch напряму не викликаємо
export async function fetchJson(url, opts) {
	const res = await fetchResponse(url, opts);
	return res.json(); // SyntaxError для битого JSON
}

export const loadJson = fetchJson;

// ImageBitmap замість <img>: той самий fetchResponse, тож 404 справді видно як HttpError
export async function loadImage(url, opts) {
	const res = await fetchResponse(url, opts);
	const blob = await res.blob();
	opts?.signal?.throwIfAborted();
	return createImageBitmap(blob);
}

// декодування відбувається на екрані завантаження, не під час першого пострілу
export async function loadAudio(ctx, url, opts) {
	const res = await fetchResponse(url, opts);
	const data = await res.arrayBuffer();
	const buffer = await ctx.decodeAudioData(data);
	opts?.signal?.throwIfAborted();
	return buffer;
}

// затримка, яку можна скасувати
export function sleep(ms, signal) {
	return new Promise((resolve, reject) => {
		if (signal?.aborted) return reject(signal.reason);
		const onAbort = () => {
			clearTimeout(id);
			reject(signal.reason);
		};
		const id = setTimeout(() => {
			signal?.removeEventListener("abort", onAbort);
			resolve();
		}, ms);
		signal?.addEventListener("abort", onAbort, { once: true });
	});
}

// Повторюємо лише тимчасові збої: мережа, таймаут, 5xx.
// 4xx (клієнт сам винен), битий JSON і помилки декодування повтором не лікуються.
export function isRetryable(err, signal) {
	if (signal?.aborted) return false;
	if (err instanceof HttpError) return err.status >= 500;
	if (err?.name === "TimeoutError") return true;
	return err instanceof TypeError; // fetch відхиляється TypeError при мережевій помилці
}

// exponential backoff з full jitter: пауза = random(0 .. min(maxMs, baseMs * 2^(n-1)))
export async function withRetry(
	fn,
	{
		attempts = 3,
		baseMs = 300,
		maxMs = 5000,
		signal,
		onRetry,
		random = Math.random,
	} = {},
) {
	for (let attempt = 1; ; attempt++) {
		signal?.throwIfAborted();
		try {
			return await fn(attempt);
		} catch (error) {
			if (attempt >= attempts || !isRetryable(error, signal)) throw error;
			const delay = random() * Math.min(maxMs, baseMs * 2 ** (attempt - 1));
			onRetry?.({ attempt, attempts, delay, error });
			await sleep(delay, signal);
		}
	}
}

const LOADERS = {
	image: (item, o) => loadImage(item.url, o),
	json: (item, o) => loadJson(item.url, o),
	audio: (item, o) => loadAudio(o.ctx, item.url, o),
};

// Завантажує один запис маніфесту. Для optional повертає fallback замість помилки.
async function settle(item, o) {
	const load = LOADERS[item.type];
	if (!load) throw new Error(`невідомий тип ассета: ${item.type}`);
	try {
		const value = await withRetry(
			() => load(item, { ...o, timeoutMs: item.timeoutMs ?? o.timeoutMs }),
			{
				attempts: item.attempts ?? o.attempts,
				baseMs: o.baseMs,
				signal: o.signal,
				onRetry: (r) =>
					o.onProgress?.({ type: "retry", id: item.id, ...r, total: o.total }),
			},
		);
		return { value };
	} catch (error) {
		if (item.optional && !o.signal.aborted) {
			return { value: item.fallback ?? null, error };
		}
		throw error;
	}
}

/**
 * manifest: { assets: [{ id, type: "image"|"json"|"audio", url, optional?, fallback?, timeoutMs?, attempts? }] }
 * mode "concurrent": усі запити стартують разом (Promise.all)
 * mode "sequential": await у циклі, лише для порівняння часу
 * Якщо обов'язковий ассет упав, Promise.all відхиляється одразу, але решта запитів сама не
 * зупиняється, тому ми скасовуємо їх внутрішнім контролером.
 */
export async function loadAll(
	manifest,
	{
		ctx,
		signal,
		onProgress,
		mode = "concurrent",
		timeoutMs = 8000,
		attempts = 3,
		baseMs = 300,
	} = {},
) {
	const items = manifest.assets;
	const total = items.length;
	const failures = [];
	const assets = {};
	let done = 0;

	const inner = new AbortController();
	const sig = signal ? AbortSignal.any([signal, inner.signal]) : inner.signal;
	const started = performance.now();

	const opts = {
		ctx,
		signal: sig,
		timeoutMs,
		attempts,
		baseMs,
		onProgress,
		total,
	};

	// обгортка з прогресом (розд. 4 теорії): рахуємо кожен файл окремо
	const track = async (item) => {
		const { value, error } = await settle(item, opts);
		assets[item.id] = value;
		if (error) failures.push({ id: item.id, url: item.url, error });
		done++;
		onProgress?.({
			type: "item",
			id: item.id,
			done,
			total,
			fraction: done / total,
			failed: Boolean(error),
		});
		return value;
	};

	try {
		if (mode === "sequential") {
			for (const item of items) await track(item);
		} else {
			await Promise.all(items.map(track));
		}
	} catch (error) {
		inner.abort(error);
		throw error;
	}
	return { assets, failures, ms: performance.now() - started };
}

export const loadAllSequential = (manifest, o) =>
	loadAll(manifest, { ...o, mode: "sequential" });
