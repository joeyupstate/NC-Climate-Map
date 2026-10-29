// "How it works" dialog. Any element with [data-about] opens it.
export function initAbout() {
  const dialog = document.getElementById('about');
  if (!dialog) return;

  document.addEventListener('click', (e) => {
    if (e.target.closest('[data-about]')) dialog.showModal();
    else if (e.target.closest('[data-about-close]')) dialog.close();
  });

  // Click on the backdrop (outside the content) closes it; Esc is built in.
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) dialog.close();
  });
}
