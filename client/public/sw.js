// Service worker: потрібен, щоб гру можна було встановити як застосунок, і щоб оболонка
// (HTML, скрипти, стилі) відкривалась навіть без мережі. Грати офлайн неможливо: це
// багатокористувацька гра, тож без сервера користувач побачить лобі з помилкою з'єднання.
//
// Стратегія "спершу мережа": онлайн завжди беремо свіже, а кеш лише запасний варіант.
// Живі дані (/api, /ws, /health, /ready, /metrics) у кеш не потрапляють ніколи.
const CACHE = "biplane-shell-v1";
const LIVE = /^\/(api|ws|health|ready|metrics)(\/|$)/;

self.addEventListener("install", (event) => {
	event.waitUntil(
		caches
			.open(CACHE)
			.then((cache) => cache.add("/"))
			.then(() => self.skipWaiting()),
	);
});

self.addEventListener("activate", (event) => {
	event.waitUntil(
		caches
			.keys()
			.then((keys) =>
				Promise.all(
					keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)),
				),
			)
			.then(() => self.clients.claim()),
	);
});

self.addEventListener("fetch", (event) => {
	const { request } = event;
	const url = new URL(request.url);
	if (request.method !== "GET" || url.origin !== self.location.origin) return;
	if (LIVE.test(url.pathname)) return;

	event.respondWith(
		fetch(request)
			.then((response) => {
				if (response.ok) {
					const copy = response.clone();
					event.waitUntil(
						caches.open(CACHE).then((cache) => cache.put(request, copy)),
					);
				}
				return response;
			})
			.catch(async () => {
				const cached = await caches.match(request);
				if (cached) return cached;
				// навігація без мережі: віддаємо оболонку застосунку
				if (request.mode === "navigate")
					return (await caches.match("/")) ?? Response.error();
				return Response.error();
			}),
	);
});
