// Пайплайн ассетів: fetch + перевірка ok, retry з backoff і jitter, loadAll з прогресом.
// Модуль не залежить від DOM у момент імпорту (createImageBitmap викликається лише в loadImage),
// тож його можна тестувати в Node.
import { z } from "zod";

export class HttpError extends Error {
	readonly status: number;
	readonly url: string;

	constructor(status: number, url: string) {
		super(`HTTP ${status} для ${url}`);
		this.name = "HttpError";
		this.status = status;
		this.url = url;
	}
}

export interface FetchOptions {
	readonly signal?: AbortSignal;
	readonly timeoutMs?: number;
}

// fetch, який перетворює HTTP-помилки на відхилений проміс.
// Таймаут діє на весь запит разом із читанням тіла, бо сигнал передано у fetch.
export async function fetchResponse(
	url: string,
	{ signal, timeoutMs = 8000 }: FetchOptions = {},
): Promise<Response> {
	const timeout = AbortSignal.timeout(timeoutMs);
	const res = await fetch(url, {
		signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
	});
	if (!res.ok) throw new HttpError(res.status, url);
	return res;
}

// Єдина точка читання JSON: ok перевіряється тут, у решті коду fetch напряму не викликаємо.
// Результат unknown: те, що прийшло з мережі, спершу перевіряє схема (див. manifestSchema).
export async function fetchJson(
	url: string,
	opts?: FetchOptions,
): Promise<unknown> {
	const res = await fetchResponse(url, opts);
	return res.json(); // SyntaxError для битого JSON
}

export const loadJson = fetchJson;

// ImageBitmap замість <img>: той самий fetchResponse, тож 404 справді видно як HttpError
export async function loadImage(
	url: string,
	opts?: FetchOptions,
): Promise<ImageBitmap> {
	const res = await fetchResponse(url, opts);
	const blob = await res.blob();
	opts?.signal?.throwIfAborted();
	return createImageBitmap(blob);
}

// декодування відбувається на екрані завантаження, не під час першого пострілу
export async function loadAudio(
	ctx: Pick<BaseAudioContext, "decodeAudioData">,
	url: string,
	opts?: FetchOptions,
): Promise<AudioBuffer> {
	const res = await fetchResponse(url, opts);
	const data = await res.arrayBuffer();
	const buffer = await ctx.decodeAudioData(data);
	opts?.signal?.throwIfAborted();
	return buffer;
}

// затримка, яку можна скасувати
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
	return new Promise((resolve, reject) => {
		if (signal?.aborted) return reject(signal.reason);
		const onAbort = (): void => {
			clearTimeout(id);
			reject(signal?.reason);
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
export function isRetryable(err: unknown, signal?: AbortSignal): boolean {
	if (signal?.aborted) return false;
	if (err instanceof HttpError) return err.status >= 500;
	if (err instanceof Error && err.name === "TimeoutError") return true;
	return err instanceof TypeError; // fetch відхиляється TypeError при мережевій помилці
}

export interface RetryInfo {
	readonly attempt: number;
	readonly attempts: number;
	readonly delay: number;
	readonly error: unknown;
}

export interface RetryOptions {
	readonly attempts?: number;
	readonly baseMs?: number;
	readonly maxMs?: number;
	readonly signal?: AbortSignal;
	readonly onRetry?: (info: RetryInfo) => void;
	readonly random?: () => number;
}

// exponential backoff з full jitter: пауза = random(0 .. min(maxMs, baseMs * 2^(n-1)))
export async function withRetry<T>(
	fn: (attempt: number) => Promise<T>,
	{
		attempts = 3,
		baseMs = 300,
		maxMs = 5000,
		signal,
		onRetry,
		random = Math.random,
	}: RetryOptions = {},
): Promise<T> {
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

// ---------- маніфест ----------

const assetBase = {
	id: z.string(),
	url: z.string(),
	optional: z.boolean().optional(),
	fallback: z.unknown(), // що віддати замість пропущеного optional-ассета
	timeoutMs: z.number().positive().optional(),
	attempts: z.number().int().positive().optional(),
};

// type це дискримінант: за ним звужується тип запису, а switch у load() тримає never у default
export const manifestSchema = z.object({
	assets: z.array(
		z.discriminatedUnion("type", [
			z.object({ ...assetBase, type: z.literal("image") }),
			z.object({ ...assetBase, type: z.literal("json") }),
			z.object({ ...assetBase, type: z.literal("audio") }),
		]),
	),
});

export type Manifest = z.infer<typeof manifestSchema>;
export type AssetItem = Manifest["assets"][number];

// Перевіряє маніфест, який прийшов з мережі. Кидає ZodError, якщо форма не та.
export const parseManifest = (raw: unknown): Manifest =>
	manifestSchema.parse(raw);

// ---------- завантаження ----------

export type LoadProgress =
	| ({
			readonly type: "retry";
			readonly id: string;
			readonly total: number;
	  } & RetryInfo)
	| {
			readonly type: "item";
			readonly id: string;
			readonly done: number;
			readonly total: number;
			readonly fraction: number;
			readonly failed: boolean;
	  };

export interface LoadFailure {
	readonly id: string;
	readonly url: string;
	readonly error: unknown;
}

export interface LoadResult {
	readonly assets: Record<string, unknown>;
	readonly failures: LoadFailure[];
	readonly ms: number;
}

export interface LoadAllOptions {
	readonly ctx?: Pick<BaseAudioContext, "decodeAudioData">;
	readonly signal?: AbortSignal;
	readonly onProgress?: (e: LoadProgress) => void;
	readonly mode?: "concurrent" | "sequential";
	readonly timeoutMs?: number;
	readonly attempts?: number;
	readonly baseMs?: number;
}

interface Settings {
	readonly ctx: LoadAllOptions["ctx"];
	readonly signal: AbortSignal;
	readonly timeoutMs: number;
	readonly attempts: number;
	readonly baseMs: number;
	readonly onProgress: LoadAllOptions["onProgress"];
	readonly total: number;
}

// Один запис маніфесту → значення. default: never, тож новий тип ассета без гілки це помилка tsc.
function load(
	item: AssetItem,
	o: Settings,
	timeoutMs: number,
): Promise<unknown> {
	const opts: FetchOptions = { signal: o.signal, timeoutMs };
	switch (item.type) {
		case "image":
			return loadImage(item.url, opts);
		case "json":
			return loadJson(item.url, opts);
		case "audio":
			if (!o.ctx)
				throw new Error("для аудіо потрібен AudioContext (опція ctx)");
			return loadAudio(o.ctx, item.url, opts);
		default: {
			const missing: never = item;
			throw new Error(
				`невідомий тип ассета: ${String(Reflect.get(missing, "type"))}`,
			);
		}
	}
}

// Завантажує один запис маніфесту. Для optional повертає fallback замість помилки.
async function settle(
	item: AssetItem,
	o: Settings,
): Promise<{ value: unknown; error?: unknown }> {
	try {
		const value = await withRetry(
			() => load(item, o, item.timeoutMs ?? o.timeoutMs),
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
 * mode "concurrent": усі запити стартують разом (Promise.all)
 * mode "sequential": await у циклі, лише для порівняння часу
 * Якщо обов'язковий ассет упав, Promise.all відхиляється одразу, але решта запитів сама не
 * зупиняється, тому ми скасовуємо їх внутрішнім контролером.
 */
export async function loadAll(
	manifest: Manifest,
	{
		ctx,
		signal,
		onProgress,
		mode = "concurrent",
		timeoutMs = 8000,
		attempts = 3,
		baseMs = 300,
	}: LoadAllOptions = {},
): Promise<LoadResult> {
	const items = manifest.assets;
	const total = items.length;
	const failures: LoadFailure[] = [];
	const assets: Record<string, unknown> = {};
	let done = 0;

	const inner = new AbortController();
	const sig = signal ? AbortSignal.any([signal, inner.signal]) : inner.signal;
	const started = performance.now();

	const settings: Settings = {
		ctx,
		signal: sig,
		timeoutMs,
		attempts,
		baseMs,
		onProgress,
		total,
	};

	// обгортка з прогресом: рахуємо кожен файл окремо
	const track = async (item: AssetItem): Promise<void> => {
		const { value, error } = await settle(item, settings);
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

export const loadAllSequential = (
	manifest: Manifest,
	o?: LoadAllOptions,
): Promise<LoadResult> => loadAll(manifest, { ...o, mode: "sequential" });
