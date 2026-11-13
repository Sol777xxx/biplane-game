// Знімок стану для мережі: JSON-сумісний об'єкт. Порядок сутностей збігається з порядком
// створення. Координати округлені до 0.01: без цього JSON роздувся б 17-значними числами.
const round = (v, digits) => {
	const k = 10 ** digits;
	return Math.round(v * k) / k;
};
const r2 = (v) => round(v, 2);

export function takeSnapshot(game) {
	const players = [];
	const ships = [];
	for (const p of game.players.values()) {
		players.push({
			id: p.id,
			score: p.score,
			destroyed: p.destroyed,
			crashes: p.crashes,
			deaths: p.deaths,
		});
		const e = p.plane;
		if (!e?.alive) continue; // загиблого корабля в знімку немає до відродження
		ships.push({
			id: e.id,
			player: p.id,
			x: r2(e.pos.x),
			y: r2(e.pos.y),
			vx: r2(e.vel.x),
			vy: r2(e.vel.y),
			pitch: round(e.pitch, 4),
			facing: e.facing,
			hp: e.hp,
			cooldown: round(e.cooldown, 3),
			shield: r2(e.effects.shield),
			rapid: r2(e.effects.rapid),
			homing: r2(e.effects.homing),
		});
	}

	const obstacles = [];
	for (const e of game.world.ofKind("obstacle")) {
		if (!e.alive) continue;
		obstacles.push({
			id: e.id,
			x: r2(e.pos.x),
			y: r2(e.pos.y),
			vx: r2(e.vel.x),
			vy: r2(e.vel.y),
			r: e.radius,
		});
	}

	const bullets = [];
	for (const e of game.world.ofKind("bullet")) {
		if (!e.alive) continue;
		bullets.push({
			id: e.id,
			owner: e.owner?.playerId ?? null,
			seq: e.seq, // seq input-пострілу (0: повтор клавіш)
			x: r2(e.pos.x),
			y: r2(e.pos.y),
			vx: r2(e.vel.x),
			vy: r2(e.vel.y),
			ttl: round(e.ttl, 3),
		});
	}

	const pickups = [];
	for (const e of game.world.ofKind("pickup")) {
		if (!e.alive) continue;
		pickups.push({
			id: e.id,
			type: e.type,
			x: r2(e.pos.x),
			y: r2(e.pos.y),
			life: r2(e.life),
		});
	}

	return { tick: game.tick, players, ships, obstacles, bullets, pickups };
}

const px = (v) => Math.round(v);

// Подія шини світу у вигляді для мережі; невідомий тип дає null.
// Події це лише косметика (звук, ефекти): стан гри з них не відновлюється.
export function eventToWire(type, d) {
	switch (type) {
		case "fired":
			return {
				type,
				player: d.by?.playerId ?? null,
				x: px(d.at.x),
				y: px(d.at.y),
			};
		case "hit":
			return { type, kind: d.target.kind, x: px(d.at.x), y: px(d.at.y) };
		case "exploded":
			return {
				type,
				kind: d.kind,
				x: px(d.pos.x),
				y: px(d.pos.y),
				size: d.size,
				color: d.color,
				count: d.count,
			};
		case "scored":
			return {
				type,
				player: d.player,
				delta: d.delta,
				x: px(d.at.x),
				y: px(d.at.y),
			};
		case "pickup":
			return { type, player: d.player, pickup: d.type };
		case "crash":
			return { type, player: d.player, x: px(d.at.x), y: px(d.at.y) };
		case "respawned":
			return { type, player: d.player, x: px(d.at.x), y: px(d.at.y) };
		default:
			return null;
	}
}
