// Phone layout: the details panel becomes a bottom sheet over a full-screen
// map, with three heights — peek, half, full. Drag the handle to resize (it
// snaps to the nearest height) or tap it to step up. On desktop it does nothing.

export const MOBILE = window.matchMedia('(max-width: 768px)');

const PEEK_PX = 136;
const STATES = ['peek', 'half', 'full'];

export function createSheet(sheet, handle, topBar, { onChange } = {}) {
  let state = 'peek';
  let drag = null;

  const heights = () => ({
    peek: PEEK_PX,
    half: Math.round(window.innerHeight * 0.55),
    full: window.innerHeight - topBar.offsetHeight - 12,
  });

  function apply(next, { animate = true } = {}) {
    state = next;
    sheet.dataset.state = state;
    if (!MOBILE.matches) {
      sheet.style.height = '';
      return;
    }
    sheet.classList.toggle('is-dragging', !animate);
    sheet.style.height = `${heights()[state]}px`;
    handle.setAttribute('aria-expanded', String(state !== 'peek'));
    handle.setAttribute('aria-label', state === 'full' ? 'Show less' : 'Show more details');
    onChange?.(state);
  }

  handle.addEventListener('pointerdown', (e) => {
    if (!MOBILE.matches) return;
    drag = { y: e.clientY, height: sheet.offsetHeight, moved: false };
    handle.setPointerCapture(e.pointerId);
    sheet.classList.add('is-dragging');
  });

  handle.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const dy = drag.y - e.clientY;
    if (Math.abs(dy) > 5) drag.moved = true;
    const { peek, full } = heights();
    sheet.style.height = `${Math.min(full, Math.max(peek, drag.height + dy))}px`;
  });

  const release = () => {
    if (!drag) return;
    const { moved } = drag;
    drag = null;
    if (!moved) {
      // Tap: step up, and from full go back down to peek.
      apply(STATES[(STATES.indexOf(state) + 1) % STATES.length]);
      return;
    }
    const current = sheet.offsetHeight;
    const nearest = Object.entries(heights()).reduce((a, b) => (Math.abs(b[1] - current) < Math.abs(a[1] - current) ? b : a));
    apply(nearest[0]);
  };
  handle.addEventListener('pointerup', release);
  handle.addEventListener('pointercancel', release);

  MOBILE.addEventListener('change', () => apply(state, { animate: false }));
  window.addEventListener('resize', () => apply(state, { animate: false }));
  apply('peek', { animate: false });

  return {
    open: (next) => apply(next),
    // Height the sheet is at, or heading to, in px (0 on desktop).
    targetHeight: () => (MOBILE.matches ? heights()[state] : 0),
    peekHeight: () => (MOBILE.matches ? PEEK_PX : 0),
  };
}
