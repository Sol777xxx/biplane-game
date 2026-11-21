// «Prove it» (лаб 7), досліди 1 і 2
//   1. змусити V8 оптимізувати додавання, потім викликати зі рядками й побачити деоптимізацію;
//   2. скласти x у мільйоні звичайних об'єктів, у тих самих, де кожен десятий має ще й z, і в Float32Array.
//
//   node --allow-natives-syntax perf/experiments/optimize.mjs
//   node --allow-natives-syntax --trace-opt --trace-deopt perf/experiments/optimize.mjs   (рядки V8 про оптимізацію й причину деопту)
//
// Нативи (%…) це синтаксична помилка без прапорця, тому їх викликаємо через new Function.
import { mkdirSync, writeFileSync } from "node:fs";

let prepare;
let optimizeNext;
let statusOf;
try {
	prepare = new Function("f", "%PrepareFunctionForOptimization(f)");
	optimizeNext = new Function("f", "%OptimizeFunctionOnNextCall(f)");
	statusOf = new Function("f", "return %GetOptimizationStatus(f)");
} catch {
	console.error(
		"Потрібен прапорець: node --allow-natives-syntax perf/experiments/optimize.mjs",
	);
	process.exit(1);
}

// Біти %GetOptimizationStatus (V8 13, src/runtime/runtime.h). Порядок може відрізнятися в іншій
// версії V8, тому поруч друкуємо й сире число та його двійковий запис.
const BITS = [
	"IsFunction",
	"NeverOptimize",
	"AlwaysOptimize",
	"MaybeDeopted",
	"Optimized",
	"Maglevved",
	"TurboFanned",
	"Interpreted",
	"MarkedForOptimization",
	"MarkedForConcurrentOptimization",
	"OptimizingConcurrently",
	"IsExecuting",
	"TopmostFrameIsTurboFanned",
	"LiteMode",
	"MarkedForDeoptimization",
	"Baseline",
	"TopmostFrameIsInterpreted",
	"TopmostFrameIsBaseline",
	"IsLazy",
	"TopmostFrameIsMaglev",
];
const decode = (n) => BITS.filter((_, i) => n & (1 << i));
const snapshot = (step, f) => {
	const n = statusOf(f);
	const row = { step, status: n, binary: n.toString(2), bits: decode(n) };
	console.log(
		`${step.padEnd(34)} status=${String(n).padEnd(6)} ${row.bits.join(", ")}`,
	);
	return row;
};

// ---- 1. оптимізація й деоптимізація ----
function add(a, b) {
	return a + b;
}
const deopt = [];
prepare(add);
deopt.push(snapshot("щойно створена", add));
add(1, 2);
add(2, 3);
deopt.push(snapshot("після двох викликів із числами", add));
optimizeNext(add);
add(3, 4);
deopt.push(snapshot("після %OptimizeFunctionOnNextCall", add));
const concatenated = add("a", "b"); // раніше бачила лише числа: оптимізований код це не передбачав
deopt.push(snapshot("після виклику зі рядками", add));
add(5, 6);
deopt.push(snapshot("знову з числами", add));
console.log(`add("a", "b") = ${JSON.stringify(concatenated)}`);

// ---- 2. мільйон об'єктів проти Float32Array ----
const N = 1_000_000;
const plain = Array.from({ length: N }, (_, i) => ({ x: i, y: i }));
const mixed = Array.from({ length: N }, (_, i) =>
	i % 10 === 0 ? { x: i, y: i, z: i } : { x: i, y: i },
);
const typed = new Float32Array(N);
for (let i = 0; i < N; i++) typed[i] = i;

// окрема функція на кожен варіант: інакше зворотний зв'язок одного варіанта псує вимір іншого
const makeSumObjects = () => (list) => {
	let s = 0;
	for (let i = 0; i < list.length; i++) s += list[i].x;
	return s;
};
const makeSumTyped = () => (arr) => {
	let s = 0;
	for (let i = 0; i < arr.length; i++) s += arr[i];
	return s;
};
function median(fn, data) {
	for (let i = 0; i < 3; i++) fn(data); // розігрів
	const times = [];
	let sink = 0;
	for (let i = 0; i < 9; i++) {
		const t0 = performance.now();
		sink += fn(data);
		times.push(performance.now() - t0);
	}
	if (sink < 0) console.log(sink); // щоб результат не викинули як невикористаний
	times.sort((a, b) => a - b);
	return Math.round((times[4] ?? 0) * 100) / 100;
}
const sums = {
	plainObjectsMs: median(makeSumObjects(), plain),
	everyTenthHasZMs: median(makeSumObjects(), mixed),
	float32ArrayMs: median(makeSumTyped(), typed),
};
console.log("\nсума x по 1 000 000 елементів, медіана з 9 запусків, мс:");
console.log(sums);

mkdirSync("docs/perf", { recursive: true });
writeFileSync(
	"docs/perf/prove-it.json",
	`${JSON.stringify({ node: process.version, v8: process.versions.v8, deopt, sums }, null, "\t")}\n`,
);
console.log("\nзбережено: docs/perf/prove-it.json");
