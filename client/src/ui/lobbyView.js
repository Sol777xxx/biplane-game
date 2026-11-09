import { describeError } from "../loadingScreen.js";
import { describeJoinError } from "../net/roomSession.js";

const NAME_KEY = "biplane-name";

function el(tag, props = {}, ...children) {
	const node = Object.assign(document.createElement(tag), props);
	node.append(...children);
	return node;
}

function savedName() {
	try {
		return localStorage.getItem(NAME_KEY) ?? "";
	} catch {
		return "";
	}
}

function saveName(name) {
	try {
		localStorage.setItem(NAME_KEY, name);
	} catch {
		// сховище недоступне
	}
}

// Показує лобі й повертає проміс із вибором гравця { name, room, ...результат enter }.
// enter(choice) підключає до кімнати; якщо воно відхилене, гравець лишається в лобі
// з поясненням. Усі слухачі підписані з одним signal, тож cleanup() знімає їх одним abort().
export function showLobby(root, lobby, { enter = async () => ({}) } = {}) {
	return new Promise((resolve) => {
		const ac = new AbortController();
		const { signal } = ac;
		let selected = null;
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

		function setBusy(on) {
			busy = on;
			nameInput.disabled = on;
			joinBtn.disabled = on;
			list.inert = on;
		}

		function render(rooms) {
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

		function cleanup() {
			ac.abort();
			root.hidden = true;
			root.replaceChildren();
		}

		async function join() {
			if (busy) return;
			sticky = "";
			let choice;
			try {
				choice = lobby.join(nameInput.value, selected); // перевірка + stop() опитування
			} catch (error) {
				note.textContent = error.message;
				return;
			}
			saveName(choice.name);
			setBusy(true);
			note.textContent = "Підключення…";
			try {
				const result = await enter(choice);
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

		lobby.addEventListener(
			"rooms",
			(e) => {
				render(e.detail);
				if (!sticky) note.textContent = "";
			},
			{ signal },
		);
		lobby.addEventListener(
			"error",
			(e) => {
				if (sticky) return;
				note.textContent = `Не вдалося оновити список: ${describeError(e.detail)}`;
			},
			{ signal },
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
