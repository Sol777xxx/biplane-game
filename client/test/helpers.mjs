import { setTimeout as sleep } from "node:timers/promises";

export async function waitFor(condition, ms = 1500) {
	const end = Date.now() + ms;
	while (!condition()) {
		if (Date.now() > end) throw new Error("waitFor: час вийшов");
		await sleep(5);
	}
}
