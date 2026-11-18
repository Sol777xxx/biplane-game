import type { InputKey, InputKeys } from "biplane-shared/protocol/index.ts";

// Дії клавіатури: п'ять ключів вводу для сервера плюс дві службові (HUD і проба).
export type Action = InputKey | "hud" | "probe";

const KEYMAP: ReadonlyMap<string, Action> = new Map<string, Action>([
	["ArrowUp", "up"],
	["KeyW", "up"],
	["ArrowDown", "down"],
	["KeyS", "down"],
	["ArrowLeft", "left"],
	["KeyA", "left"],
	["ArrowRight", "right"],
	["KeyD", "right"],
	["Space", "fire"],
	["KeyH", "hud"],
	["KeyP", "probe"],
]);

// у текстовому полі (чат, лобі) клавіші належать полю, а не грі
const isTyping = (e: Event): boolean =>
	e.target instanceof HTMLInputElement ||
	e.target instanceof HTMLTextAreaElement ||
	(e.target instanceof HTMLElement && e.target.isContentEditable);

export function createInput(target: Window = window) {
	const pressed = new Set<Action>();
	const justPressed = new Set<Action>();

	function onKeyDown(e: KeyboardEvent): void {
		if (isTyping(e)) return;
		const action = KEYMAP.get(e.code);
		if (!action) return;
		// блокує прокрутку сторінки пробілом
		e.preventDefault();
		// автоповтор клавіші не вважається новим натисканням
		if (!pressed.has(action)) justPressed.add(action);
		pressed.add(action);
	}

	function onKeyUp(e: KeyboardEvent): void {
		if (isTyping(e)) return;
		const action = KEYMAP.get(e.code);
		if (!action) return;
		pressed.delete(action);
	}

	// скидання при втраті фокусу
	function onBlur(): void {
		pressed.clear();
		justPressed.clear();
	}

	function onFocusIn(e: FocusEvent): void {
		if (isTyping(e)) onBlur();
	}

	target.addEventListener("keydown", onKeyDown);
	target.addEventListener("keyup", onKeyUp);
	window.addEventListener("blur", onBlur);
	window.addEventListener("focusin", onFocusIn);

	return {
		isDown(action: Action): boolean {
			return pressed.has(action);
		},
		// true один раз після натискання, до виклику endStep()
		justPressed(action: Action): boolean {
			return justPressed.has(action);
		},
		// викликається в кінці кожного кроку симуляції
		endStep(): void {
			justPressed.clear();
		},
		snapshot(): InputKeys {
			return {
				up: pressed.has("up"),
				down: pressed.has("down"),
				left: pressed.has("left"),
				right: pressed.has("right"),
				fire: pressed.has("fire"),
			};
		},
		dispose(): void {
			target.removeEventListener("keydown", onKeyDown);
			target.removeEventListener("keyup", onKeyUp);
			window.removeEventListener("blur", onBlur);
			window.removeEventListener("focusin", onFocusIn);
		},
	};
}

export type Input = ReturnType<typeof createInput>;
