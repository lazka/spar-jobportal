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
  if (!url) return null;
  try {
    const target = new URL(url);
    if (target.protocol !== 'https:' || target.hostname !== 'jobs.spar.at') return null;
    const anchor = node('a', label, 'button');
    anchor.href = target.href;
    anchor.target = '_blank';
    anchor.rel = 'noopener noreferrer';
    return anchor;
  } catch {
    return null;
  }
}

function targetIcon() {
  const ns = 'http://www.w3.org/2000/svg';
  const icon = document.createElementNS(ns, 'svg');
  icon.setAttribute('viewBox', '0 0 24 24');
  icon.setAttribute('width', '18');
  icon.setAttribute('height', '18');
  icon.setAttribute('fill', 'none');
  icon.setAttribute('stroke', 'currentColor');
  icon.setAttribute('stroke-width', '2');
  icon.setAttribute('stroke-linecap', 'round');
  icon.setAttribute('aria-hidden', 'true');
  const target = document.createElementNS(ns, 'path');
  target.setAttribute('d', 'M20 12a8 8 0 1 1-16 0 8 8 0 0 1 16 0ZM12 2v5m0 10v5M2 12h5m10 0h5');
  icon.append(target);
  return icon;
}

/**
 * @param {Job} job
 * @param {Coordinates | undefined} center
 * @param {ShowSite} onShowSite
 */
function jobCard(job, center, onShowSite) {
  const item = node('li', '', 'card');
  if (job.jobField) item.append(node('span', job.jobField, 'tag'));
  item.append(node('h3', job.title || 'Stellenangebot'),
    node('p', job.location ? `Dienstort: ${job.location}` : 'Kein Dienstort angegeben'));
  const details = [job.state, job.employmentType, job.start ? `Eintritt: ${job.start}` : ''].filter(Boolean);
  if (center && job.siteKey && job.unit?.coordinates) {
    details.push(`${number.format(Math.round(distanceKm(center, job.unit.coordinates)))} km Luftlinie zur Einheit`);
  }
  if (details.length) item.append(node('p', details.join(' · '), 'muted'));
  const actions = node('div', '', 'actions');
  const posting = jobLink(job.detailUrl, 'Stellenanzeige ↗');
  if (posting) actions.append(posting);
  const apply = jobLink(job.applicationUrl, 'Jetzt bewerben ↗');
  if (apply) {
    apply.classList.add('button-primary');
    actions.append(apply);
  }
  const siteKey = job.siteKey;
  if (onShowSite && siteKey) {
    const button = node('button', '', 'show-site');
    button.type = 'button';
    button.title = 'Einheit auf Karte anzeigen';
    button.setAttribute('aria-label', button.title);
    button.append(targetIcon());
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
    const heading = list.children[firstNew]?.querySelector('h3');
    if (heading) {
      heading.tabIndex = -1;
      heading.focus();
    }
  });

  /**
   * @param {Job[]} jobs
   * @param {{selected: string | null, center?: Coordinates}} options
   */
  function render(jobs, { selected, center: activeCenter }) {
    shown = jobs;
    center = activeCenter;
    count.textContent = `${number.format(shown.length)} ${shown.length === 1 ? 'Stelle' : 'Stellen'}`;
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
