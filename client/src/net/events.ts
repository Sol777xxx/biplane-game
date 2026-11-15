import {
	type WireEvent,
	wireEventSchema,
} from "biplane-shared/protocol/index.ts";
import { assertNever } from "biplane-shared/sim/never.ts";
import type { PickupType } from "biplane-shared/sim/objects.ts";
import type { ExplosionColor, SimKind } from "biplane-shared/sim/types.ts";
import type { Vec2 } from "biplane-shared/sim/vector.ts";

// Подія з мережі (eventToWire на сервері) назад у форму, яку чекають підписники шини
// (audio, hud, fx). Невідоме або зламане дає null: навіть косметиці з мережі не довіряємо наосліп.
// Вручну нічого не перевіряємо: форму події гарантує схема Zod із shared/protocol, а
// exhaustive switch нижче не дасть забути нову подію, коли вона з'явиться в протоколі.
const MAX_PARTICLES = 80; // сервер шле до 50; стеля захищає від зламаного знімка

// Те, що лягає в detail шини після мережі (це вужче за BusEvents: сервер не шле total і by).
export type NetEvent =
	| {
			readonly type: "fired";
			readonly detail: {
				readonly by: { readonly playerId: string | null };
				readonly at: Vec2;
			};
	  }
	| {
			readonly type: "hit";
			readonly detail: {
				readonly at: Vec2;
				readonly target: { readonly kind: SimKind };
			};
	  }
	| {
			readonly type: "exploded";
			readonly detail: {
				readonly kind: SimKind;
				readonly pos: Vec2;
				readonly size: number;
				readonly color: ExplosionColor;
				readonly count: number;
			};
	  }
	| {
			readonly type: "scored";
			readonly detail: {
				readonly player: string;
				readonly delta: number;
				readonly at: Vec2;
			};
	  }
	| {
			readonly type: "pickup";
			readonly detail: {
				readonly type: PickupType;
				readonly player: string | null;
			};
	  }
	| {
			readonly type: "crash";
			readonly detail: { readonly player: string | null; readonly at: Vec2 };
	  }
	| {
			readonly type: "respawned";
			readonly detail: { readonly player: string; readonly at: Vec2 };
	  };

// Перевірена подія в подію шини. Кожна гілка повертає свій варіант NetEvent,
// а default це never: нова подія в WireEvent без гілки тут це помилка tsc.
function toNetEvent(w: WireEvent): NetEvent {
	switch (w.type) {
		case "fired":
			return {
				type: "fired",
				detail: { by: { playerId: w.player }, at: { x: w.x, y: w.y } },
			};
		case "hit":
			return {
				type: "hit",
				detail: { at: { x: w.x, y: w.y }, target: { kind: w.kind } },
			};
		case "exploded":
			return {
				type: "exploded",
				detail: {
					kind: w.kind,
					pos: { x: w.x, y: w.y },
					size: w.size,
					color: w.color,
					count: Math.min(MAX_PARTICLES, Math.max(0, Math.round(w.count))),
				},
			};
		case "scored":
			return {
				type: "scored",
				detail: { player: w.player, delta: w.delta, at: { x: w.x, y: w.y } },
			};
		case "pickup":
			return {
				type: "pickup",
				detail: { type: w.pickup, player: w.player },
			};
		case "crash":
			return {
				type: "crash",
				detail: { player: w.player, at: { x: w.x, y: w.y } },
			};
		case "respawned":
			return {
				type: "respawned",
				detail: { player: w.player, at: { x: w.x, y: w.y } },
			};
		default:
			return assertNever(w, "подія з мережі");
	}
}

// raw це unknown: знімок може бути зламаний або підмінений, тому першою його читає схема.
export function eventFromWire(raw: unknown): NetEvent | null {
	const parsed = wireEventSchema.safeParse(raw);
	return parsed.success ? toNetEvent(parsed.data) : null;
}
