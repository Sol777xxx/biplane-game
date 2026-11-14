import { dumpScenario, traceScenario } from "../sim/scenario.js";

// node tools/hash-trace.mjs        хеші за кроками 1..20
// node tools/hash-trace.mjs 15     ще й стан усіх сутностей після кроку 15
const marks = Array.from({ length: 20 }, (_, i) => i + 1);
console.log(traceScenario({ marks }).join("\n"));
const dump = Number(process.argv[2]);
if (dump > 0) console.log(dumpScenario(dump).join("\n"));
