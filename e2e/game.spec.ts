import {
	type Browser,
	type BrowserContext,
	expect,
	type Page,
	test,
} from "@playwright/test";

interface Shot {
	readonly mine: boolean;
	readonly pos: { readonly x: number };
}
interface DebugView {
	world: { ofKind(kind: "biplane"): Iterable<Shot> };
}

// Заходить у кімнату room під іменем name; повертає сторінку вже в грі.
async function join(
	context: BrowserContext,
	name: string,
	room: string,
): Promise<Page> {
	const page = await context.newPage();
	await page.goto("/?debug"); // ?debug виставляє window.net для перевірок
	await page.locator("#lobby input[type=text]").fill(name);
	await page.locator(`#lobby input[name=room][value="${room}"]`).check();
	await page.locator("#lobby button.join").click();
	await expect(page.locator("#chat")).toBeVisible({ timeout: 15_000 });
	return page;
}

const roster = (page: Page): Promise<string[]> =>
	page.locator("#chat .chip").allTextContents();

// X першого чужого корабля, який бачить сторінка (null, поки його немає)
const otherShipX = (page: Page): Promise<number | null> =>
	page.evaluate(() => {
		const net: DebugView = Reflect.get(window, "net");
		for (const s of net?.world.ofKind("biplane") ?? []) {
			if (!s.mine) return s.pos.x;
		}
		return null;
	});

async function firstOpenRoom(
	browser: Browser,
	baseURL: string,
): Promise<string> {
	const res = await (await browser.newContext()).request.get(
		`${baseURL}/api/rooms`,
	);
	const { rooms } = (await res.json()) as {
		rooms: { id: string; players: number; max: number }[];
	};
	const room = rooms.find((r) => r.players === 0 && r.max >= 2);
	if (!room) throw new Error("немає порожньої кімнати для e2e");
	return room.id;
}

test.describe("два гравці в одній кімнаті", () => {
	let alice: Page;
	let bob: Page;
	let contexts: BrowserContext[];

	test.beforeEach(async ({ browser, baseURL }) => {
		const room = await firstOpenRoom(browser, baseURL ?? "");
		contexts = [await browser.newContext(), await browser.newContext()];
		const [a, b] = contexts;
		if (!a || !b) throw new Error("контексти не створено");
		alice = await join(a, "Alice", room);
		bob = await join(b, "Bob", room);
	});

	test.afterEach(async () => {
		await Promise.all(contexts.map((c) => c.close()));
	});

	test("обидва бачать однаковий склад гравців", async () => {
		for (const page of [alice, bob]) {
			await expect
				.poll(async () => (await roster(page)).sort())
				.toEqual(["Alice", "Bob"]);
		}
	});

	test("рух Alice видно в Bob за 500 мс", async () => {
		await expect.poll(() => otherShipX(bob)).not.toBeNull();
		const before = await otherShipX(bob);
		if (before === null) throw new Error("корабля Alice немає в Bob");

		const started = Date.now();
		await alice.keyboard.down("ArrowRight");
		await bob.waitForFunction(
			(x0) => {
				const net: DebugView = Reflect.get(window, "net");
				for (const s of net.world.ofKind("biplane")) {
					if (!s.mine) return Math.abs(s.pos.x - x0) > 2;
				}
				return false;
			},
			before,
			{ polling: "raf", timeout: 5_000 },
		);
		const elapsed = Date.now() - started;
		await alice.keyboard.up("ArrowRight");

		expect(elapsed).toBeLessThan(500);
	});

	test("повідомлення чату доходить до іншого гравця", async () => {
		await alice.keyboard.press("Enter"); // Enter поза полем фокусує чат
		await alice.keyboard.type("привіт, Bob");
		await alice.keyboard.press("Enter");

		await expect(bob.locator("#chat .chat-log")).toContainText(
			"Alice: привіт, Bob",
		);
		await expect(alice.locator("#chat .chat-log")).toContainText("привіт, Bob");
	});
});
