import i18next from 'i18next';
import { UNKNOWN_ORG_TYPE } from './jobs.js';
import { de, en, englishLabel } from './translations.js';

const preferenceKey = 'spar-jobportal-language';

/** @typedef {'de' | 'en'} Language */

export function language() {
  return i18next.language === 'en' ? 'en' : 'de';
}

export function locale() {
  return language() === 'en' ? 'en-GB' : 'de-AT';
}

export function initLanguage() {
  let lng = 'de';
  try {
    if (window.localStorage.getItem(preferenceKey) === 'en') lng = 'en';
  } catch {
    // The app can still be used when storage is unavailable.
  }
  return i18next.init({
    lng, supportedLngs: ['de', 'en'], fallbackLng: 'de',
    resources: { de: { translation: de }, en: { translation: en } },
    // Translations and interpolated data are inserted as text, not HTML.
    interpolation: { escapeValue: false },
  });
}

/** @param {Language} lng */
export async function changeLanguage(lng) {
  await i18next.changeLanguage(lng);
  try {
    window.localStorage.setItem(preferenceKey, lng);
  } catch {
    // Keep the selection for the current page.
  }
}

/**
 * @param {string} key
 * @param {Record<string, string | number>} [values]
 */
export function t(key, values) {
  return values ? i18next.t(key, values) : i18next.t(key);
}

/** @param {ParentNode} root */
export function translateMarkup(root) {
  for (const element of root.querySelectorAll('[data-i18n]')) {
    const key = element.getAttribute('data-i18n');
    if (key) element.textContent = t(key);
  }
  for (const attribute of ['aria-label', 'placeholder', 'title']) {
    for (const element of root.querySelectorAll(`[data-i18n-${attribute}]`)) {
      const key = element.getAttribute(`data-i18n-${attribute}`);
      if (key) element.setAttribute(attribute, t(key));
    }
  }
}

/**
 * @param {Parameters<typeof englishLabel>[0] | 'organisation'} category
 * @param {string} value
 */
export function jobLabel(category, value) {
  if (category === 'organisation') return value === UNKNOWN_ORG_TYPE ? t('unknownOrganisation') : value;
  return language() === 'en' ? englishLabel(category, value) : value;
}
