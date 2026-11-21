// Збирання профілів із Chromium через CDP. Окремо від session.mjs, щоб перевіряти на будь-якій сторінці.

// Трасування для пауз GC: лише v8 і devtools.timeline, без скріншотів. Накладні витрати малі.
export async function traceGc(browser, page, run) {
	await browser.startTracing(page, {
		categories: ["v8", "devtools.timeline"],
		screenshots: false,
	});
	let result;
	try {
		result = await run();
	} catch (error) {
		await browser.stopTracing(); // трасування не лишаємо ввімкненим
		throw error;
	}
	const buffer = await browser.stopTracing();
	return { result, events: JSON.parse(buffer.toString()).traceEvents ?? [] };
}

// Профіль CPU (.cpuprofile) і вибірковий профіль купи на час run(). Профілювання саме
// сповільнює сторінку, тому часи кадрів із цієї фази це не «чисті» часи.
export async function profile(
	page,
	run,
	{ cpuIntervalUs = 200, heapBytes = 8192 } = {},
) {
	const cdp = await page.context().newCDPSession(page);
	await cdp.send("Profiler.enable");
	await cdp.send("Profiler.setSamplingInterval", { interval: cpuIntervalUs });
	await cdp.send("HeapProfiler.enable");
	await cdp.send("Profiler.start");
	// без цих двох прапорців профіль купи показав би лише об'єкти, що вижили
	await cdp.send("HeapProfiler.startSampling", {
		samplingInterval: heapBytes,
		includeObjectsCollectedByMajorGC: true,
		includeObjectsCollectedByMinorGC: true,
	});
	let result;
	let failure = null;
	try {
		result = await run();
	} catch (error) {
		failure = error;
	}
	const { profile: cpu } = await cdp.send("Profiler.stop");
	const { profile: heap } = await cdp.send("HeapProfiler.stopSampling");
	await cdp.detach();
	if (failure) throw failure;
	return { result, cpu, heap };
}
