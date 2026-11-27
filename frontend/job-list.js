import { node } from './dom.js';
import { jobLabel, t } from './i18n.js';
import { distanceKm, jobLocation } from './jobs.js';

/** @import { Coordinates, Job } from './jobs.js' */
/** @typedef {((key: string) => void) | null} ShowSite */
/** @typedef {(url: string, title: Job['title']) => Promise<void>} ShareJob */

const pageSize = 25;

/**
 * @param {string | null | undefined} url
 * @param {string} label
 * @param {string} hostname
 */
function sparLink(url, label, hostname = 'jobs.spar.at') {
  if (!url) return null;
  try {
    const target = new URL(url);
    if (target.origin !== `https://${hostname}` || target.username || target.password) return null;
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
    if (job.jobField) {
      const field = node('span', jobLabel('field', job.jobField), 'tag');
      field.title = t('field');
      tags.append(field);
    }
    if (orgType) {
      const organisation = node('span', orgType, 'tag tag-neutral');
      organisation.title = t('organisation');
      tags.append(organisation);
    }
    item.append(tags);
  }
  const title = node('h3', job.title || t('untitledJob'));
  if (job.title) title.lang = 'de-AT';
  const location = node('p', '', 'card-location');
  const place = jobLocation(job);
  const locationText = node('span', place || t('noWorkLocation'));
  if (place) {
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
  if (center && job.siteCoordinates) {
    details.push(t('distance', { distance: Math.round(distanceKm(center, job.siteCoordinates)) }));
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
  const posting = sparLink(job.detailUrl, t('posting'));
  if (posting) actions.append(posting);
  const apply = sparLink(job.applicationUrl, t('apply'));
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
  const shop = sparLink(job.unit?.relatedShop?.pageUrl, t('viewShop'), 'www.spar.at');
  if (posting || shop) {
    const more = node('details', '', 'card-more');
    more.setAttribute('name', 'job-actions');
    const toggle = node('summary');
    toggle.title = t('moreJobActions');
    toggle.setAttribute('aria-label', toggle.title);
    toggle.append(cardIcon('M5 12h.01M12 12h.01M19 12h.01'));
    const menu = node('div', '', 'card-more-actions');
    if (shop) {
      const external = node('span', ' ↗');
      external.setAttribute('aria-hidden', 'true');
      shop.append(external);
      menu.append(shop);
    }
    if (posting) {
      const share = node('button', t('shareJob'));
      share.type = 'button';
      share.setAttribute('aria-haspopup', 'dialog');
      share.addEventListener('click', () => {
        toggle.focus();
        more.open = false;
        void onShare(posting.href, job.title);
      });
      menu.append(share);
    }
    more.append(toggle, menu);
    actions.append(more);
  }
  if (actions.childElementCount) item.append(actions);
  return item;
}

/**
 * @param {{list: HTMLElement, more: HTMLElement, count: HTMLElement, message: HTMLElement}} elements
 * @param {ShowSite} onShowSite
 * @param {ShareJob} onShare
 */
export function createJobList({ list, more, count, message }, onShowSite, onShare) {
  /** @type {Job[]} */
  let shown = [];
  let rendered = 0;
  /** @type {Coordinates | undefined} */
  let center;

  document.addEventListener('click', event => {
    const open = list.querySelector('details.card-more[open]');
    if (open && event.target instanceof Node && !open.contains(event.target)) {
      open.removeAttribute('open');
    }
  });
  list.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || !(event.target instanceof Element)) return;
    const open = event.target.closest('details.card-more[open]');
    if (!open) return;
    event.preventDefault();
    open.removeAttribute('open');
    open.querySelector('summary')?.focus();
  });

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
   * @param {{center?: Coordinates, preservePages?: boolean, limitToMapView?: boolean}} options
   */
  function render(jobs, { center: activeCenter, preservePages, limitToMapView }) {
    shown = jobs;
    center = activeCenter;
    count.textContent = t('jobCount', { count: shown.length });
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
