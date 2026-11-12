// Детермінований генератор mulberry32: той самий seed дає ту саму послідовність
// і в браузері, і в Node. Seed визначає сервер.
export function mulberry32(seed) {
	let a = seed >>> 0;
	const next = () => {
		a = (a + 0x6d2b79f5) | 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
	// стан потрібен хешу: два генератори збігаються, лише якщо збігаються стани
	next.state = () => a >>> 0;
	return next;
}
