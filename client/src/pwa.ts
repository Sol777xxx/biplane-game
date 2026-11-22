// Реєструє service worker (client/public/sw.js), щоб гру можна було встановити на телефон.
// Лише в зібраному застосунку: у dev-режимі Vite він кешував би модулі, що постійно змінюються.
export function registerServiceWorker(): void {
	const env = (import.meta as { env?: { PROD?: boolean } }).env;
	if (!env?.PROD || !("serviceWorker" in navigator)) return;
	window.addEventListener("load", () => {
		navigator.serviceWorker.register("/sw.js").catch((error: unknown) => {
			console.warn("service worker не зареєстровано:", error);
		});
	});
}
