import { describeClose, type RoomSession } from "../net/roomSession.ts";
import { el } from "./dom.ts";

const MAX_LINES = 50;

// Чужий текст потрапляє в DOM лише як текстовий вузол (append зі string / textContent),
// ніколи як HTML: інакше чат став би дірою для XSS.
export function mountChat(root: HTMLElement, session: RoomSession): () => void {
	const room = session.room;
	if (!room) throw new Error("чат потрібен після входу в кімнату");
	const ac = new AbortController();
	const { signal } = ac;

	const roster = el("div", { className: "chat-roster" });
	const log = el("div", { className: "chat-log", role: "log" });
	const status = el("div", { className: "chat-status" });
	const input = el("input", {
		type: "text",
		maxLength: 200,
		placeholder: "Enter: чат · Esc: назад до гри",
		autocomplete: "off",
	});
	root.replaceChildren(roster, log, status, input);
	root.hidden = false;

	function line(className: string, ...children: (string | Node)[]): void {
		log.append(el("div", { className }, ...children));
		while (log.children.length > MAX_LINES) log.firstElementChild?.remove();
		log.scrollTop = log.scrollHeight;
	}

	function renderRoster(
		players: readonly { id: string; name: string }[],
	): void {
		roster.replaceChildren(
			...players.map((p) =>
				el("span", {
					className: p.id === session.you?.id ? "chip me" : "chip",
					textContent: p.name,
				}),
			),
		);
	}

	renderRoster(session.players);
	line("msg sys", `Ви в кімнаті «${room.name}»`);

	// підписки сеансу знімаються разом з рештою, коли спрацьовує signal
	const offs = [
		session.listen("roster", renderRoster),
		session.listen("chat", (m) => {
			line(
				m.from === session.you?.id ? "msg me" : "msg",
				el("b", {}, `${m.name}: `),
				m.text,
			);
		}),
		session.listen("status", (s) => {
			if (s.state === "online") status.textContent = "";
			else if (s.state === "reconnecting") {
				status.textContent = `Зв'язок втрачено, повторне підключення (спроба ${s.attempt})…`;
			} else {
				status.textContent = describeClose(s.code);
				line("msg sys", `З'єднання закрито: ${describeClose(s.code)}`);
			}
		}),
	];
	signal.addEventListener(
		"abort",
		() => {
			for (const off of offs) off();
		},
		{ once: true },
	);

	input.addEventListener(
		"keydown",
		(e) => {
			if (e.key === "Escape") input.blur();
			if (e.key !== "Enter") return;
			const text = input.value.trim();
			if (text) session.chat(text);
			input.value = "";
			input.blur(); // повертаємо клавіатуру грі
		},
		{ signal },
	);
	// Enter поза полем відкриває чат
	window.addEventListener(
		"keydown",
		(e) => {
			if (
				e.key !== "Enter" ||
				e.repeat ||
				document.activeElement !== document.body
			)
				return;
			e.preventDefault();
			input.focus();
		},
		{ signal },
	);

	return () => ac.abort();
}
