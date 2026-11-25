import { t } from './i18n.js';

/** @param {HTMLDialogElement} dialog */
export function createJobShare(dialog) {
  const jobTitle = dialog.querySelector('#share-job-title');
  const image = dialog.querySelector('img');
  const qrStatus = dialog.querySelector('#share-qr-status');
  const link = dialog.querySelector('input');
  const copy = dialog.querySelector('#copy-share-url');
  const copyStatus = dialog.querySelector('#share-copy-status');
  if (!(jobTitle instanceof HTMLElement) || !image || !qrStatus || !link || !copy || !copyStatus) {
    throw new Error('Missing share dialog elements');
  }
  let request = 0;

  copy.addEventListener('click', async () => {
    const current = request;
    try {
      await navigator.clipboard.writeText(link.value);
      if (dialog.open && current === request) copyStatus.textContent = t('shareCopied');
    } catch {
      if (!dialog.open || current !== request) return;
      link.focus();
      link.select();
      copyStatus.textContent = t('shareCopyManually');
    }
  });

  /** @param {string} url @param {string | null | undefined} title */
  return async (url, title) => {
    const current = ++request;
    jobTitle.textContent = title || t('untitledJob');
    jobTitle.lang = title ? 'de-AT' : '';
    link.value = url;
    copyStatus.textContent = '';
    image.hidden = true;
    qrStatus.textContent = t('shareQrLoading');
    dialog.showModal();

    try {
      const { renderSVG } = await import('uqr');
      if (!dialog.open || current !== request) return;
      const svg = renderSVG(url, { ecc: 'M', border: 4, pixelSize: 1 });
      image.src = `data:image/svg+xml,${encodeURIComponent(svg)}`;
      image.alt = t('shareQrAlt');
      image.hidden = false;
      qrStatus.textContent = '';
    } catch {
      if (dialog.open && current === request) qrStatus.textContent = t('shareQrError');
    }
  };
}
