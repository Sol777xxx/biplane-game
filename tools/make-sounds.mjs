// Синтез звуків без зовнішніх файлів: node tools/make-sounds.mjs → public/assets/*.wav
import { mkdirSync, writeFileSync } from "node:fs";

const RATE = 44100;

function wav(samples) {
	const data = Buffer.alloc(samples.length * 2);
	samples.forEach((v, i) => {
		data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, v)) * 32767), i * 2);
	});
	const h = Buffer.alloc(44);
	h.write("RIFF", 0);
	h.writeUInt32LE(36 + data.length, 4);
	h.write("WAVEfmt ", 8);
	h.writeUInt32LE(16, 16);
	h.writeUInt16LE(1, 20); // PCM
	h.writeUInt16LE(1, 22); // mono
	h.writeUInt32LE(RATE, 24);
	h.writeUInt32LE(RATE * 2, 28);
	h.writeUInt16LE(2, 32);
	h.writeUInt16LE(16, 34);
	h.write("data", 36);
	h.writeUInt32LE(data.length, 40);
	return Buffer.concat([h, data]);
}

function render(seconds, fn) {
	const n = Math.floor(seconds * RATE);
	return Array.from({ length: n }, (_, i) => fn(i / RATE, i / n));
}

// простий генератор шуму з фіксованим зерном, щоб файли були відтворюваними
let seed = 12345;
const noise = () => {
	seed = (seed * 16807) % 2147483647;
	return (seed / 2147483647) * 2 - 1;
};

// постріл: 
const TAU = 2 * Math.PI;
// короткий плавний вхід, щоб не було клацання на початку звуку
const attack = (t, ms) => Math.min(1, t / (ms / 1000));
// нормалізація гучності до 0.8 від максимуму
const norm = (s) => {
	const peak = Math.max(...s.map(Math.abs)) || 1;
	return s.map((v) => (v / peak) * 0.8);
};

// постріл: м'яке «блюп», тон плавно йде вгору (змініть 380 і 600, щоб тон став вищим чи нижчим)
let ph = 0;
const shoot = norm(
	render(0.13, (t, k) => {
		ph += (TAU * (380 + 600 * Math.sqrt(k))) / RATE;
		return (
			(Math.sin(ph) * 0.6 + Math.sin(ph * 2) * 0.12) *
			attack(t, 3) *
			(1 - k) ** 1.5
		);
	}),
);

// влучання: «дзінь» дзвіночка з трьох гармонік (988 Гц, змінюйте для іншої висоти)
const hit = norm(
	render(0.25, (t) => {
		const bell =
			Math.sin(TAU * 988 * t) * 0.5 +
			Math.sin(TAU * 1480 * t) * 0.3 +
			Math.sin(TAU * 2217 * t) * 0.12;
		return (bell + noise() * 0.15 * Math.exp(-t * 200)) * Math.exp(-t * 28);
	}),
);

// вибух: м'який «пуф»: низький удар + згладжений шум, що швидко затихає
ph = 0;
let lp = 0;
const explosion = norm(
	render(0.6, (t, k) => {
		ph += (TAU * (40 + 90 * Math.exp(-t * 6))) / RATE;
		lp += (0.25 - 0.2 * k) * (noise() - lp);
		return (
			(lp * 2.2 * Math.exp(-t * 5) + Math.sin(ph) * 0.7 * Math.exp(-t * 4)) *
			attack(t, 3) *
			(1 - k)
		);
	}),
);

mkdirSync("public/assets", { recursive: true });
for (const [name, s] of Object.entries({ shoot, hit, explosion })) {
	writeFileSync(`public/assets/${name}.wav`, wav(s));
	console.log(`public/assets/${name}.wav  ${(s.length / RATE).toFixed(2)} с`);
}