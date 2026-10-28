// Демонстрація помилки з this. Запуск: node demo/this-bug.mjs
import { Game } from "../src/sim/game.js";

const game = new Game();
const plane = game.plane;
const bullets = () => game.world.count("bullet");

// 1. Баг: метод відокремлено від об'єкта (так слухач отримує функцію)
const detached = plane.fire;
try {
	detached(); // this === undefined: класи завжди працюють у strict mode
} catch (e) {
	console.log(`1a. detached(): ${e.name}: ${e.message}`);
}

// слухач події викликає функцію з this = елемент, що отримав подію
const element = new EventTarget();
const result = detached.call(element);
console.log(
	`1b. this = елемент: fire() повернув ${result}, куль: ${bullets()}`,
);

// 2 і 3. Фікси
function check(label, makeListener) {
	plane.cooldown = 0;
	const before = bullets();
	const target = new EventTarget();
	target.addEventListener("click", makeListener(plane));
	target.dispatchEvent(new Event("click"));
	console.log(`${label}: нових куль ${bullets() - before}`);
}
check("2. стрілка () => plane.fire()", (p) => () => p.fire());
check("3. bind: plane.fire.bind(plane)", (p) => p.fire.bind(p));

// 4. Стрілка як поле класу: працює без обгортки, але функція своя в кожного екземпляра
class Gun {
	shots = 0;
	fireMethod() {
		this.shots++;
	}
	fireArrow = () => {
		this.shots++;
	};
}
const gun = new Gun();
const m = gun.fireMethod;
const a = gun.fireArrow;
try {
	m();
} catch (e) {
	console.log(`4a. метод без об'єкта: ${e.name}`);
}
a();
console.log(`4b. стрілка-поле: shots = ${gun.shots}`);
console.log(
	`4c. метод спільний між екземплярами: ${new Gun().fireMethod === gun.fireMethod}`,
);
console.log(
	`4d. стрілка своя в кожного: ${new Gun().fireArrow !== gun.fireArrow}`,
);
