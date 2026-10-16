const root = document.querySelector('[data-showcase]');
if (root) {
  const image = root.querySelector('img');
  const caption = root.querySelector('figcaption');
  const choices = [...root.querySelectorAll('[data-slide]')];
  const outgoing = image.cloneNode();
  outgoing.className = 'hero__image-outgoing';
  outgoing.alt = '';
  outgoing.setAttribute('aria-hidden', 'true');
  const stage = document.createElement('div');
  stage.className = 'hero__image-stage';
  image.before(stage);
  stage.append(image, outgoing);
  let fade;
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  let paused = motion.matches;
  let index = 0;
  let timer;
  let hovered = false;
  const schedule = () => {
    clearTimeout(timer);
    if (paused || hovered || root.contains(document.activeElement) || document.hidden) return;
    timer = setTimeout(() => select((index + 1) % choices.length), 5000);
  };
  const select = next => {
    index = next;
    const choice = choices[index];
    fade?.cancel();
    outgoing.src = image.src;
    image.src = choice.dataset.src;
    if (!motion.matches) {
      const styles = getComputedStyle(root);
      fade = outgoing.animate([{ opacity: 1 }, { opacity: 0 }], {
        duration: parseFloat(styles.getPropertyValue('--site-motion-enter')),
        easing: styles.getPropertyValue('--site-motion-ease').trim(),
      });
    }
    image.alt = choice.dataset.caption;
    caption.textContent = choice.dataset.caption;
    choices.forEach((button, i) => button.setAttribute('aria-pressed', String(i === index)));
    schedule();
  };
  choices.forEach((choice, i) => choice.addEventListener('click', () => select(i)));
  choices.forEach(choice => { const preload = new Image(); preload.src = choice.dataset.src; });
  root.addEventListener('mouseenter', () => { hovered = true; schedule(); });
  root.addEventListener('mouseleave', () => { hovered = false; schedule(); });
  root.addEventListener('focusin', schedule);
  root.addEventListener('focusout', () => queueMicrotask(schedule));
  document.addEventListener('visibilitychange', schedule);
  motion.addEventListener('change', () => { paused = motion.matches; schedule(); });
  root.querySelector('[data-controls]').hidden = false;
  schedule();
}
