import { describeError } from "../loadingScreen.js";

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

// Показує лобі й повертає проміс з вибором гравця { name, room }.
// Усі слухачі підписані з одним signal, тож cleanup() знімає їх одним abort().
export function showLobby(root, lobby) {
	return new Promise((resolve) => {
		const ac = new AbortController();
		const { signal } = ac;
		let selected = null;

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

		function join() {
			try {
				const choice = lobby.join(nameInput.value, selected);
				saveName(choice.name);
				cleanup();
				resolve(choice);
			} catch (error) {
				note.textContent = error.message;
			}
		}

		lobby.addEventListener(
			"rooms",
			(e) => {
				render(e.detail);
				note.textContent = "";
			},
			{ signal },
		);
		lobby.addEventListener(
			"error",
			(e) => {
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
			() => (document.hidden ? lobby.stop() : lobby.start()),
			{ signal },
		);

		lobby.start();
		nameInput.focus();
	});
}
