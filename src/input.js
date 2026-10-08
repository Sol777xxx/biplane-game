export function createInput(target = window) {
	const pressed = new Set();
	const justPressed = new Set();

	const KEYMAP = {
		ArrowUp: "up",
		KeyW: "up",
		ArrowDown: "down",
		KeyS: "down",
		ArrowLeft: "left",
		KeyA: "left",
		ArrowRight: "right",
		KeyD: "right",
		Space: "fire",
		KeyH: "hud",
		KeyP: "probe",
	};

	function onKeyDown(e) {
		const action = KEYMAP[e.code];
		if (!action) return;
		// блокує прокрутку сторінки пробілом
		e.preventDefault();
		// автоповтор клавіші не вважається новим натисканням
		if (!pressed.has(action)) justPressed.add(action);
		pressed.add(action);
	}

	function onKeyUp(e) {
		const action = KEYMAP[e.code];
		if (!action) return;
		pressed.delete(action);
	}

	// скидання при втраті фокусу
	function onBlur() {
		pressed.clear();
		justPressed.clear();
	}

	target.addEventListener("keydown", onKeyDown);
	target.addEventListener("keyup", onKeyUp);
	window.addEventListener("blur", onBlur);

	return {
		isDown(action) {
			return pressed.has(action);
		},
		// true один раз після натискання, до виклику endStep()
		justPressed(action) {
			return justPressed.has(action);
		},
		// викликається в кінці кожного кроку симуляції
		endStep() {
			justPressed.clear();
		},
		snapshot() {
			return {
				up: pressed.has("up"),
				down: pressed.has("down"),
				left: pressed.has("left"),
				right: pressed.has("right"),
				fire: pressed.has("fire"),
			};
		},
		dispose() {
			target.removeEventListener("keydown", onKeyDown);
			target.removeEventListener("keyup", onKeyUp);
			window.removeEventListener("blur", onBlur);
		},
	};
}
