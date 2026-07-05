// ==UserScript==
// @name         F95Zone Thread Grid View
// @namespace    f95zone-grid
// @version      1.1
// @description  Adds a toggle to display F95Zone forum thread lists (e.g. Asset Releases) as a responsive grid of cards with cover thumbnails, with infinite scroll across pages
// @match        https://f95zone.to/forums/*
// @match        https://f95zone.to/forums/*?*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  const STYLE = `
    .f95-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 14px; padding: 10px 0; }
    .f95-card { background: var(--xf-contentBg, #1e1e1e); border: 1px solid #3336; border-radius: 8px; overflow: hidden; display: flex; flex-direction: column; text-decoration: none; transition: transform .15s, box-shadow .15s; }
    .f95-card:hover { transform: translateY(-3px); box-shadow: 0 6px 16px rgba(0,0,0,.35); }
    .f95-thumb-wrap { width: 100%; aspect-ratio: 16/9; background: #00000022; display:flex; align-items:center; justify-content:center; overflow:hidden; }
    .f95-thumb-wrap img { width:100%; height:100%; object-fit: cover; display:block; }
    .f95-thumb-placeholder { font-size: 12px; opacity:.5; }
    .f95-body { padding: 8px 10px; display:flex; flex-direction:column; gap:5px; flex:1; }
    .f95-prefixes { display:flex; gap:4px; flex-wrap:wrap; }
    .f95-prefix { font-size: 10px; padding:1px 5px; border-radius:4px; background:#80808033; }
    .f95-title { font-size: 13px; font-weight:600; line-height:1.3; }
    .f95-meta { font-size: 11px; opacity: .65; display:flex; justify-content:space-between; margin-top:auto; gap:6px; }
    .f95-toggle-btn { margin: 8px 0; padding: 6px 12px; cursor:pointer; border:1px solid #80808066; background:transparent; border-radius:6px; font-size:13px; }
    .f95-sentinel { grid-column: 1 / -1; text-align:center; padding: 14px; font-size: 12px; opacity:.6; }
  `;

  function injectStyle() {
    const s = document.createElement('style');
    s.textContent = STYLE;
    document.head.appendChild(s);
  }

  const thumbCache = new Map();

  function cardForItem(item) {
    const titleLink = item.querySelector('.structItem-title a[data-tp-primary]') ||
                       item.querySelector('.structItem-title a:not(.labelLink)');
    if (!titleLink) return null;

    const href = titleLink.href;
    const title = titleLink.textContent.trim();
    const previewUrl = titleLink.getAttribute('data-preview-url');

    const prefixes = Array.from(item.querySelectorAll('.labelLink'))
      .map(p => p.textContent.trim())
      .filter(Boolean);

    const lastPostEl = item.querySelector('.structItem-latestDate, .structItem-cell--latest time, time');
    const lastPostText = lastPostEl ? lastPostEl.textContent.trim() : '';

    const metaDds = item.querySelectorAll('.structItem-cell--meta .pairs--justified dd');
    const repliesText = metaDds[0] ? `${metaDds[0].textContent.trim()} replies` : '';
    const viewsText = metaDds[1] ? `${metaDds[1].textContent.trim()} views` : '';

    const card = document.createElement('a');
    card.className = 'f95-card';
    card.href = href;

    const thumbWrap = document.createElement('div');
    thumbWrap.className = 'f95-thumb-wrap';
    thumbWrap.innerHTML = '<span class="f95-thumb-placeholder">…</span>';
    card.appendChild(thumbWrap);

    const body = document.createElement('div');
    body.className = 'f95-body';

    if (prefixes.length) {
      const prefixWrap = document.createElement('div');
      prefixWrap.className = 'f95-prefixes';
      prefixes.forEach(p => {
        const span = document.createElement('span');
        span.className = 'f95-prefix';
        span.textContent = p;
        prefixWrap.appendChild(span);
      });
      body.appendChild(prefixWrap);
    }

    const titleEl = document.createElement('div');
    titleEl.className = 'f95-title';
    titleEl.textContent = title;
    body.appendChild(titleEl);

    const meta = document.createElement('div');
    meta.className = 'f95-meta';
    meta.innerHTML = `<span>${repliesText} &middot; ${viewsText}</span><span>${lastPostText}</span>`;
    body.appendChild(meta);

    card.appendChild(body);

    if (previewUrl) {
      lazyLoadThumb(previewUrl, thumbWrap);
    } else {
      setThumb(thumbWrap, null);
    }

    return card;
  }

  function buildGrid(list) {
    const items = Array.from(list.querySelectorAll('.structItem'));
    if (!items.length) return null;

    const grid = document.createElement('div');
    grid.className = 'f95-grid';

    items.forEach(item => {
      const card = cardForItem(item);
      if (card) grid.appendChild(card);
    });

    return grid;
  }

  function lazyLoadThumb(previewUrl, wrap) {
    const observer = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          observer.disconnect();
          fetchThumb(previewUrl, wrap);
        }
      });
    }, { rootMargin: '200px' });
    observer.observe(wrap);
  }

  async function fetchThumb(previewUrl, wrap) {
    if (thumbCache.has(previewUrl)) {
      setThumb(wrap, thumbCache.get(previewUrl));
      return;
    }
    try {
      const csrf = document.documentElement.getAttribute('data-csrf') || '';
      const url = new URL(previewUrl, location.origin);
      url.searchParams.set('_xfRequestUri', location.pathname + location.search);
      url.searchParams.set('_xfWithData', '1');
      url.searchParams.set('_xfToken', csrf);
      url.searchParams.set('_xfResponseType', 'json');

      const res = await fetch(url.toString(), {
        credentials: 'same-origin',
        headers: { 'X-Requested-With': 'XMLHttpRequest' }
      });
      const data = await res.json();
      if (data.status !== 'ok') {
        console.warn('[f95-grid] preview fetch failed', previewUrl, data);
      }
      const contentHtml = data && data.html && data.html.content;
      let src = null;
      if (contentHtml) {
        const doc = new DOMParser().parseFromString(contentHtml, 'text/html');
        const img = doc.querySelector('img.bbImage');
        src = img ? (img.getAttribute('data-src') || img.getAttribute('src')) : null;
      }
      if (src && /\/assets\/logo\.png|^data:/.test(src)) src = null;
      if (src && src.startsWith('/')) src = new URL(src, location.origin).href;
      thumbCache.set(previewUrl, src);
      setThumb(wrap, src);
    } catch (e) {
      setThumb(wrap, null);
    }
  }

  function setThumb(wrap, src) {
    wrap.innerHTML = '';
    if (src) {
      const img = document.createElement('img');
      img.src = src;
      img.loading = 'lazy';
      wrap.appendChild(img);
    } else {
      wrap.innerHTML = '<span class="f95-thumb-placeholder">no preview</span>';
    }
  }

  function getNextPageUrl(doc) {
    const linkEl = doc.querySelector('link[rel="next"]');
    if (linkEl && linkEl.href) return linkEl.href;
    const navNext = doc.querySelector('.pageNav-jump--next');
    return navNext ? navNext.href : null;
  }

  function setupInfiniteScroll(grid) {
    let nextPageUrl = getNextPageUrl(document);
    let loading = false;
    let exhausted = !nextPageUrl;

    const sentinel = document.createElement('div');
    sentinel.className = 'f95-sentinel';
    sentinel.textContent = exhausted ? 'No more threads' : '';
    grid.appendChild(sentinel);

    async function loadMore() {
      if (loading || exhausted || !nextPageUrl) return;
      loading = true;
      sentinel.textContent = 'Loading more…';
      try {
        const res = await fetch(nextPageUrl, { credentials: 'same-origin' });
        const html = await res.text();
        const doc = new DOMParser().parseFromString(html, 'text/html');
        const newList = doc.querySelector('.structItemContainer');
        const items = newList ? Array.from(newList.querySelectorAll('.structItem')) : [];

        items.forEach(item => {
          const card = cardForItem(item);
          if (card) grid.insertBefore(card, sentinel);
        });

        nextPageUrl = getNextPageUrl(doc);
        if (!nextPageUrl) {
          exhausted = true;
          sentinel.textContent = 'No more threads';
        } else {
          sentinel.textContent = '';
        }
      } catch (e) {
        console.warn('[f95-grid] failed to load next page', e);
        sentinel.textContent = 'Failed to load more (scroll to retry)';
      } finally {
        loading = false;
      }
    }

    const observer = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (entry.isIntersecting) loadMore();
      });
    }, { rootMargin: '600px' });
    observer.observe(sentinel);
  }

  function init() {
    const list = document.querySelector('.structItemContainer');
    if (!list || list.dataset.f95GridInit) return;
    list.dataset.f95GridInit = '1';

    injectStyle();

    const toggleBtn = document.createElement('button');
    toggleBtn.className = 'f95-toggle-btn';
    toggleBtn.textContent = 'Switch to Grid View';
    list.parentElement.insertBefore(toggleBtn, list);

    let gridEl = null;
    let showingGrid = false;

    toggleBtn.addEventListener('click', () => {
      showingGrid = !showingGrid;
      if (showingGrid) {
        if (!gridEl) {
          gridEl = buildGrid(list);
          if (gridEl) setupInfiniteScroll(gridEl);
        }
        if (gridEl) {
          list.style.display = 'none';
          list.parentElement.insertBefore(gridEl, list.nextSibling);
        }
        toggleBtn.textContent = 'Switch to List View';
      } else {
        if (gridEl) gridEl.remove();
        list.style.display = '';
        toggleBtn.textContent = 'Switch to Grid View';
      }
    });
  }

  function start() {
    setTimeout(init, 300);
  }

  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    start();
  } else {
    window.addEventListener('DOMContentLoaded', start);
  }
})();
