import { node } from './dom.js';
import { jobLabel, t } from './i18n.js';
import { distanceKm } from './jobs.js';

/** @import { Coordinates, Job } from './jobs.js' */
/** @typedef {((key: string) => void) | null} ShowSite */
/** @typedef {(url: string, title: Job['title']) => Promise<void>} ShareJob */

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

/** @param {string} pathData */
function cardIcon(pathData) {
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
  target.setAttribute('d', pathData);
  icon.append(target);
  return icon;
}

/**
 * @param {Job} job
 * @param {Coordinates | undefined} center
 * @param {ShowSite} onShowSite
 * @param {ShareJob} onShare
 */
function jobCard(job, center, onShowSite, onShare) {
  const item = node('li', '', 'card');
  const orgType = job.unit?.orgType;
  if (job.jobField || orgType) {
    const tags = node('div', '', 'card-tags');
    if (job.jobField) tags.append(node('span', jobLabel('field', job.jobField), 'tag'));
    if (orgType) {
      const organisation = node('span', orgType, 'tag');
      organisation.classList.add('tag-neutral');
      tags.append(organisation);
    }
    item.append(tags);
  }
  const title = node('h3', job.title || t('untitledJob'));
  if (job.title) title.lang = 'de-AT';
  const location = node('p', '', 'card-location');
  const locationText = node('span', job.location || t('noWorkLocation'));
  if (job.location) {
    locationText.lang = 'de-AT';
    location.append(cardIcon('M20 10c0 5-8 11-8 11S4 15 4 10a8 8 0 1 1 16 0ZM15 10a3 3 0 1 1-6 0 3 3 0 1 1 6 0Z'));
  }
  location.append(locationText);
  item.append(title, location);
  /** @type {(string | HTMLElement)[]} */
  const details = [];
  if (job.times.length) {
    details.push(job.times.map(value => jobLabel('employment', value)).join(' / '));
  }
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
    const metadata = node('ul', '', 'card-details');
    metadata.setAttribute('role', 'list');
    for (const detail of details) {
      const entry = node('li');
      entry.append(detail);
      metadata.append(entry);
    }
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
    button.append(cardIcon('M20 12a8 8 0 1 1-16 0 8 8 0 0 1 16 0ZM12 2v5m0 10v5M2 12h5m10 0h5'));
    button.addEventListener('click', () => onShowSite(siteKey));
    actions.append(button);
  }
  if (posting) {
    const button = node('button', '', 'share-job');
    button.type = 'button';
    button.title = t('shareJob');
    button.setAttribute('aria-label', button.title);
    button.setAttribute('aria-haspopup', 'dialog');
    button.append(cardIcon('M18 2a3 3 0 1 1 0 6 3 3 0 1 1 0-6ZM6 9a3 3 0 1 1 0 6 3 3 0 1 1 0-6ZM18 16a3 3 0 1 1 0 6 3 3 0 1 1 0-6ZM8.6 10.5l6.8-4M8.6 13.5l6.8 4'));
    button.addEventListener('click', () => {
      button.focus();
      void onShare(posting.href, job.title);
    });
    actions.append(button);
  }
  if (actions.childElementCount) item.append(actions);
  return item;
}

/**
 * @param {{list: HTMLElement, more: HTMLElement, count: HTMLElement, selection: HTMLElement, message: HTMLElement}} elements
 * @param {ShowSite} onShowSite
 * @param {ShareJob} onShare
 */
export function createJobList({ list, more, count, selection, message }, onShowSite, onShare) {
  /** @type {Job[]} */
  let shown = [];
  let rendered = 0;
  /** @type {Coordinates | undefined} */
  let center;

  function appendPage(size = pageSize) {
    const next = shown.slice(rendered, rendered + size);
    list.append(...next.map(job => jobCard(job, center, onShowSite, onShare)));
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
   * @param {{selected: string | null, center?: Coordinates, preservePages?: boolean, limitToMapView?: boolean}} options
   */
  function render(jobs, { selected, center: activeCenter, preservePages, limitToMapView }) {
    shown = jobs;
    center = activeCenter;
    count.textContent = t('jobCount', { count: shown.length });
    selection.hidden = !selected;
    message.hidden = shown.length !== 0;
    message.textContent = t(limitToMapView ? 'noJobsInMapView' : 'noJobs');
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
