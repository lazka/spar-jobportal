import { node, number } from './dom.js';
import { distanceKm } from './jobs.js';

/** @import { Coordinates, Job } from './jobs.js' */
/** @typedef {((key: string) => void) | null} ShowSite */

const pageSize = 25;

/**
 * @param {string | null | undefined} url
 * @param {string} label
 */
function jobLink(url, label) {
  if (!url) return node('span', label);
  try {
    const target = new URL(url);
    if (target.protocol !== 'https:' || target.hostname !== 'jobs.spar.at') return node('span', label);
    const anchor = node('a', label);
    anchor.href = target.href;
    anchor.target = '_blank';
    anchor.rel = 'noopener noreferrer';
    return anchor;
  } catch {
    return node('span', label);
  }
}

/**
 * @param {Job} job
 * @param {Coordinates | undefined} center
 * @param {ShowSite} onShowSite
 */
function jobCard(job, center, onShowSite) {
  const item = node('li', '', 'card');
  if (job.jobField) item.append(node('span', job.jobField, 'tag'));
  const title = node('h3');
  title.append(jobLink(job.detailUrl, job.title || 'Stellenangebot'));
  item.append(title, node('p', job.location ? `Dienstort: ${job.location}` : 'Kein Dienstort angegeben'));
  const details = [job.state, job.employmentType, job.start ? `Eintritt: ${job.start}` : ''].filter(Boolean);
  if (center && job.siteKey && job.unit?.coordinates) {
    details.push(`${number.format(Math.round(distanceKm(center, job.unit.coordinates)))} km Luftlinie zur Einheit`);
  }
  if (details.length) item.append(node('p', details.join(' · '), 'muted'));
  const actions = node('div', '', 'actions');
  if (job.applicationUrl) actions.append(jobLink(job.applicationUrl, 'Bewerben ↗'));
  const siteKey = job.siteKey;
  if (onShowSite && siteKey) {
    const button = node('button', 'Einheit auf Karte');
    button.type = 'button';
    button.addEventListener('click', () => onShowSite(siteKey));
    actions.append(button);
  }
  if (actions.childElementCount) item.append(actions);
  return item;
}

/**
 * @param {{list: HTMLElement, more: HTMLElement, count: HTMLElement, selection: HTMLElement, message: HTMLElement}} elements
 * @param {ShowSite} onShowSite
 */
export function createJobList({ list, more, count, selection, message }, onShowSite) {
  /** @type {Job[]} */
  let shown = [];
  let rendered = 0;
  /** @type {Coordinates | undefined} */
  let center;

  function appendPage() {
    const next = shown.slice(rendered, rendered + pageSize);
    list.append(...next.map(job => jobCard(job, center, onShowSite)));
    rendered += next.length;
    more.hidden = rendered >= shown.length;
    if (!more.hidden) more.textContent = `Weitere Stellen anzeigen (${number.format(shown.length - rendered)})`;
  }

  more.addEventListener('click', () => {
    const firstNew = rendered;
    appendPage();
    const link = list.children[firstNew]?.querySelector('h3 a');
    if (link instanceof HTMLAnchorElement) link.focus();
  });

  /**
   * @param {Job[]} jobs
   * @param {{selected: string | null, center?: Coordinates}} options
   */
  function render(jobs, { selected, center: activeCenter }) {
    shown = jobs;
    center = activeCenter;
    const unmapped = shown.filter(job => !job.siteKey).length;
    count.textContent = `${number.format(shown.length)} ${shown.length === 1 ? 'Stelle' : 'Stellen'}` +
      (unmapped ? ` · ${number.format(unmapped)} ohne Pin` : '');
    selection.hidden = !selected;
    message.hidden = shown.length !== 0;
    message.textContent = 'Keine passenden Stellen. Versuche es mit einem anderen Suchbegriff oder weniger Filtern.';
    list.replaceChildren();
    rendered = 0;
    appendPage();
  }

  function showLoadError() {
    count.textContent = 'Keine Daten geladen';
    message.hidden = false;
    message.textContent = 'spar_jobs_final.json konnte nicht geladen werden.';
  }

  return { render, showLoadError };
}
