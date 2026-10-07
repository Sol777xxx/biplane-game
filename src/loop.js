export function createLoop({
  update,
  render,
  onStats,
  step = 1 / 60, // фіксований крок симуляції, секунди
  maxFrame = 0.25, // обмеження кадру проти «спіралі смерті»
}) {
  let rafId = 0;
  let running = false;
  let last = 0;
  let accumulator = 0;

  let steps = 0;
  let frames = 0;
  let statsTime = 0;
  let frameMs = 0;

  function frame(now) {
    if (!running) return;
    const t = now / 1000;
    const realDelta = t - last;
    last = t;
    frameMs = realDelta * 1000;

    // якщо вкладка «заснула» або кадр завис, не доганяємо все одразу
    accumulator += Math.min(realDelta, maxFrame);

    while (accumulator >= step) {
      update(step);
      accumulator -= step;
      steps++;
    }

    render(accumulator / step); // alpha для інтерполяції, від 0 до 1
    frames++;

    statsTime += realDelta;
    if (statsTime >= 1) {
      onStats?.({
        stepsPerSec: steps / statsTime,
        framesPerSec: frames / statsTime,
        frameMs,
      });
      steps = 0;
      frames = 0;
      statsTime = 0;
    }

    rafId = requestAnimationFrame(frame);
  }

  return {
    start() {
      if (running) return;
      running = true;
      last = performance.now() / 1000;
      rafId = requestAnimationFrame(frame);
    },
    stop() {
      running = false;
      cancelAnimationFrame(rafId);
    },
  };
}