import { HttpError } from "./assets/loader.js";

export function describeError(err) {
	if (err instanceof HttpError) {
		return `Не вдалося завантажити ${err.url} (HTTP ${err.status})`;
	}
	switch (err?.name) {
		case "TimeoutError":
			return "Час очікування мережі вичерпано";
		case "AbortError":
			return "Завантаження скасовано";
		case "SyntaxError":
			return "Файл пошкоджений (некоректний JSON)";
		default:
			return err?.message ?? String(err);
	}
}

// Екран завантаження на canvas: справжня смуга прогресу (done/total), повідомлення, Retry.
export function createLoadingScreen(canvas, retryBtn) {
	const ctx = canvas.getContext("2d");
	let target = 0;
	let shown = 0;
	let label = "";
	let note = "";
	let error = "";
	let warnings = [];
	let raf = 0;

	function fit() {
		const dpr = window.devicePixelRatio || 1;
		const w = canvas.clientWidth;
		const h = canvas.clientHeight;
		if (canvas.width !== Math.round(w * dpr))
			canvas.width = Math.round(w * dpr);
		if (canvas.height !== Math.round(h * dpr))
			canvas.height = Math.round(h * dpr);
		ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
		return { w, h };
	}

	function draw() {
		const { w, h } = fit();
		ctx.clearRect(0, 0, w, h);
		const cx = w / 2;
		const cy = h / 2;
		const barW = Math.min(420, w * 0.7);

		ctx.textAlign = "center";
		ctx.fillStyle = "#6b5b8a";
		ctx.font = "bold 34px ui-monospace, Consolas, monospace";
		ctx.fillText("Biplane", cx, cy - 56);

		ctx.fillStyle = "rgba(255,255,255,0.65)";
		ctx.beginPath();
		ctx.roundRect(cx - barW / 2, cy - 12, barW, 24, 12);
		ctx.fill();
		if (shown > 0) {
			ctx.fillStyle = error ? "#e0609b" : "#f08ab4";
			ctx.beginPath();
			ctx.roundRect(cx - barW / 2, cy - 12, Math.max(24, barW * shown), 24, 12);
			ctx.fill();
		}

		ctx.font = "14px ui-monospace, Consolas, monospace";
		ctx.fillStyle = "#6b5b8a";
		ctx.fillText(
			error ? "" : `${Math.round(target * 100)}%  ${label}`,
			cx,
			cy + 40,
		);
		if (note) ctx.fillText(note, cx, cy + 62);
		if (error) {
			ctx.fillStyle = "#c2417d";
			ctx.fillText(error, cx, cy + 44);
		}
		ctx.fillStyle = "#8a7aa8";
		warnings.forEach((wmsg, i) => {
			ctx.fillText(`⚠ ${wmsg}`, cx, cy + 92 + i * 20);
		});
	}

	function tick() {
		shown += (target - shown) * 0.2;
		if (Math.abs(target - shown) < 0.002) shown = target;
		draw();
		raf = requestAnimationFrame(tick);
	}

	return {
		start() {
			target = shown = 0;
			error = note = label = "";
			warnings = [];
			retryBtn.hidden = true;
			cancelAnimationFrame(raf);
			tick();
		},
		// подія прогресу з loadAll
		progress(e) {
			if (e.type === "item") {
				target = e.fraction;
				label = e.failed ? `${e.id} — пропущено` : e.id;
			} else if (e.type === "retry") {
				note = `Повтор ${e.attempt}/${e.attempts - 1}: ${e.id} (через ${Math.round(e.delay)} мс)`;
			}
		},
		setWarnings(list) {
			warnings = list;
		},
		// показує помилку й чекає натискання Retry
		fail(err) {
			error = describeError(err);
			note = "";
			retryBtn.hidden = false;
			retryBtn.focus();
			return new Promise((resolve) =>
				retryBtn.addEventListener("click", resolve, { once: true }),
			);
		},
		stop() {
			cancelAnimationFrame(raf);
			retryBtn.hidden = true;
			const { w, h } = fit();
			ctx.clearRect(0, 0, w, h);
		},
	};
}
