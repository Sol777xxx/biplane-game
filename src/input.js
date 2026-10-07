export function createInput(target = window) {
  const pressed = new Set();

  const KEYMAP = {
    ArrowUp: "up",
    KeyW: "up",
    ArrowDown: "down",
    KeyS: "down",
    ArrowLeft: "left",
    KeyA: "left",
    ArrowRight: "right",
    KeyD: "right",
  };

  function onKeyDown(e) {
    const action = KEYMAP[e.code];
    if (!action) return;
    e.preventDefault();
    pressed.add(action);
  }

  function onKeyUp(e) {
    const action = KEYMAP[e.code];
    if (!action) return;
    pressed.delete(action);
  }

  // коли вікно втрачає фокус, keyup може не прийти: скидаємо клавіші
  function onBlur() {
    pressed.clear();
  }

  target.addEventListener("keydown", onKeyDown);
  target.addEventListener("keyup", onKeyUp);
  window.addEventListener("blur", onBlur);

  return {
    isDown(action) {
      return pressed.has(action);
    },
    snapshot() {
      return {
        up: pressed.has("up"),
        down: pressed.has("down"),
        left: pressed.has("left"),
        right: pressed.has("right"),
      };
    },
    dispose() {
      target.removeEventListener("keydown", onKeyDown);
      target.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
    },
  };
}