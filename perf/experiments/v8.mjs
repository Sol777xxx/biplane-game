// «Prove it» (лаб 7): три твердження про V8 і fast-check, перевірені числами.
//
//   node --allow-natives-syntax perf/experiments/v8.mjs
//
// Нативи V8 (%HaveSameMap, %HasFastProperties) це синтаксична помилка без прапорця, тому
// викликаємо їх через new Function: файл лишається звичайним JS для лінтера.
import { mkdirSync, writeFileSync } from "node:fs";
import * as fc from "fast-check";

const natives = (() => {
	try {
		return {
			sameMap: new Function("a", "b", "return %HaveSameMap(a, b)"),
			fast: new Function("o", "return %HasFastProperties(o)"),
		};
	} catch {
		return null;
	}
})();
const out = {};

// 1. Прихована форма (hidden class): поле, додане після конструктора, дає іншу форму.
// У Entity було `life?: number` без ініціалізації: поведінка lifetime додає його пізніше.
{
	class Late {
		constructor() {
			this.x = 0;
			this.y = 0;
		}
	}
	class Declared {
		constructor() {
			this.x = 0;
			this.y = 0;
			this.life = undefined;
		}
	}
	const lateA = new Late();
	const lateB = new Late();
	lateB.life = 1; // додано після конструктора
	const declA = new Declared();
	const declB = new Declared();
	declB.life = 1; // те саме поле, але воно вже було у формі
	out.hiddenClass = natives
		? {
				lateAddedSameShape: natives.sameMap(lateA, lateB),
				declaredSameShape: natives.sameMap(declA, declB),
			}
		: "потрібен --allow-natives-syntax";

	// ціна: поліморфна функція бачить дві форми замість однієї
	const N = 3_000_000;
	const sum = (list) => {
		let s = 0;
		for (let i = 0; i < list.length; i++) s += list[i].x + (list[i].life ?? 0);
		return s;
	};
	const mixed = Array.from({ length: 1000 }, (_, i) => {
		const e = new Late();
		if (i % 2) e.life = 1;
		return e;
	});
	const uniform = Array.from({ length: 1000 }, (_, i) => {
		const e = new Declared();
		if (i % 2) e.life = 1;
		return e;
	});
	const time = (list) => {
		for (let i = 0; i < 2000; i++) sum(list); // розігрів
		const t0 = performance.now();
		for (let i = 0; i < N / 1000; i++) sum(list);
		return Math.round((performance.now() - t0) * 10) / 10;
	};
	out.hiddenClass_sumMs = {
		twoShapes: time(mixed),
		oneShape: time(uniform),
		note: "різниця форм доведена нативом; чи видно її в часі, залежить від прогріву (дві форми це ще мономорфно-поліморфний inline cache), тож дивіться на обидва числа, а не лише на одне",
	};
}

// 2. Мільйон об'єктів: масив структур проти паралельних Float64Array.
{
	const N = 1_000_000;
	const heap = () => {
		globalThis.gc?.();
		return process.memoryUsage().heapUsed;
	};
	const before = heap();
	let t0 = performance.now();
	const objs = Array.from({ length: N }, (_, i) => ({ x: i, y: i * 2 }));
	const objMs = performance.now() - t0;
	const objBytes = heap() - before;
	let acc = 0;
	t0 = performance.now();
	for (const o of objs) acc += o.x + o.y;
	const objSumMs = performance.now() - t0;
	objs.length = 0;

	const before2 = heap();
	t0 = performance.now();
	const xs = new Float64Array(N);
	const ys = new Float64Array(N);
	for (let i = 0; i < N; i++) {
		xs[i] = i;
		ys[i] = i * 2;
	}
	const arrMs = performance.now() - t0;
	const arrBytes = heap() - before2; // сам буфер поза купою JS: купа майже не росте
	t0 = performance.now();
	for (let i = 0; i < N; i++) acc += xs[i] + ys[i];
	const arrSumMs = performance.now() - t0;
	out.millionObjects = {
		objects: {
			createMs: Math.round(objMs),
			sumMs: Math.round(objSumMs),
			heapMb: Math.round(objBytes / 1048576),
		},
		typedArrays: {
			createMs: Math.round(arrMs),
			sumMs: Math.round(arrSumMs),
			heapMb: Math.round(arrBytes / 1048576),
			bufferMb: Math.round((xs.byteLength + ys.byteLength) / 1048576),
		},
		checksum: acc > 0,
		note: globalThis.gc
			? "gc() перед кожним виміром"
			: "без --expose-gc heapMb наближений",
	};
}

// 3. fc.float проти fc.double: float32 має 24 біти мантиси, double 53.
try {
	const sample = (arb) => fc.sample(arb, { numRuns: 20000, seed: 1 });
	const floats = sample(fc.float({ noNaN: true }));
	const doubles = sample(fc.double({ noNaN: true }));
	const exact32 = (xs) =>
		xs.filter((x) => Math.fround(x) === x).length / xs.length;
	out.fastCheck = {
		floatRepresentableInFloat32: exact32(floats),
		doubleRepresentableInFloat32: exact32(doubles),
		floatMaxAbs: floats.reduce((m, x) => Math.max(m, Math.abs(x)), 0),
		doubleMaxAbs: doubles.reduce((m, x) => Math.max(m, Math.abs(x)), 0),
	};
} catch (error) {
	out.fastCheck = { error: String(error) };
}

console.log(JSON.stringify(out, null, "\t"));
mkdirSync("docs/perf", { recursive: true });
writeFileSync(
	"docs/perf/v8-experiments.json",
	`${JSON.stringify(out, null, "\t")}\n`,
);
console.log("\nзбережено: docs/perf/v8-experiments.json");
