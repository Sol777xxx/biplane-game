import { setTimeout as sleep } from "node:timers/promises";

export async function waitFor(condition, ms = 1500) {
	const end = Date.now() + ms;
	while (!condition()) {
		if (Date.now() > end) throw new Error("waitFor: час вийшов");
		await sleep(5);
	}
}

// Повідомлення chat від сервера у правильній формі: Connection відкидає все, що не
// проходить схему протоколу, тож тестам не годиться скорочений { type, text }.
export const chatMsg = (text) => ({
	v: 1,
	type: "chat",
	t: 0,
	from: "p1",
	name: "Оля",
	text,
});
