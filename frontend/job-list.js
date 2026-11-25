import { node } from './dom.js';
import { jobLabel, t } from './i18n.js';
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
  if (job.jobField) item.append(node('span', jobLabel('field', job.jobField), 'tag'));
  const title = node('h3', job.title || t('untitledJob'));
  if (job.title) title.lang = 'de-AT';
  const location = node('p', job.location ? `${t('workLocation')} ` : t('noWorkLocation'));
  if (job.location) {
    const sourceLocation = node('span', job.location);
    sourceLocation.lang = 'de-AT';
    location.append(sourceLocation);
  }
  item.append(title, location);
  /** @type {(string | HTMLElement)[]} */
  const details = [jobLabel('state', job.state), job.times.map(value => jobLabel('employment', value)).join(' / ')].filter(Boolean);
  if (job.start) {
    const sourceStart = node('span', job.start);
    sourceStart.lang = 'de-AT';
    const start = node('span', `${t('start')} `);
    start.append(sourceStart);
    details.push(start);
  }
  if (center && job.siteKey && job.unit?.coordinates) {
    details.push(t('distance', { distance: Math.round(distanceKm(center, job.unit.coordinates)) }));
  }
  if (details.length) {
    const metadata = node('p', '', 'muted');
    details.forEach((detail, index) => {
      if (index > 0) metadata.append(' · ');
      metadata.append(detail);
    });
    item.append(metadata);
  }
  const actions = node('div', '', 'actions');
  const posting = jobLink(job.detailUrl, t('posting'));
  if (posting) actions.append(posting);
  const apply = jobLink(job.applicationUrl, t('apply'));
  if (apply) {
    apply.classList.add('button-primary');
    actions.append(apply);
  }
  const siteKey = job.siteKey;
  if (onShowSite && siteKey) {
    const button = node('button', '', 'show-site');
    button.type = 'button';
    button.title = t('showSite');
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

  function appendPage(size = pageSize) {
    const next = shown.slice(rendered, rendered + size);
    list.append(...next.map(job => jobCard(job, center, onShowSite)));
    rendered += next.length;
    more.hidden = rendered >= shown.length;
    if (!more.hidden) more.textContent = t('moreJobsCount', { count: shown.length - rendered });
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
   * @param {{selected: string | null, center?: Coordinates, preservePages?: boolean}} options
   */
  function render(jobs, { selected, center: activeCenter, preservePages }) {
    shown = jobs;
    center = activeCenter;
    count.textContent = t('jobCount', { count: shown.length });
    selection.hidden = !selected;
    message.hidden = shown.length !== 0;
    message.textContent = t('noJobs');
    list.replaceChildren();
    const size = preservePages ? Math.max(pageSize, rendered) : pageSize;
    rendered = 0;
    appendPage(size);
  }

  function showLoadError() {
    count.textContent = t('jobsNotLoaded');
    message.hidden = false;
    message.textContent = t('jobsLoadError');
  }

  return { render, showLoadError };
}
