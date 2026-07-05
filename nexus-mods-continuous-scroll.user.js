// ==UserScript==
// @name         Nexus Mods – Continuous Scroll & Filter Memory
// @namespace    nexus-mods-continuous-scroll
// @version      10.0.0
// @description  Infinite-scrolls mod listing/search pages on both www.nexusmods.com (classic) and next.nexusmods.com (new); remembers your filter choices per game between visits; dims mods you've already viewed; highlights mods new since your last visit; adds a Track/Untrack toggle to each grid card; and can show your full download history for a game.
// @match        https://www.nexusmods.com/*
// @match        https://next.nexusmods.com/games/*/mods*
// @match        https://next.nexusmods.com/games/*/search*
// @match        https://next.nexusmods.com/search*
// @run-at       document-idle
// @grant        none
// @noframes
// ==/UserScript==

/*
 * TWO SITES, TWO DIFFERENT TRICKS
 * -------------------------------------------------------------
 * Nexus currently runs two front ends side by side, and they need
 * fundamentally different pagination strategies:
 *
 *  - www.nexusmods.com (classic, server-rendered): the mod list is real
 *    HTML from the start. Pagination is handled by Invision's own
 *    "widget reload" AJAX endpoint — the page has to be requested again
 *    with a `?RH_<widgetId>=...` query string built from the widget's own
 *    JS state (bumping its `page` value) and an `X-Requested-With:
 *    XMLHttpRequest` header, which returns just the next batch of
 *    `<li>` tiles plus a refreshed pagination widget. That's a plain
 *    fetch()-and-splice job — no click simulation needed.
 *
 *  - next.nexusmods.com (new, Next.js/React): the grid's data loads
 *    client-side via React Query *after* the page mounts, so even the
 *    HTML for page 2 fetched directly is just empty skeleton
 *    placeholders — there's no real data to scrape from a background
 *    fetch. Instead this script clicks the site's own pagination
 *    control (a real click, so React's router does its normal thing),
 *    but first clones the currently-visible cards — never touching the
 *    live React-owned nodes, which is what avoids fights with React's
 *    own reconciler — and re-inserts those clones just before whatever
 *    new cards React renders, so the grid grows downward instead of
 *    being replaced. Cards from older pages keep their links/thumbnails
 *    working but lose any React-only interactivity once a newer page
 *    has loaded past them.
 *
 * ADAPTING THIS SCRIPT IF SOMETHING DOESN'T MATCH YOUR PAGE
 * -------------------------------------------------------------
 * Everything logs under the "[NX-Scroll]" console tag. If infinite
 * scroll doesn't kick in on a page, open devtools and look for a
 * warning there — it names exactly what selector/global it expected
 * and didn't find, which is the fastest way to tell me what to fix.
 */

(function () {
  'use strict';

  const TAG = '[NX-Scroll]';
  const log = (...a) => console.log(TAG, ...a);
  const warn = (...a) => console.warn(TAG, ...a);

  const SKELETON_CLASS = 'animate-pulse'; // new-frontend loading-placeholder marker

  // Nexus now serves the new React frontend under both next.nexusmods.com
  // AND www.nexusmods.com (e.g. /games/<domain>/mods URLs), so which
  // pagination style a page uses can no longer be decided by hostname —
  // it has to be detected from what's actually in the DOM. See
  // detectAndArm() below.

  // Filter-sidebar checkboxes: the new frontend ships stable `data-e2eid`
  // test hooks for its filter blocks. The old Invision-era markup has no
  // equivalent documented hook, so this also tries a narrow id-based
  // fallback — deliberately not matching on bare `.filter`/`[class*=filter]`
  // classes, since Tailwind itself ships a utility class literally named
  // `filter` (for CSS filter/blur effects) that would cause false matches.
  const FILTER_BLOCK_SELECTOR = '[data-e2eid$="-filter"], #filter, [id$="-filter"], [id^="filter-"]';

  function waitForElement(selector, root = document, timeoutMs = 20000) {
    return new Promise((resolve) => {
      const existing = root.querySelector(selector);
      if (existing) return resolve(existing);
      const obs = new MutationObserver(() => {
        const el = root.querySelector(selector);
        if (el) {
          obs.disconnect();
          clearTimeout(t);
          resolve(el);
        }
      });
      obs.observe(root, { childList: true, subtree: true });
      const t = setTimeout(() => {
        obs.disconnect();
        resolve(null);
      }, timeoutMs);
    });
  }

  function waitForLoadedChildren(container, timeoutMs = 20000) {
    return new Promise((resolve) => {
      const settled = () => {
        const kids = Array.from(container.children);
        return kids.length > 0 && kids.every((k) => !k.classList.contains(SKELETON_CLASS));
      };
      if (settled()) return resolve(true);
      const obs = new MutationObserver(() => {
        if (settled()) {
          obs.disconnect();
          clearTimeout(t);
          resolve(true);
        }
      });
      obs.observe(container, { childList: true });
      const t = setTimeout(() => {
        obs.disconnect();
        resolve(false);
      }, timeoutMs);
    });
  }

  // Reuses the site's own Tailwind utility classes and `nxm-button`
  // component classes (seen throughout its markup, e.g. the "Show/Hide
  // filters" buttons) instead of inline styles, so anything we inject
  // picks up the same fonts/colors/spacing as everything around it. If a
  // page doesn't ship those classes (e.g. a very old template) this just
  // degrades to plain unstyled text — never broken, just less pretty.
  function makeSentinel(afterEl) {
    const sentinel = document.createElement('div');
    sentinel.className = 'flex items-center justify-center gap-x-2 py-6 text-body-sm text-neutral-subdued';
    afterEl.insertAdjacentElement('afterend', sentinel);
    return sentinel;
  }

  function renderSentinel(sentinel, { text, spinner = false, retry = null } = {}) {
    if (!sentinel) return;
    sentinel.innerHTML = '';
    if (!text) return;

    if (spinner) {
      sentinel.insertAdjacentHTML(
        'beforeend',
        '<svg viewBox="0 0 24 24" class="animate-spin shrink-0" style="width:1.1rem;height:1.1rem"><path d="M12,4V2A10,10 0 0,0 2,12H4A8,8 0 0,1 12,4Z" fill="currentColor"/></svg>'
      );
    }
    const span = document.createElement('span');
    span.textContent = text;
    sentinel.appendChild(span);

    if (retry) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'nxm-button nxm-button-sm nxm-button-secondary';
      btn.textContent = 'Try again';
      btn.addEventListener('click', retry);
      sentinel.appendChild(btn);
    }
  }

  // A small native-looking toast, used to surface the otherwise-invisible
  // filter-memory restores (console logs alone are easy to miss).
  function showToast(message) {
    const toast = document.createElement('div');
    toast.className = 'text-body-sm text-neutral-strong bg-surface-mid border border-stroke-subdued rounded shadow-lg px-4 py-2';
    toast.style.cssText =
      'position:fixed;bottom:20px;right:20px;z-index:9999;max-width:320px;opacity:0;transition:opacity .25s ease;pointer-events:none;';
    toast.textContent = message;
    document.body.appendChild(toast);
    requestAnimationFrame(() => {
      toast.style.opacity = '1';
    });
    setTimeout(() => {
      toast.style.opacity = '0';
      setTimeout(() => toast.remove(), 300);
    }, 3200);
  }

  // Every previous attempt at this only ever touched `window`/`document.body`
  // — if the page actually scrolls via some inner `overflow-y: auto`
  // wrapper instead (common in React apps), none of those could ever have
  // worked at all. This walks up from a given element to find whatever is
  // *actually* scrollable, treating `window` as just one more candidate
  // rather than assuming it.
  function getScrollContainers(fromEl) {
    const containers = [];
    let node = fromEl && fromEl.parentElement;
    while (node && node !== document.body && node !== document.documentElement) {
      const style = getComputedStyle(node);
      if ((style.overflowY === 'auto' || style.overflowY === 'scroll') && node.scrollHeight > node.clientHeight + 1) {
        containers.push(node);
      }
      node = node.parentElement;
    }
    containers.push(window); // always a candidate too, since most pages just scroll normally
    return containers;
  }

  function getScrollPos(target) {
    return target === window ? window.scrollY : target.scrollTop;
  }
  function setScrollPos(target, y) {
    if (target === window) window.scrollTo(0, y);
    else target.scrollTop = y;
  }

  // Pins whatever a scroll container's current height is, so it can't get
  // shorter than it is right now during a transition (one way pages end up
  // scrolling on their own: the visible content briefly shrinks below the
  // current scroll position and the browser clamps it back up by itself).
  function pinHeight(target) {
    const el = target === window ? document.body : target;
    const heightNow = target === window ? document.documentElement.scrollHeight : target.scrollHeight;
    const prev = el.style.minHeight;
    el.style.minHeight = `${heightNow}px`;
    return () => {
      el.style.minHeight = prev;
    };
  }

  function describeContainer(c) {
    if (c === window) return 'window';
    return `${c.tagName.toLowerCase()}${c.id ? '#' + c.id : ''}${c.className ? '.' + String(c.className).trim().replace(/\s+/g, '.') : ''}`;
  }

  // Enforces an invariant every single frame, not just on scroll events:
  // scrolling further down is always accepted (and becomes the new
  // baseline), but any decrease is reverted immediately *unless* it was
  // accompanied by an actual upward-scroll input (wheel-up, PageUp/Home, a
  // touch drag) in the last moment — which catches both instant jumps and
  // multi-frame animated resets within a frame or two, while never
  // fighting the user's own scrolling in either direction (including
  // actively scrolling through the exact moment a page loads).
  function guardAgainstJump(fromEl, durationMs = 2500) {
    const containers = getScrollContainers(fromEl);
    const labels = containers.map(describeContainer);
    const ref = containers.map(getScrollPos);
    log('[scroll-guard] watching:', labels.map((l, i) => `${l}=${ref[i]}`).join(', '));

    let allowDecreaseUntil = 0;
    const allowDecrease = () => {
      allowDecreaseUntil = performance.now() + 400;
    };
    const onWheel = (e) => {
      if (e.deltaY < 0) allowDecrease();
    };
    const onKey = (e) => {
      if (e.key === 'ArrowUp' || e.key === 'PageUp' || e.key === 'Home') allowDecrease();
    };
    const onTouchMove = allowDecrease; // direction is ambiguous from touch alone; harmless to allow either way

    window.addEventListener('wheel', onWheel, { passive: true });
    window.addEventListener('keydown', onKey);
    window.addEventListener('touchmove', onTouchMove, { passive: true });

    let stopped = false;
    const stop = () => {
      if (stopped) return;
      stopped = true;
      window.removeEventListener('wheel', onWheel);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('touchmove', onTouchMove);
    };

    const start = performance.now();
    function tick() {
      if (stopped) return;
      if (performance.now() - start > durationMs) {
        log('[scroll-guard] done watching, final:', labels.map((l, i) => `${l}=${ref[i]}`).join(', '));
        return stop();
      }
      const decreaseAllowedNow = performance.now() < allowDecreaseUntil;
      containers.forEach((c, i) => {
        const now = getScrollPos(c);
        if (now >= ref[i] || decreaseAllowedNow) {
          if (Math.abs(now - ref[i]) > 20) log(`[scroll-guard] ${labels[i]} moved ${ref[i]} → ${now} (accepted)`);
          ref[i] = now;
        } else {
          warn(`[scroll-guard] ${labels[i]} CORRECTED: dropped to ${now}, restoring ${ref[i]}`);
          setScrollPos(c, ref[i]);
        }
      });
      requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
    return stop;
  }

  /* ============================================================ *
   * Legacy (www.nexusmods.com) — fetch + splice via the site's    *
   * own Invision "widget reload" AJAX endpoint.                    *
   * ============================================================ */
  const LegacyScroll = (() => {
    let list = null; // the <ul class="tiles"> (or equivalent) container
    let sentinel = null;
    let io = null;
    let loading = false;
    let exhausted = false;

    function setSentinelText(text, opts) {
      renderSentinel(sentinel, { text, ...opts });
    }

    function currentWidgetState() {
      if (/\/news/.test(location.pathname)) return window.RH_NewsTabContent;
      if (/\/users\//.test(location.pathname) && /tab=user\+files/i.test(location.search)) return window.RH_UserModsTab;
      if (/\/mods\//.test(location.pathname) && /tab=posts/i.test(location.search)) return window.RH_CommentContainer;
      return window.RH_ModList;
    }

    // Rebuilds one bracketed facet (categories[], tags_yes[], search[key])
    // that the brace-stripping below would otherwise mangle, since those
    // facets are arrays/objects rather than flat values.
    function rebuildFacet(name, value) {
      if (!value || (Array.isArray(value) && !value.length) || (typeof value === 'object' && !Object.keys(value).length)) {
        return null;
      }
      if (Array.isArray(value)) return value.map((v) => `${name}[]:${v}`).join(',');
      return Object.entries(value)
        .map(([k, v]) => `${name}[${k}]:${v}`)
        .join(',');
    }

    function buildNextPageUrl() {
      if (document.querySelector('.nexus-ui-blocker') || !document.querySelector('.pagination a.page-selected')) return null;

      const widget = currentWidgetState();
      if (!widget || !widget.out_items) {
        warn('No RH_* widget state found on this page — legacy pagination unavailable here.');
        return null;
      }

      const nextLink = document.evaluate(
        '//div[contains(@class,"pagination")][1]//a[contains(@class,"page-selected")]/../following-sibling::li[1]/a',
        document,
        null,
        XPathResult.FIRST_ORDERED_NODE_TYPE,
        null
      ).singleNodeValue;
      const nextNum = nextLink && nextLink.textContent.trim();
      if (!nextNum) return null;

      let outItems = JSON.stringify(widget.out_items).replace(/[{}"]/g, '');
      outItems = outItems.includes('page:') ? outItems.replace(/page:\d+/, `page:${nextNum}`) : `${outItems},page:${nextNum}`;

      // Mod/user detail pages don't carry these list-level facets.
      if (!/\/(mods|users)\/\d+/.test(location.pathname)) {
        const { categories, tags_yes: tagsYes, search } = widget.out_items;
        const rebuiltCategories = rebuildFacet('categories', categories);
        if (rebuiltCategories && outItems.includes('categories:')) outItems = outItems.replace('categories:', `${rebuiltCategories},`);
        const rebuiltTags = rebuildFacet('tags_yes', tagsYes);
        if (rebuiltTags && outItems.includes('tags_yes:')) outItems = outItems.replace('tags_yes:', `${rebuiltTags},`);
        const rebuiltSearch = rebuildFacet('search', search);
        if (rebuiltSearch && outItems.includes('search:')) outItems = outItems.replace('search:', `${rebuiltSearch},`);
      }

      return `${location.origin}${widget.uri}?RH_${widget.id}=${outItems}`;
    }

    async function loadNextPage() {
      if (loading || exhausted || !list) return;
      const url = buildNextPageUrl();
      if (!url) {
        exhausted = true;
        setSentinelText('Reached the end of the list.');
        return;
      }

      loading = true;
      setSentinelText('Loading more mods…', { spinner: true });
      try {
        const res = await fetch(url, { credentials: 'same-origin', headers: { 'X-Requested-With': 'XMLHttpRequest' } });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const html = await res.text();
        const doc = new DOMParser().parseFromString(html, 'text/html');
        const items = Array.from(doc.querySelectorAll('ul.tiles > li'));

        items.forEach((item) => list.appendChild(document.importNode(item, true)));

        const newPager = doc.querySelector('.pagination');
        const oldPager = document.querySelector('.pagination');
        if (newPager && oldPager) oldPager.outerHTML = newPager.outerHTML;

        if (!items.length || !document.querySelector('.pagination a.page-selected')) {
          exhausted = true;
          setSentinelText('Reached the end of the list.');
        } else {
          setSentinelText('');
        }
        log(`Merged another page (${items.length} new tiles).`);
      } catch (e) {
        warn('Legacy page fetch failed:', e);
        setSentinelText('Failed to load more.', { retry: loadNextPage });
      } finally {
        loading = false;
      }
    }

    function teardown() {
      if (io) io.disconnect();
      if (sentinel) sentinel.remove();
      list = null;
      sentinel = null;
      io = null;
      loading = false;
      exhausted = false;
    }

    function init(listEl) {
      teardown();
      list = listEl;
      sentinel = makeSentinel(list);
      io = new IntersectionObserver(
        (entries) => {
          if (entries.some((e) => e.isIntersecting)) loadNextPage();
        },
        { rootMargin: '800px 0px' }
      );
      io.observe(sentinel);
      log('Legacy infinite scroll armed for', location.pathname + location.search);
    }

    return { init, teardown, buildNextPageUrl, currentWidgetState, list: () => list };
  })();

  async function armLegacyScroll() {
    if (!document.querySelector('.pagination a.page-selected')) {
      log('No paginated tile list on this page — nothing to arm.');
      return;
    }
    const list = document.querySelector('ul.tiles');
    if (!list) {
      warn('.pagination exists but ul.tiles was not found — selectors may be out of date.');
      return;
    }
    LegacyScroll.init(list);
  }

  /* ============================================================ *
   * SPA (next.nexusmods.com) — click the real pagination control  *
   * and clone-merge cards across the transition.                   *
   *                                                                  *
   * A background-iframe approach (load the next page's URL          *
   * invisibly, harvest its cards) was tried here to avoid the       *
   * scroll jump entirely, but Cloudflare treats that kind of        *
   * scripted, gesture-less, off-screen iframe navigation as bot     *
   * traffic and serves a JS challenge instead of the real page      *
   * (visible as a `__cf_chl_f_tk=...` param appended to the         *
   * request) — a dead end no amount of tuning gets around. Real     *
   * navigation via a genuine click is the only thing Cloudflare     *
   * reliably lets through, so the scroll jump has to be handled     *
   * via guardAgainstJump() below instead of avoided altogether.     *
   * ============================================================ */
  const SpaScroll = (() => {
    const GRID_SELECTOR = '.mods-grid';
    let grid = null;
    let sentinel = null;
    let io = null;
    let liveBatch = []; // current page's real, React-owned DOM nodes
    let loading = false;
    let exhausted = false;
    let expectingOwnNav = false; // true briefly while our own pagination click is in flight

    function isDisabled(el) {
      return (
        el.disabled ||
        el.hasAttribute('disabled') ||
        el.getAttribute('aria-disabled') === 'true' ||
        el.classList.contains('disabled')
      );
    }

    function findPaginationNav() {
      let nav = document.querySelector('nav[aria-label*="pagination" i]');
      if (nav) return nav;
      if (!grid) return null;
      for (const n of document.querySelectorAll('nav')) {
        if (!(grid.compareDocumentPosition(n) & Node.DOCUMENT_POSITION_FOLLOWING)) continue;
        const numeric = Array.from(n.querySelectorAll('a,button')).filter((el) => /^\d+$/.test(el.textContent.trim()));
        if (numeric.length >= 2) return n;
      }
      return null;
    }

    function findNextControl(nav) {
      if (!nav) return null;
      const explicit = nav.querySelector('a[aria-label*="next" i], button[aria-label*="next" i], a[rel="next"]');
      if (explicit && !isDisabled(explicit)) return explicit;
      const current = nav.querySelector('[aria-current="page"]');
      if (current) {
        let sib = current.nextElementSibling;
        while (sib && /^(\.{3}|…)$/.test(sib.textContent.trim())) sib = sib.nextElementSibling;
        if (sib && /^(a|button)$/i.test(sib.tagName) && !isDisabled(sib)) return sib;
      }
      return null;
    }

    function setSentinelText(text, opts) {
      renderSentinel(sentinel, { text, ...opts });
    }

    function clickEl(el) {
      ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach((type) => {
        el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
      });
    }

    function waitForFreshItems(preClickSet, timeoutMs = 15000) {
      return new Promise((resolve) => {
        let settleTimer = null;
        const finish = (result) => {
          obs.disconnect();
          clearTimeout(hardTimeout);
          clearTimeout(settleTimer);
          resolve(result);
        };
        const check = () => {
          if (!grid || !document.contains(grid)) return finish(null);
          const fresh = Array.from(grid.children).filter((n) => !preClickSet.has(n));
          const ready = fresh.length > 0 && fresh.every((n) => !n.classList.contains(SKELETON_CLASS));
          if (ready) {
            clearTimeout(settleTimer);
            settleTimer = setTimeout(() => finish(fresh), 300);
          }
        };
        const obs = new MutationObserver(check);
        obs.observe(grid, { childList: true });
        const hardTimeout = setTimeout(() => finish(null), timeoutMs);
        check();
      });
    }

    async function loadNextPage() {
      if (loading || exhausted || !grid) return;
      const nav = findPaginationNav();
      const nextEl = findNextControl(nav);
      if (!nextEl) {
        exhausted = true;
        setSentinelText('Reached the end of the list.');
        warn('No pagination "next" control found below .mods-grid — stopping.');
        return;
      }

      loading = true;
      setSentinelText('Loading more mods…', { spinner: true });

      // Everything currently in the grid, not just liveBatch — from the
      // second page onward the grid also holds clones from earlier
      // cycles, and those were never part of liveBatch. Without including
      // them here, "what's new after the click" would wrongly treat those
      // old clones as newly-arrived too, which fed them back into
      // liveBatch and got them cloned *again* the next cycle — compounding
      // every load into visibly duplicated cards.
      const preClickSet = new Set(grid.children);
      const clones = liveBatch.map((n) => n.cloneNode(true));

      // Pin whatever's actually scrolling near the grid — window or an
      // inner overflow container, detected fresh each time — so it can't
      // get shorter than it is right now while the next page loads, and
      // watch for an unexplained backward jump for a couple seconds after
      // (without interfering with ongoing normal scrolling at all, active
      // or not — see guardAgainstJump above).
      const releaseHeightPins = getScrollContainers(grid).map(pinHeight);
      const stopGuardingScroll = guardAgainstJump(grid, 2500);

      const releaseTransitionGuards = () => {
        releaseHeightPins.forEach((release) => release());
      };

      expectingOwnNav = true;
      clickEl(nextEl);

      let fresh;
      try {
        fresh = await waitForFreshItems(preClickSet);
      } finally {
        expectingOwnNav = false;
      }

      if (!fresh) {
        loading = false;
        stopGuardingScroll();
        releaseTransitionGuards();
        setSentinelText('Failed to load more.', { retry: loadNextPage });
        warn('Timed out waiting for the next page to render.');
        return;
      }

      const frag = document.createDocumentFragment();
      clones.forEach((c) => frag.appendChild(c));
      grid.insertBefore(frag, fresh[0]);

      liveBatch = fresh;

      // Release the height pin shortly after the merge settles; the scroll
      // guard keeps running independently until its own timer runs out.
      setTimeout(releaseTransitionGuards, 200);

      loading = false;
      setSentinelText('');
      log(`Merged another page (${fresh.length} new cards).`);
    }

    function teardown() {
      if (io) io.disconnect();
      if (sentinel) sentinel.remove();
      grid = null;
      sentinel = null;
      io = null;
      liveBatch = [];
      loading = false;
      exhausted = false;
    }

    function init(gridEl) {
      teardown();
      grid = gridEl;
      liveBatch = Array.from(grid.children);
      sentinel = makeSentinel(grid);
      io = new IntersectionObserver(
        (entries) => {
          if (entries.some((e) => e.isIntersecting)) loadNextPage();
        },
        { rootMargin: '800px 0px' }
      );
      io.observe(sentinel);
      log('SPA infinite scroll armed for', location.pathname + location.search, `(${liveBatch.length} cards on page 1)`);
    }

    return {
      init,
      teardown,
      isExpectingOwnNav: () => expectingOwnNav,
      GRID_SELECTOR,
      findPaginationNav,
      findNextControl,
      grid: () => grid,
    };
  })();

  /* ============================================================ *
   * Feature 2 — Remember filter checkbox choices                  *
   * Independent of infinite scroll: any checkbox inside a filter  *
   * block (category, content options, language support, etc.) is *
   * persisted per game, e.g. a "Hide translations" toggle if/when *
   * one exists in that game's filter panel.                        *
   * ============================================================ */
  const FilterMemory = (() => {
    const STORAGE_KEY = 'nx-filter-memory';

    function readStore() {
      try {
        return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
      } catch {
        return {};
      }
    }
    function writeStore(obj) {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(obj));
      } catch {
        /* storage disabled/full — silently skip persistence */
      }
    }

    function gameDomain() {
      const m = location.pathname.match(/\/games\/([^/]+)/);
      return m ? m[1] : 'global';
    }

    function blockId(input) {
      const block = input.closest(FILTER_BLOCK_SELECTOR);
      return block ? block.getAttribute('data-e2eid') || block.id || block.className.slice(0, 40) : 'unknown-filter';
    }

    function labelText(input) {
      if (input.id) {
        const lbl = document.querySelector(`label[for="${CSS.escape(input.id)}"]`);
        if (lbl && lbl.textContent.trim()) return lbl.textContent.trim();
      }
      const wrap = input.closest('label');
      if (wrap && wrap.textContent.trim()) return wrap.textContent.trim();
      if (input.nextElementSibling && input.nextElementSibling.textContent.trim()) {
        return input.nextElementSibling.textContent.trim();
      }
      return input.getAttribute('aria-label') || input.name || null;
    }

    function keyFor(input) {
      const label = labelText(input);
      if (!label) return null;
      return `${gameDomain()}::${blockId(input)}::${label.trim().toLowerCase()}`;
    }

    function restoreAndBind(input) {
      if (input.dataset.nxMemBound) return;
      input.dataset.nxMemBound = '1';

      const key = keyFor(input);
      if (key) {
        const store = readStore();
        if (Object.prototype.hasOwnProperty.call(store, key) && store[key] !== input.checked) {
          const label = labelText(input) || 'a saved filter';
          log('Restoring saved filter:', key, '→', store[key]);
          showToast(`Restored: ${label}`);
          input.click(); // real click → real change event → the site applies the filter itself
        }
      }

      input.addEventListener('change', () => {
        const k = keyFor(input);
        if (!k) return;
        const store = readStore();
        store[k] = input.checked;
        writeStore(store);
      });
    }

    function scan(root) {
      root.querySelectorAll(`${FILTER_BLOCK_SELECTOR} input[type="checkbox"]`).forEach(restoreAndBind);
    }

    function init() {
      scan(document);
      const mo = new MutationObserver((muts) => {
        for (const m of muts) {
          m.addedNodes.forEach((node) => {
            if (node.nodeType !== 1) return;
            if (node.matches?.(`${FILTER_BLOCK_SELECTOR} input[type="checkbox"]`)) restoreAndBind(node);
            node.querySelectorAll?.(`${FILTER_BLOCK_SELECTOR} input[type="checkbox"]`).forEach(restoreAndBind);
          });
        }
      });
      mo.observe(document.body, { childList: true, subtree: true });
      log('Filter memory active for game:', gameDomain());
    }

    return { init };
  })();

  /* ============================================================ *
   * Feature 3 — Remember URL-parameter filters                    *
   * Some site filters — like excluding the "Translation" tag,     *
   * which shows up as `?excludedTag=Translation` — are set through *
   * a search combobox rather than a plain checkbox, so Feature 2   *
   * above can never see them. Those live entirely in the query     *
   * string, so this remembers whichever non-ephemeral params are   *
   * present per game and, on a genuine fresh page load only,        *
   * re-appends any that are missing.                                *
   *                                                                  *
   * "Genuine fresh page load only" matters: if this also fired on   *
   * every in-session URL change, using the site's own UI to turn a  *
   * remembered filter back OFF would just have it silently added    *
   * right back, since "missing from the URL" would look identical   *
   * to "never set before". Restoring once per load and then only     *
   * ever recording (never force-adding) after that avoids fighting   *
   * the user's own live choices.                                     *
   * ============================================================ */
  const UrlFilterMemory = (() => {
    const STORAGE_KEY = 'nx-url-filter-memory';
    const IGNORED_PARAMS = new Set(['keyword', 'page']); // per-search / pagination, not standing preferences
    let seenThisSession = new Set(); // params observed present at least once since this page loaded

    function readStore() {
      try {
        return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
      } catch {
        return {};
      }
    }
    function writeStore(obj) {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(obj));
      } catch {
        /* storage disabled/full — silently skip persistence */
      }
    }

    function isModsListingUrl() {
      if (/\/mods\/\d+/.test(location.pathname)) return false; // an individual mod's own page, not a listing
      return /\/games\/[^/]+\/(mods|search)/.test(location.pathname) || /^\/search/.test(location.pathname);
    }

    function gameKey() {
      const m = location.pathname.match(/\/games\/([^/]+)\//);
      return m ? m[1] : 'global';
    }

    // Records whatever filter params are currently present, and — just as
    // importantly — forgets any that were seen present earlier *this
    // session* but have since disappeared, since that's the signal the
    // user actively turned a filter off through the site's own UI (this is
    // what was missing before: a plain refresh looks identical to "never
    // set this before" otherwise, so a removed filter kept getting restored
    // right back). Only pruning things concretely watched being removed —
    // rather than anything merely absent right now — avoids wiping other
    // saved preferences just because a given page load's URL doesn't
    // happen to mention them.
    function remember() {
      const game = gameKey();
      const params = new URLSearchParams(location.search);
      const presentKeys = new Set();
      const store = readStore();
      const forGame = store[game] || {};
      let changed = false;

      for (const [key, value] of params) {
        if (IGNORED_PARAMS.has(key)) continue;
        presentKeys.add(key);
        if (forGame[key] !== value) {
          forGame[key] = value;
          changed = true;
        }
      }

      for (const key of seenThisSession) {
        if (!presentKeys.has(key) && Object.prototype.hasOwnProperty.call(forGame, key)) {
          delete forGame[key];
          changed = true;
          log('Forgetting removed filter for', game, ':', key);
        }
      }
      seenThisSession = presentKeys;

      if (changed) {
        store[game] = forGame;
        writeStore(store);
        log('Remembered URL filters for', game, forGame);
      }
    }

    function restoreOnce() {
      const game = gameKey();
      const store = readStore();
      const forGame = store[game];
      if (!forGame || !Object.keys(forGame).length) return false;

      const params = new URLSearchParams(location.search);
      let missingAny = false;
      for (const [key, value] of Object.entries(forGame)) {
        if (!params.has(key)) {
          params.set(key, value);
          missingAny = true;
        }
      }
      if (!missingAny) return false;

      const newUrl = `${location.pathname}?${params.toString()}`;
      log('Restoring saved URL filters for', game, '→', newUrl);
      location.href = newUrl; // real navigation, so the app picks these up cleanly on mount
      return true;
    }

    function init() {
      if (!isModsListingUrl()) return false;
      if (restoreOnce()) return true; // page is about to reload with the restored params
      remember();
      window.addEventListener('nx:urlchange', () => {
        if (isModsListingUrl()) remember();
      });
      return false;
    }

    return { init, readStore };
  })();

  /* ============================================================ *
   * Feature 4 — Mark viewed mods, and highlight new ones           *
   * Two related, card-level features sharing one pass over the     *
   * grid/tile list so there's only one MutationObserver doing the  *
   * work instead of two:                                            *
   *                                                                  *
   *  - Viewed: landing on a mod's own page records its id; any card *
   *    linking to a previously-visited mod on a listing page gets   *
   *    dimmed (back to full opacity on hover).                      *
   *                                                                  *
   *  - New since last visit: for a given search/filter/sort combo   *
   *    (the "view", identified by path + query minus `page`), this  *
   *    remembers which mod ids you've already seen. Revisiting that *
   *    same view flags anything not in that set with a badge. The   *
   *    very first time you ever load a given view there's nothing   *
   *    to compare against, so nothing gets flagged that time — it   *
   *    just becomes the baseline for next time.                     *
   * ============================================================ */
  const CardTracker = (() => {
    const VISITED_KEY = 'nx-visited-mods';
    const SEEN_KEY = 'nx-seen-mod-ids';
    const MOD_PATH_RE = /^\/(?:games\/)?([a-z0-9_-]+)\/mods\/(\d+)/i;
    const MAX_SEEN_PER_VIEW = 500;
    const MAX_VISITED_TOTAL = 2000;
    const SESSION_COOLDOWN_MS = 30 * 60 * 1000; // 30 min — refreshes within this window don't re-baseline

    let listingObserver = null;
    let listingCleanup = null;

    function readJSON(key) {
      try {
        return JSON.parse(localStorage.getItem(key) || '{}');
      } catch {
        return {};
      }
    }
    function writeJSON(key, obj) {
      try {
        localStorage.setItem(key, JSON.stringify(obj));
      } catch {
        /* storage disabled/full — silently skip persistence */
      }
    }

    function extractModKey(url) {
      try {
        const u = new URL(url, location.origin);
        const m = u.pathname.match(MOD_PATH_RE);
        return m ? `${m[1].toLowerCase()}/${m[2]}` : null;
      } catch {
        return null;
      }
    }

    function findCardLink(card) {
      if (!card || card.nodeType !== 1) return null;
      if (card.tagName === 'A') return card;
      return card.querySelector ? card.querySelector('a[href*="/mods/"]') : null;
    }

    function injectStyle() {
      if (document.getElementById('nx-tracker-style')) return;
      const style = document.createElement('style');
      style.id = 'nx-tracker-style';
      style.textContent = `
        .nx-visited-mod { opacity: .5; transition: opacity .15s ease; }
        .nx-visited-mod:hover { opacity: 1; }
        .nx-new-mod { outline: 2px solid #4ade80; outline-offset: -2px; border-radius: 4px; }
        .nx-new-mod-badge {
          position: absolute; top: 6px; left: 6px; z-index: 2;
          background: #16a34a; color: #fff; font-size: 10px; font-weight: 600;
          line-height: 1; padding: 3px 6px; border-radius: 4px; pointer-events: none;
        }
      `;
      document.head.appendChild(style);
    }

    function recordVisit() {
      const key = extractModKey(location.href);
      if (!key) return;
      const visited = readJSON(VISITED_KEY);
      if (visited[key]) return;
      visited[key] = Date.now();

      let entries = Object.entries(visited);
      if (entries.length > MAX_VISITED_TOTAL) {
        entries.sort((a, b) => a[1] - b[1]); // oldest first
        entries = entries.slice(entries.length - MAX_VISITED_TOTAL);
      }
      writeJSON(VISITED_KEY, Object.fromEntries(entries));
      log('Marked mod as viewed:', key);
    }

    function viewKey() {
      const params = new URLSearchParams(location.search);
      params.delete('page');
      const qs = Array.from(params.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => `${k}=${v}`)
        .join('&');
      return `${location.pathname}?${qs}`;
    }

    function isListingUrl() {
      if (/\/mods\/\d+/.test(location.pathname)) return false;
      return /\/games\/[^/]+\/(mods|search)/.test(location.pathname) || /^\/search/.test(location.pathname);
    }

    function teardownListingObserver() {
      if (listingCleanup) {
        listingCleanup(); // flushes this view's progress before tearing down
        listingCleanup = null;
      }
      if (listingObserver) {
        listingObserver.disconnect();
        listingObserver = null;
      }
    }

    function initListingTracking(container) {
      teardownListingObserver();

      const visited = readJSON(VISITED_KEY);
      const seenStore = readJSON(SEEN_KEY);
      const key = viewKey();
      const record = seenStore[key]; // { ids: [...], lastSeenAt: <ms> } | undefined
      const now = Date.now();

      const isFirstVisit = !record;
      // A reload/refresh minutes apart is still "the same visit" — the
      // baseline used to decide what's new must stay frozen for the whole
      // session, or the very act of loading the page (which immediately
      // recorded everything as "seen") would burn its own highlights
      // before a refresh even had a chance to show them again. It only
      // advances once you've genuinely been away for a while.
      const withinSameSession = !!record && now - record.lastSeenAt < SESSION_COOLDOWN_MS;
      const baselineIds = new Set(record ? record.ids : []);
      const currentIds = new Set(); // everything visible this load (incl. infinite-scroll growth)
      let newCount = 0;

      const persist = () => {
        const nextIds = withinSameSession ? baselineIds : new Set([...baselineIds, ...currentIds]);
        let arr = Array.from(nextIds);
        if (arr.length > MAX_SEEN_PER_VIEW) arr = arr.slice(arr.length - MAX_SEEN_PER_VIEW);
        seenStore[key] = { ids: arr, lastSeenAt: Date.now() };
        writeJSON(SEEN_KEY, seenStore);
      };

      const markCard = (card) => {
        if (!card.dataset || card.dataset.nxTracked) return;
        card.dataset.nxTracked = '1';
        const link = findCardLink(card);
        if (!link) return;
        const modKey = extractModKey(link.href);
        if (!modKey) return;

        if (visited[modKey]) card.classList.add('nx-visited-mod');

        currentIds.add(modKey);
        if (!isFirstVisit && !baselineIds.has(modKey)) {
          card.classList.add('nx-new-mod');
          if (getComputedStyle(card).position === 'static') card.style.position = 'relative';
          card.insertAdjacentHTML('beforeend', '<span class="nx-new-mod-badge">NEW</span>');
          newCount += 1;
        }
      };

      Array.from(container.children).forEach(markCard);
      persist();

      listingObserver = new MutationObserver((muts) => {
        let touched = false;
        for (const m of muts) {
          m.addedNodes.forEach((node) => {
            if (node.nodeType === 1) {
              markCard(node);
              touched = true;
            }
          });
        }
        if (touched) persist();
      });
      listingObserver.observe(container, { childList: true });

      window.addEventListener('pagehide', persist);
      listingCleanup = () => {
        persist();
        window.removeEventListener('pagehide', persist);
      };

      if (newCount > 0) showToast(`${newCount} new mod${newCount === 1 ? '' : 's'} since your last visit`);
      log(
        `Card tracking active for view "${key}" (${baselineIds.size} known, same session: ${withinSameSession}, first visit: ${isFirstVisit})`
      );
    }

    function init() {
      injectStyle();

      if (/\/mods\/\d+/.test(location.pathname)) {
        teardownListingObserver();
        recordVisit();
        return;
      }

      if (!isListingUrl()) {
        teardownListingObserver();
        return;
      }

      waitForElement('.mods-grid, ul.tiles').then((container) => {
        if (container) initListingTracking(container);
      });
    }

    return {
      init,
      extractModKey,
      debugVisited: () => readJSON(VISITED_KEY),
      debugSeen: () => readJSON(SEEN_KEY),
    };
  })();

  /* ============================================================ *
   * Feature 5 — Track/Untrack toggle on grid cards (SPA only)     *
   * The site's "Track"/"Tracking" toggle only exists on the        *
   * classic mod page template (`.toggle-track-mod`, jQuery event   *
   * delegation, data-do-track 1/0) — the new grid is a separate    *
   * app with no visibility into that code or its private endpoint. *
   * Rather than guess at an AJAX contract we can't see, this loads *
   * each mod's own (classic-template) page in an invisible         *
   * same-origin iframe and clicks its *real* Track button there,   *
   * so the site's already-correct code does the actual work.       *
   * Tracked/untracked state shown on cards is then just remembered *
   * locally from what this script has toggled — it can't see the   *
   * true server-side state without visiting each mod's page.       *
   * ============================================================ */
  const TrackingToggle = (() => {
    const STORAGE_KEY = 'nx-tracked-mods';

    function readStore() {
      try {
        return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
      } catch {
        return {};
      }
    }
    function writeStore(obj) {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(obj));
      } catch {
        /* storage disabled/full — silently skip persistence */
      }
    }
    function isTracked(modKey) {
      return !!readStore()[modKey];
    }
    function setTracked(modKey, tracked) {
      const store = readStore();
      if (tracked) store[modKey] = true;
      else delete store[modKey];
      writeStore(store);
    }

    function toggleViaIframe(legacyModUrl, wantTrack) {
      return new Promise((resolve) => {
        const iframe = document.createElement('iframe');
        iframe.style.cssText = 'position:fixed;top:-9999px;left:-9999px;width:0;height:0;border:0;opacity:0;';
        let done = false;
        const finish = (ok) => {
          if (done) return;
          done = true;
          clearTimeout(hardTimeout);
          iframe.remove();
          resolve(ok);
        };
        const hardTimeout = setTimeout(() => finish(false), 15000);

        iframe.addEventListener('load', () => {
          try {
            const doc = iframe.contentDocument;
            const btn = doc.querySelector(`.toggle-track-mod[data-do-track="${wantTrack ? 1 : 0}"]`);
            if (!btn) return finish(false);
            btn.click(); // fires the site's own real, already-wired-up tracking action
            setTimeout(() => finish(true), 1200); // give its AJAX call time to actually land
          } catch (e) {
            finish(false);
          }
        });

        iframe.src = legacyModUrl;
        document.body.appendChild(iframe);
      });
    }

    function injectStyle() {
      if (document.getElementById('nx-track-style')) return;
      const style = document.createElement('style');
      style.id = 'nx-track-style';
      style.textContent = `
        .nx-track-btn {
          position: absolute; top: 6px; right: 6px; z-index: 3;
          background: rgba(0,0,0,.6); color: #fff; border: none;
          font-size: 11px; font-weight: 600; line-height: 1;
          padding: 5px 9px; border-radius: 999px; cursor: pointer;
          transition: background .15s ease;
        }
        .nx-track-btn:hover { background: rgba(0,0,0,.8); }
        .nx-track-btn.nx-tracked { background: #ca8a04; }
        .nx-track-btn[disabled] { opacity: .6; cursor: wait; }
      `;
      document.head.appendChild(style);
    }

    function decorateCard(card, modKey) {
      if (card.dataset.nxTrackBtn) return;
      card.dataset.nxTrackBtn = '1';
      if (getComputedStyle(card).position === 'static') card.style.position = 'relative';

      const [game, id] = modKey.split('/');
      const legacyModUrl = `https://www.nexusmods.com/${game}/mods/${id}`;

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'nx-track-btn';
      const render = (tracked) => {
        btn.classList.toggle('nx-tracked', tracked);
        btn.textContent = tracked ? '★ Tracking' : '☆ Track';
      };
      render(isTracked(modKey));

      btn.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        const wantTrack = !isTracked(modKey);
        btn.disabled = true;
        btn.textContent = wantTrack ? 'Tracking…' : 'Untracking…';
        const ok = await toggleViaIframe(legacyModUrl, wantTrack);
        btn.disabled = false;
        if (ok) {
          setTracked(modKey, wantTrack);
          render(wantTrack);
          showToast(wantTrack ? 'Now tracking this mod' : 'Stopped tracking this mod');
        } else {
          render(isTracked(modKey));
          showToast("Couldn't update tracking — try from the mod's own page.");
          warn('Tracking toggle failed for', modKey, '(button not found on the mod page, or the request timed out).');
        }
      });

      card.appendChild(btn);
    }

    function scan(container) {
      Array.from(container.children).forEach((card) => {
        const link = card.tagName === 'A' ? card : card.querySelector?.('a[href*="/mods/"]');
        if (!link) return;
        const modKey = CardTracker.extractModKey(link.href);
        if (!modKey) return;
        decorateCard(card, modKey);
      });
    }

    let observer = null;

    function teardown() {
      if (observer) {
        observer.disconnect();
        observer = null;
      }
    }

    function init(container) {
      teardown();
      injectStyle();
      scan(container);
      observer = new MutationObserver((muts) => {
        if (muts.some((m) => m.addedNodes.length)) scan(container);
      });
      observer.observe(container, { childList: true });
    }

    return { init, teardown };
  })();

  /* ============================================================ *
   * Feature 6 — "Show my downloaded mods" for this game            *
   * The classic "Download history" tab (My Content → Download      *
   * history) pulls its data from                                    *
   * GET /{game}/Core/Libs/Common/Managers/Mods?GetDownloadHistory,  *
   * a JSON array covering EVERY mod ever downloaded for that game — *
   * not just whatever happens to be on the current sorted/filtered  *
   * page. So rather than hiding non-matches from the current view   *
   * (which, filtering thousands of downloads against a "newest      *
   * first" page of 20-80 mods, would show almost nothing — not a    *
   * bug, just math), this replaces the grid entirely with a list    *
   * built directly from the history data, which already carries     *
   * enough per-row info (thumbnail, title, category, mod id) to      *
   * render real cards without any further fetching. Turning it back *
   * off restores exactly what was there before.                      *
   *                                                                  *
   * This endpoint lives on www.nexusmods.com, so it only works       *
   * when the grid itself is being viewed under that host — from      *
   * next.nexusmods.com it would be a cross-origin request the site   *
   * isn't set up to allow, and fails with a clear message rather      *
   * than silently doing nothing.                                     *
   * ============================================================ */
  const DownloadedFilter = (() => {
    const CACHE_KEY = 'nx-download-history-cache';
    const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour — avoids re-fetching a potentially large list on every page load
    const CHUNK_SIZE = 40; // rendered progressively as you scroll, not all at once

    function readCache(domain) {
      try {
        const store = JSON.parse(localStorage.getItem(CACHE_KEY) || '{}');
        const entry = store[domain];
        if (!entry || Date.now() - entry.fetchedAt > CACHE_TTL_MS) return null;
        return entry.rows;
      } catch {
        return null;
      }
    }
    function writeCache(domain, rows) {
      try {
        const store = JSON.parse(localStorage.getItem(CACHE_KEY) || '{}');
        store[domain] = { fetchedAt: Date.now(), rows };
        localStorage.setItem(CACHE_KEY, JSON.stringify(store));
      } catch {
        /* storage disabled/full (large histories may not fit) — silently skip caching */
      }
    }

    function currentGameDomain() {
      const m = location.pathname.match(/\/games\/([^/]+)\//);
      return m ? m[1] : null;
    }

    async function fetchDownloadHistoryRows(domain, maxTries = 15) {
      const url = `${location.origin}/${domain}/Core/Libs/Common/Managers/Mods?GetDownloadHistory`;
      for (let i = 0; i < maxTries; i++) {
        let res;
        try {
          res = await fetch(url, { credentials: 'same-origin' });
        } catch (e) {
          warn('Download history request failed (likely cross-origin from this page):', e);
          return null;
        }
        if (!res.ok) {
          warn(`Download history request returned HTTP ${res.status}.`);
          return null;
        }
        const text = await res.text();
        if (text && text !== 'null') {
          try {
            return JSON.parse(text).data || [];
          } catch (e) {
            warn('Could not parse download history response:', e);
            return null;
          }
        }
        await new Promise((r) => setTimeout(r, 2000)); // matches the site's own poll interval while it's still building
      }
      warn('Download history never finished building within the wait window.');
      return null;
    }

    async function getDownloadHistoryRows() {
      const domain = currentGameDomain();
      if (!domain) return null;

      const cached = readCache(domain);
      if (cached) return cached;

      const rows = await fetchDownloadHistoryRows(domain);
      if (!rows) return null;

      log(`Download history: ${rows.length} rows. Sample raw row (fields: image, title, lastDl, uploader, category, updatedAt, _, gameId, modId, domain, categoryId, uploaderId, endorsed, adult, modUid):`, rows[0]);
      writeCache(domain, rows);
      return rows;
    }

    function buildCard(row) {
      const [imageFile, title, , , categoryName, , , gameId, modId, domain] = row;
      const modUrl = `https://www.nexusmods.com/${domain}/mods/${modId}`;
      const thumbUrl = imageFile ? `https://staticdelivery.nexusmods.com/mods/${gameId}/images/thumbnails/${imageFile}` : '';

      const card = document.createElement('a');
      card.href = modUrl;
      card.className =
        'flex flex-col rounded overflow-hidden bg-surface-mid border border-stroke-subdued hover:border-stroke-strong transition-colors';
      card.innerHTML = `
        <div class="aspect-video bg-surface-translucent-mid overflow-hidden flex items-center justify-center">
          ${thumbUrl ? `<img src="${thumbUrl}" loading="lazy" class="w-full h-full object-cover" onerror="this.remove()">` : ''}
        </div>
        <div class="p-3 flex flex-col gap-1">
          <span class="text-body-md text-neutral-strong line-clamp-2">${title || 'Untitled mod'}</span>
          <span class="text-body-sm text-neutral-subdued">${categoryName || ''}</span>
        </div>
      `;
      return card;
    }

    let enabled = false;
    let toggleEl = null;
    let checkboxEl = null;
    let labelEl = null;
    let historyRows = null;
    let originalChildren = null; // snapshot of the site's own cards, restored when toggled off
    let renderedCount = 0;
    let chunkObserver = null;
    let chunkSentinel = null;
    let activeGrid = null;

    function renderNextChunk() {
      const slice = historyRows.slice(renderedCount, renderedCount + CHUNK_SIZE);
      slice.forEach((row) => activeGrid.insertBefore(buildCard(row), chunkSentinel));
      renderedCount += slice.length;
      const done = renderedCount >= historyRows.length;
      renderSentinel(chunkSentinel, {
        text: done ? `Showing all ${historyRows.length} downloaded mods.` : `Showing ${renderedCount} of ${historyRows.length}…`,
      });
      return !done;
    }

    function showHistoryView(grid) {
      activeGrid = grid;
      originalChildren = Array.from(grid.children);
      SpaScroll.teardown(); // the site's own pagination doesn't apply to this custom list
      grid.innerHTML = '';
      renderedCount = 0;

      chunkSentinel = document.createElement('div');
      chunkSentinel.className = 'col-span-full flex items-center justify-center py-6 text-body-sm text-neutral-subdued';
      grid.appendChild(chunkSentinel);

      renderNextChunk();

      chunkObserver = new IntersectionObserver(
        (entries) => {
          if (entries.some((e) => e.isIntersecting)) renderNextChunk();
        },
        { rootMargin: '800px 0px' }
      );
      chunkObserver.observe(chunkSentinel);
    }

    function restoreOriginalView(grid) {
      if (chunkObserver) {
        chunkObserver.disconnect();
        chunkObserver = null;
      }
      chunkSentinel = null;
      if (originalChildren) {
        grid.innerHTML = '';
        originalChildren.forEach((c) => grid.appendChild(c));
        originalChildren = null;
      }
      activeGrid = null;
      armForCurrentPage(); // the site's grid is back — re-arm its own pagination
    }

    function teardown() {
      if (chunkObserver) {
        chunkObserver.disconnect();
        chunkObserver = null;
      }
      if (toggleEl) {
        toggleEl.remove();
        toggleEl = null;
      }
      enabled = false;
      historyRows = null;
      originalChildren = null;
      activeGrid = null;
      chunkSentinel = null;
    }

    function makeToggle(grid) {
      const wrap = document.createElement('div');
      wrap.className = 'flex items-center gap-x-2 py-3 text-body-sm text-neutral-strong';

      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.id = 'nx-downloaded-only-toggle';
      checkboxEl = checkbox;

      const label = document.createElement('label');
      label.htmlFor = checkbox.id;
      label.textContent = "Show my downloaded mods for this game";
      labelEl = label;

      wrap.appendChild(checkbox);
      wrap.appendChild(label);
      grid.insertAdjacentElement('beforebegin', wrap);
      toggleEl = wrap;

      checkbox.addEventListener('change', async () => {
        enabled = checkbox.checked;

        if (!enabled) {
          label.textContent = "Show my downloaded mods for this game";
          restoreOriginalView(grid);
          return;
        }

        if (!historyRows) {
          label.textContent = 'Loading your download history…';
          checkbox.disabled = true;
          historyRows = await getDownloadHistoryRows();
          checkbox.disabled = false;
          if (!historyRows) {
            label.textContent = "Couldn't load download history — try from your account's Download history tab instead.";
            checkbox.checked = false;
            enabled = false;
            return;
          }
        }

        label.textContent = `Showing my ${historyRows.length} downloaded mods for this game`;
        showHistoryView(grid);
      });
    }

    function init(grid) {
      teardown();
      makeToggle(grid);
    }

    return { init, teardown, getDownloadHistoryRows };
  })();

  /* ============================================================ *
   * Bootstrap                                                      *
   * Which pagination style applies is decided by what's actually  *
   * on the page (old tile list vs. new .mods-grid), not by         *
   * hostname — the new frontend now serves listing pages under     *
   * both next.nexusmods.com and www.nexusmods.com.                 *
   * ============================================================ */
  function isLegacyTileList() {
    return !!(document.querySelector('.pagination a.page-selected') && document.querySelector('ul.tiles'));
  }

  if (UrlFilterMemory.init()) {
    // A saved URL filter was missing and we just triggered a real
    // navigation to restore it — nothing else needs to start up now,
    // the script will run again fresh once that navigation lands.
  } else {
    boot();
  }

  function boot() {
    FilterMemory.init(); // runs once for the page's lifetime, self-heals via its own observer

    armForCurrentPage();
    CardTracker.init();

    (function patchHistory() {
      const fire = () => window.dispatchEvent(new Event('nx:urlchange'));
      ['pushState', 'replaceState'].forEach((fn) => {
        const orig = history[fn];
        history[fn] = function (...args) {
          const ret = orig.apply(this, args);
          fire();
          return ret;
        };
      });
      window.addEventListener('popstate', fire);
    })();

    window.addEventListener('nx:urlchange', () => {
      if (SpaScroll.isExpectingOwnNav()) return; // our own pagination click — already handled in place
      setTimeout(() => {
        armForCurrentPage(); // new search/filters/game — re-detect and treat results as a fresh page 1
        CardTracker.init();
      }, 50);
    });
  }

  async function armForCurrentPage() {
    LegacyScroll.teardown();
    SpaScroll.teardown();
    TrackingToggle.teardown();
    DownloadedFilter.teardown();

    if (isLegacyTileList()) {
      armLegacyScroll();
      return;
    }

    const grid = await waitForElement(SpaScroll.GRID_SELECTOR, document, 8000);
    if (!grid) {
      warn('Neither the classic tile list nor .mods-grid was found on this page — nothing to arm.');
      return;
    }
    const ok = await waitForLoadedChildren(grid);
    if (!ok) {
      warn('.mods-grid never finished loading (still skeletons) — infinite scroll not armed.');
      return;
    }
    SpaScroll.init(grid);
    TrackingToggle.init(grid);
    DownloadedFilter.init(grid);
  }

  // Run `NX_DEBUG.inspect()` in the devtools console on a page where
  // infinite scroll isn't kicking in — it prints exactly which selector
  // or global variable it couldn't find, without needing anything else.
  window.NX_DEBUG = {
    get site() {
      if (document.querySelector(SpaScroll.GRID_SELECTOR)) return 'spa';
      if (isLegacyTileList()) return 'legacy';
      return 'unknown';
    },
    urlFilters: () => UrlFilterMemory.readStore(),
    visitedMods: () => CardTracker.debugVisited(),
    seenMods: () => CardTracker.debugSeen(),
    downloadHistory: () => DownloadedFilter.getDownloadHistoryRows(),
    inspect() {
      console.log(`${TAG} ul.tiles:`, document.querySelector('ul.tiles'));
      console.log(`${TAG} .pagination:`, document.querySelector('.pagination'));
      console.log(`${TAG} .pagination a.page-selected:`, document.querySelector('.pagination a.page-selected'));
      console.log(`${TAG} window.RH_ModList:`, window.RH_ModList);
      console.log(`${TAG} buildNextPageUrl():`, LegacyScroll.buildNextPageUrl());

      const grid = document.querySelector(SpaScroll.GRID_SELECTOR);
      console.log(`${TAG} .mods-grid:`, grid);
      console.log(`${TAG} .mods-grid children:`, grid ? grid.children.length : 0);
      const nav = SpaScroll.findPaginationNav();
      console.log(`${TAG} pagination nav:`, nav);
      console.log(`${TAG} next control:`, SpaScroll.findNextControl(nav));
    },
  };
})();
