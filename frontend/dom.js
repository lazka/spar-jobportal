export const number = new Intl.NumberFormat('de-AT');

/**
 * @template {keyof HTMLElementTagNameMap} Tag
 * @param {Tag} tag
 * @param {string} [text]
 * @param {string} [className]
 * @returns {HTMLElementTagNameMap[Tag]}
 */
export function node(tag, text, className) {
  const element = document.createElement(tag);
  if (text) element.textContent = text;
  if (className) element.className = className;
  return element;
}
