import type { RoomSummary } from "biplane-shared/protocol/index.ts";
import { describeError } from "../loadingScreen.ts";
import type { JoinChoice, Lobby } from "../lobby.ts";
import { describeJoinError } from "../net/roomSession.ts";
import { el, messageOf } from "./dom.ts";

const NAME_KEY = "biplane-name";

function savedName(): string {
	try {
		return localStorage.getItem(NAME_KEY) ?? "";
	} catch {
		return "";
	}
}

function saveName(name: string): void {
	try {
		localStorage.setItem(NAME_KEY, name);
	} catch {
		// сховище недоступне
	}
}

export interface LobbyViewOptions<R extends object> {
	// підключає до кімнати; відхилення лишає гравця в лобі з поясненням
	readonly enter: (choice: JoinChoice) => Promise<R>;
}

// Показує лобі й повертає проміс із вибором гравця { name, room, ...результат enter }.
// Усі слухачі підписані з одним signal, тож cleanup() знімає їх одним abort().
// Без enter результатом буде лише вибір; з enter до нього додаються поля результату.
export function showLobby(root: HTMLElement, lobby: Lobby): Promise<JoinChoice>;
export function showLobby<R extends object>(
	root: HTMLElement,
	lobby: Lobby,
	options: LobbyViewOptions<R>,
): Promise<JoinChoice & R>;
export function showLobby<R extends object>(
	root: HTMLElement,
	lobby: Lobby,
	options?: Partial<LobbyViewOptions<R>>,
): Promise<JoinChoice> {
	const enter = options?.enter;
	return new Promise((resolve) => {
		const ac = new AbortController();
		const { signal } = ac;
		let selected: string | null = null;
		let busy = false;
		let sticky = ""; // повідомлення про невдалий вхід: не стирається оновленням списку

		const nameInput = el("input", {
			type: "text",
			maxLength: 16,
			placeholder: "Ваше ім'я",
			value: savedName(),
			autocomplete: "off",
		});
		const list = el("div", { className: "rooms" });
		const note = el("p", {
			className: "lobby-note",
			textContent: "Завантаження кімнат…",
		});
		const joinBtn = el("button", {
			type: "button",
			className: "join",
			textContent: "Join",
		});
		root.replaceChildren(
			el("h2", { textContent: "Лобі" }),
			nameInput,
			list,
			note,
			joinBtn,
		);
		root.hidden = false;

		function setBusy(on: boolean): void {
			busy = on;
			nameInput.disabled = on;
			joinBtn.disabled = on;
			list.inert = on;
		}

		function render(rooms: readonly RoomSummary[]): void {
			if (selected === null) {
				selected = rooms.find((r) => r.players < r.max)?.id ?? null;
			}
			list.replaceChildren(
				...rooms.map((room) => {
					const full = room.players >= room.max;
					const radio = el("input", {
						type: "radio",
						name: "room",
						value: room.id,
						disabled: full,
						checked: room.id === selected,
					});
					radio.addEventListener("change", () => {
						selected = room.id;
						sticky = "";
						note.textContent = "";
					});
					return el(
						"label",
						{ className: full ? "room full" : "room" },
						radio,
						el("span", { className: "room-name", textContent: room.name }),
						el("span", {
							className: "room-count",
							textContent: `${room.players}/${room.max}`,
						}),
					);
				}),
			);
		}

		function cleanup(): void {
			ac.abort();
			root.hidden = true;
			root.replaceChildren();
		}

		async function join(): Promise<void> {
			if (busy) return;
			sticky = "";
			let choice: JoinChoice;
			try {
				choice = lobby.join(nameInput.value, selected); // перевірка + stop() опитування
			} catch (error) {
				note.textContent = messageOf(error);
				return;
			}
			saveName(choice.name);
			setBusy(true);
			note.textContent = "Підключення…";
			try {
				const result = enter ? await enter(choice) : {};
				cleanup();
				resolve({ ...choice, ...result });
			} catch (error) {
				sticky = describeJoinError(error);
				note.textContent = sticky;
				setBusy(false);
				lobby.start(); // повертаємось до оновлення списку
				nameInput.focus();
			}
		}

		const offs = [
			lobby.listen("rooms", (rooms) => {
				render(rooms);
				if (!sticky) note.textContent = "";
			}),
			lobby.listen("error", (error) => {
				if (sticky) return;
				note.textContent = `Не вдалося оновити список: ${describeError(error)}`;
			}),
		];
		signal.addEventListener(
			"abort",
			() => {
				for (const off of offs) off();
			},
			{ once: true },
		);
		joinBtn.addEventListener("click", join, { signal });
		nameInput.addEventListener(
			"keydown",
			(e) => {
				if (e.key === "Enter") join();
			},
			{ signal },
		);
		// у фоновій вкладці список нікому не потрібен
		document.addEventListener(
			"visibilitychange",
			() => {
				if (busy) return;
				if (document.hidden) lobby.stop();
				else lobby.start();
			},
			{ signal },
		);

		lobby.start();
		nameInput.focus();
	});
}
