// Синтез звуків без зовнішніх файлів: node tools/make-sounds.mjs → public/assets/*.wav
// Сім файлів за іменами з manifest.json. Усі «м'які»: без дзвінких гармонік,
// шум пропущений через фільтр низьких частот, тож хмарка звучить як подушка, а не як залізо.
import { mkdirSync, writeFileSync } from "node:fs";

const RATE = 44100;
const TAU = 2 * Math.PI;

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

// короткий плавний вхід, щоб не було клацання на початку звуку
const attack = (t, ms) => Math.min(1, t / (ms / 1000));
// нормалізація піку до 0.8
const norm = (s) => {
	let peak = 0;
	for (const v of s) peak = Math.max(peak, Math.abs(v));
	return s.map((v) => (v / (peak || 1)) * 0.8);
};

// двоступеневий фільтр низьких частот: a ближче до 0 = глухіше (a ≈ 2π·fc/RATE)
function lowpass2() {
	let y1 = 0;
	let y2 = 0;
	return (x, a) => {
		y1 += a * (x - y1);
		y2 += a * (y1 - y2);
		return y2;
	};
}

// синус зі змінною частотою (глісандо): інтегруємо фазу
function glide() {
	let ph = 0;
	return (freq) => {
		ph += (TAU * freq) / RATE;
		return Math.sin(ph);
	};
}

// постріл: м'яке «блюп», тон плавно йде вгору (змініть 380 і 600, щоб тон став вищим чи нижчим)
const shootOsc = glide();
const shoot = norm(
	render(0.13, (t, k) => {
		const f = 380 + 600 * Math.sqrt(k);
		const ph = shootOsc(f);
		return ph * 0.7 * attack(t, 3) * (1 - k) ** 1.5;
	}),
);

// влучання в хмарку: глухий «пух» (як удар у подушку): шум ≈ 600 Гц + тон 230→130 Гц
const hitLp = lowpass2();
const hitOsc = glide();
const hit = norm(
	render(0.16, (t, k) => {
		const body = hitOsc(230 - 100 * k) * Math.exp(-t * 28);
		const puff = hitLp(noise(), 0.09) * 2.4 * Math.exp(-t * 32);
		return (body * 0.8 + puff) * attack(t, 2);
	}),
);

// хмарка зникла: повітряний «пуф»: шум, що темнішає (≈ 1,4 кГц → 250 Гц), і лагідний спад тону 260→120 Гц
const popLp = lowpass2();
const popOsc = glide();
const cloudPop = norm(
	render(0.42, (t, k) => {
		const a = 0.2 - 0.17 * k;
		const air = popLp(noise(), a) * 2.2 * Math.exp(-t * 9);
		const tone = popOsc(260 - 140 * Math.sqrt(k)) * 0.45 * Math.exp(-t * 11);
		return (air + tone) * attack(t, 4);
	}),
);

// вибух літака: низький і довгий, але теж м'який: удар 265→75 Гц + шум ≈ 1 кГц, що затихає
const boomLp = lowpass2();
const boomOsc = glide();
const planeBoom = norm(
	render(0.8, (t, k) => {
		const thump = boomOsc(190 * Math.exp(-t * 2.2) + 75) * Math.exp(-t * 3.2);
		const rumble = boomLp(noise(), 0.14) * 3 * Math.exp(-t * 4.5);
		return (thump * 0.9 + rumble) * attack(t, 5) * (1 - k) ** 0.5;
	}),
);

// зіткнення хмарки з літаком: глухий «бум» (тіло 260→140 Гц, трохи шуму)
const bumpLp = lowpass2();
const bumpOsc = glide();
const bump = norm(
	render(0.22, (t, k) => {
		const body = bumpOsc(260 - 120 * Math.sqrt(k)) * Math.exp(-t * 18);
		const thud = bumpLp(noise(), 0.1) * 1.6 * Math.exp(-t * 40);
		return (body + thud) * attack(t, 3);
	}),
);

// pickup: приємне «дінь-дон» з двох чистих нот (C5 → G5), без дзвінкого хвоста
const pickup = norm(
	render(0.32, (t) => {
		const note = (f, start) => {
			const u = t - start;
			if (u < 0) return 0;
			return (
				(Math.sin(TAU * f * u) + Math.sin(TAU * f * 2 * u) * 0.12) *
				attack(u, 6) *
				Math.exp(-u * 14)
			);
		};
		return note(523, 0) * 0.7 + note(784, 0.07);
	}),
);

// відродження: лагідний зліт угору (220→440 Гц) із повітрям
const respLp = lowpass2();
const respOsc = glide();
const respawn = norm(
	render(0.45, (_t, k) => {
		const tone = respOsc(220 + 220 * k * k) * Math.sin(Math.PI * k) ** 1.5;
		const air = respLp(noise(), 0.1) * 0.5 * Math.sin(Math.PI * k);
		return tone * 0.7 + air;
	}),
);

mkdirSync("public/assets", { recursive: true });
const sounds = { shoot, hit, cloudPop, planeBoom, bump, pickup, respawn };
for (const [name, s] of Object.entries(sounds)) {
	writeFileSync(`public/assets/${name}.wav`, wav(s));
	console.log(`public/assets/${name}.wav  ${(s.length / RATE).toFixed(2)} с`);
}
