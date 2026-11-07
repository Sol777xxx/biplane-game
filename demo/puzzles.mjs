// П'ять головоломок порядку мікрозадач і задач. Запуск: node demo/puzzles.mjs
// Кожна головоломка друкує свій рядок, коли завершується.
const out = [];
const log = (s) => out.push(s);
const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

async function p1() {
	log("1: sync-1");
	setTimeout(() => log("1: timeout"), 0);
	Promise.resolve().then(() => log("1: then"));
	log("1: sync-2");
}

async function p2() {
	async function f() {
		log("2: f-start");
		await null;
		log("2: f-after-await");
	}
	f();
	Promise.resolve().then(() => log("2: then"));
	log("2: sync");
}

async function p3() {
	Promise.resolve()
		.then(() => {
			log("3: then-1");
			setTimeout(() => log("3: timeout-in-then"), 0);
			Promise.resolve().then(() => log("3: nested-then"));
		})
		.then(() => log("3: then-2"));
	setTimeout(() => log("3: timeout-outer"), 0);
}

async function p4() {
	const p = new Promise((resolve) => {
		log("4: executor");
		resolve("ok");
		log("4: after-resolve");
	});
	p.then((v) => log(`4: then ${v}`));
	await p;
	log("4: after-await");
	queueMicrotask(() => log("4: microtask"));
}

async function p5() {
	// у браузері тут requestAnimationFrame; у Node його немає, тож ~16 мс таймер
	setTimeout(() => log("5: frame"), 16);
	setTimeout(() => log("5: timeout-0"), 0);
	await Promise.resolve();
	log("5: after-await");
}

for (const p of [p1, p2, p3, p4, p5]) {
	out.length = 0;
	await p();
	await tick(40);
	console.log(out.join("\n"), "\n");
}
