// ==UserScript==
// @name         VAM Hub - Grid View + Auto Pager
// @namespace    vam-hub-grid-autopager
// @version      2.15
// @description  Adds a grid/card view, infinite auto-pagination, manual load-more, card sizing, thumbnail controls, resource-page media support, media gallery support, back/top buttons, tag page support, and hover-to-enlarge thumbnail preview to Virt-A-Mate Hub pages.
// @match        https://hub.virtamate.com/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';

    const PAGE_TYPES = [
        {
            id: 'structItem',
            containerSelector: '.structItemContainer',
            itemSelector: '.structItem',
            thumbSelector: '.structItem-iconContainer > a.avatar img',
            gridClass: 'vamhub-grid-structItem',
        },
        {
            id: 'tagResult',
            containerSelector: '.block-container .block-body',
            itemSelector: '.block-row.searchItemContainer, .block-row',
            thumbSelector: '.contentRow-figure img, .searchResultIcon img, img.avatar-u, img.avatar',
            gridClass: 'vamhub-grid-tagResult',
            matches: () => location.pathname.startsWith('/tags/'),
        },
        {
            id: 'searchResult',
            containerSelector: 'ol.block-body',
            itemSelector: '.block-row.searchItemContainer',
            thumbSelector: '.searchResultIcon img',
            gridClass: 'vamhub-grid-searchResult',
        },
        {
            id: 'xfmgMedia',
            containerSelector: '.itemList.js-lbContainer',
            itemSelector: '.itemList-item:not(.itemList-item--placeholder)',
            thumbSelector: '.xfmgThumbnail-image',
            gridClass: 'vamhub-grid-xfmgMedia',
            matches: () => document.body && document.body.dataset.template === 'xfmg_media_index',
        },
    ];

    const STATE = {
        gridEnabled: GM_getValueSafe('vamhub_grid_enabled', true),
        autoPagerEnabled: GM_getValueSafe('vamhub_autopager_enabled', true),
        cardSize: GM_getStringSafe('vamhub_card_size', 'medium'),
        thumbnailMode: GM_getStringSafe('vamhub_thumbnail_mode', 'hover'),
        resourceMediaMode: GM_getStringSafe('vamhub_resource_media_mode', 'fit'),
        resourceRelatedGrid: GM_getValueSafe('vamhub_resource_related_grid', true),
        loading: false,
        done: false,
        pageType: null,
        nextUrl: null,
        loadedUrls: new Set(),
    };

    function GM_getValueSafe(key, fallback) {
        try {
            const v = localStorage.getItem(key);
            return v === null ? fallback : v === 'true';
        } catch (e) {
            return fallback;
        }
    }

    function GM_setValueSafe(key, value) {
        try {
            localStorage.setItem(key, String(value));
        } catch (e) {}
    }

    function GM_getStringSafe(key, fallback) {
        try {
            const v = localStorage.getItem(key);
            return v === null ? fallback : v;
        } catch (e) {
            return fallback;
        }
    }

    function normalizeCardSize(value) {
        return ['small', 'medium', 'large'].includes(value) ? value : 'medium';
    }

    function normalizeThumbnailMode(value) {
        return ['hover', 'pinned', 'off'].includes(value) ? value : 'hover';
    }

    function normalizeResourceMediaMode(value) {
        return ['fit', 'full', 'compact'].includes(value) ? value : 'fit';
    }

    const STYLE = `
    .vamhub-toolbar {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        align-items: center;
        justify-content: flex-end;
        min-width: 0;
        margin-left: auto;
    }
    .vamhub-toolbar.vamhub-toolbar--standalone {
        justify-content: flex-start;
        margin: 0 0 8px 0;
        padding: 8px 10px;
        background: #1c1c1c;
        border: 1px solid #333;
        border-radius: 4px;
    }
    .filterBar .vamhub-toolbar {
        padding: 4px 0 4px 8px;
    }
    .filterBar-controls .vamhub-toolbar,
    .block-filterBar.bar-controls .vamhub-toolbar {
        padding: 4px 0 4px 8px;
    }
    .filterBar.vamhub-filterbar-host {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 6px 8px;
    }
    .filterBar-controls.vamhub-filterbar-host {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 6px 8px;
    }
    .vamhub-toolbar .vamhub-control.button {
        margin: 0;
        white-space: nowrap;
    }
    .vamhub-toolbar .vamhub-control.is-active {
        font-weight: 600;
    }
    .vamhub-toolbar .vamhub-control-icon {
        margin-right: 4px;
    }
    .vamhub-toolbar .vamhub-status {
        font-size: 12px;
        color: #9d9d9d;
        padding: 0 4px;
        white-space: nowrap;
    }
    @media (max-width: 650px) {
        .filterBar .vamhub-toolbar,
        .filterBar-controls .vamhub-toolbar,
        .block-filterBar.bar-controls .vamhub-toolbar {
            justify-content: flex-start;
            width: 100%;
            padding-left: 0;
            margin: 6px 0 0;
        }
        .vamhub-toolbar .vamhub-control.button {
            flex: 1 1 calc(50% - 6px);
        }
        .vamhub-toolbar .vamhub-status {
            width: 100%;
        }
    }

    .structItemContainer.vamhub-grid {
        display: grid !important;
        grid-template-columns: repeat(auto-fill, minmax(var(--vamhub-card-min, 230px), 1fr));
        gap: 14px;
        padding: 8px;
    }
    .vamhub-grid.vamhub-card-small {
        --vamhub-card-min: 180px;
    }
    .vamhub-grid.vamhub-card-medium {
        --vamhub-card-min: 230px;
    }
    .vamhub-grid.vamhub-card-large {
        --vamhub-card-min: 300px;
    }
    .structItemContainer.vamhub-grid .structItem {
        display: flex !important;
        flex-direction: column;
        background: #222;
        border-radius: 6px;
        overflow: hidden;
        border: 1px solid #333;
        position: relative;
        box-shadow: 0 1px 0 rgba(255,255,255,0.04);
        transition: border-color 0.15s ease, transform 0.15s ease, box-shadow 0.15s ease;
    }
    .structItemContainer.vamhub-grid .structItem:hover {
        border-color: #4a6cf7;
        box-shadow: 0 8px 24px rgba(0,0,0,0.32);
        transform: translateY(-1px);
    }
    .structItemContainer.vamhub-grid .resourceListItemContainer {
        display: flex;
        flex-direction: column;
        height: 100%;
    }
    .structItemContainer.vamhub-grid .structItem-cell--icon {
        width: 100% !important;
        order: 1;
    }
    .structItemContainer.vamhub-grid .structItem-iconContainer {
        position: relative;
        width: 100%;
        aspect-ratio: 4 / 5;
        overflow: hidden;
    }
    .structItemContainer.vamhub-grid .structItem-iconContainer > a.avatar {
        display: block;
        width: 100%;
        height: 100%;
    }
    .structItemContainer.vamhub-grid .structItem-iconContainer img.avatar-u {
        width: 100% !important;
        height: 100% !important;
        object-fit: cover;
    }
    .structItemContainer.vamhub-grid .structItem-iconContainer > a.avatar img {
        width: 100%;
        height: 100%;
        object-fit: cover;
    }
    .structItemContainer.vamhub-grid .structItem-secondaryIcon {
        position: absolute;
        bottom: 6px;
        left: 6px;
        z-index: 2;
    }
    .structItemContainer.vamhub-grid .resource-prefix-container {
        position: absolute;
        top: 6px;
        left: 6px;
        z-index: 2;
    }
    .structItemContainer.vamhub-grid .favorite-button-overlay {
        position: absolute;
        top: 6px;
        right: 6px;
        z-index: 2;
    }
    .structItemContainer.vamhub-grid .listMacrosThumbContainer {
        display: block !important;
        order: 2 !important;
        width: 100% !important;
        max-width: 100% !important;
        margin-top: 0 !important;
        max-height: 0 !important;
        opacity: 0 !important;
        overflow: hidden !important;
        position: relative;
        box-sizing: border-box;
        padding: 0 30px;
        transition: max-height 0.22s ease, opacity 0.18s ease, margin-top 0.18s ease !important;
    }
    .structItemContainer.vamhub-grid .structItem:hover .listMacrosThumbContainer {
        max-height: 62px !important;
        opacity: 1 !important;
        margin-top: 6px !important;
    }
    .structItemContainer.vamhub-grid.vamhub-thumbs-pinned .listMacrosThumbContainer {
        max-height: 62px !important;
        opacity: 1 !important;
        margin-top: 6px !important;
    }
    .structItemContainer.vamhub-grid.vamhub-thumbs-off .listMacrosThumbContainer {
        display: none !important;
    }
    .structItemContainer.vamhub-grid .searchresultImages {
        display: flex !important;
        flex-direction: row !important;
        flex-wrap: nowrap !important;
        gap: 4px;
        overflow-x: auto;
        scroll-snap-type: x proximity;
        scroll-behavior: smooth;
        padding: 2px 0 4px;
        width: 100% !important;
    }
    .structItemContainer.vamhub-grid .searchresultImages::-webkit-scrollbar {
        height: 5px;
    }
    .structItemContainer.vamhub-grid .searchresultImages::-webkit-scrollbar-thumb {
        background: #4a6cf7;
        border-radius: 3px;
    }
    .structItemContainer.vamhub-grid .searchresultImages .js-lbImage {
        flex: 0 0 auto !important;
        scroll-snap-align: start;
        display: block !important;
        width: 64px !important;
        height: 48px !important;
        border-radius: 4px;
        overflow: hidden;
        outline: 1px solid rgba(255,255,255,0.08);
        outline-offset: -1px;
        transition: outline-color 0.12s ease, transform 0.12s ease;
    }
    .structItemContainer.vamhub-grid .searchresultImages .js-lbImage:hover,
    .structItemContainer.vamhub-grid .searchresultImages .js-lbImage:focus,
    .structItemContainer.vamhub-grid .searchresultImages .js-lbImage.vamhub-thumb-active {
        outline-color: #4a6cf7;
        transform: translateY(-1px);
    }
    .structItemContainer.vamhub-grid .searchresultImages .js-lbImage img.searchresultThumb {
        width: 100% !important;
        height: 100% !important;
        object-fit: cover;
    }
    .vamhub-thumb-nav {
        position: absolute;
        top: 2px;
        bottom: 4px;
        z-index: 3;
        width: 24px;
        border: 1px solid rgba(255,255,255,0.14);
        background: rgba(20,20,20,0.88);
        color: #eee;
        border-radius: 4px;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 0;
        font-size: 12px;
        line-height: 1;
    }
    .vamhub-thumb-nav:hover {
        background: #2b2b2b;
        border-color: #4a6cf7;
    }
    .vamhub-thumb-nav--prev {
        left: 2px;
    }
    .vamhub-thumb-nav--next {
        right: 2px;
    }
    .structItemContainer.vamhub-grid .structItem-cell--mvrResourceOuterCell {
        order: 2;
        width: 100% !important;
        padding: 8px 10px;
        flex: 1;
        display: flex !important;
        flex-direction: column !important;
    }
    .structItemContainer.vamhub-grid .structItem-cell--mvrResourceFlex {
        order: 1 !important;
        width: 100% !important;
        display: block !important;
    }
    .structItemContainer.vamhub-grid .structItem-cell--mvrResourceTable {
        display: block !important;
        width: 100% !important;
        max-width: 100% !important;
        table-layout: auto !important;
    }
    .structItemContainer.vamhub-grid .structItem-cell--main {
        display: block !important;
        width: 100% !important;
        max-width: 100% !important;
        white-space: normal !important;
    }
    .structItemContainer.vamhub-grid .structItem-cell--resourceMeta {
        order: 3 !important;
        position: static !important;
        top: auto !important;
        right: auto !important;
        bottom: auto !important;
        left: auto !important;
        width: 100% !important;
        max-width: 100% !important;
        padding: 6px 10px 10px;
        font-size: 11px;
        display: block !important;
    }
    .structItemContainer.vamhub-grid .structItem-cell--resourceMeta .pairs {
        justify-content: space-between;
    }
    .structItemContainer.vamhub-grid .structItem-metaItem--extraContainer {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 3px 10px;
    }
    .structItemContainer.vamhub-grid .structItem-metaItem--extraContainer .pairs {
        min-width: 0;
        margin: 0;
    }
    .structItemContainer.vamhub-grid .structItem-title {
        font-size: 14px;
        line-height: 1.3;
        margin-bottom: 4px;
    }
    .structItemContainer.vamhub-grid .structItem-resourceTagLine {
        font-size: 12px;
        color: #aaa;
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
        overflow: hidden;
    }
    .structItemContainer.vamhub-grid .structItem-minor,
    .structItemContainer.vamhub-grid .structItem-parts {
        font-size: 11px;
        display: block !important;
        width: 100% !important;
        white-space: normal !important;
    }
    .structItemContainer.vamhub-grid .structItem-parts {
        display: flex !important;
        flex-wrap: wrap !important;
        gap: 4px;
        padding: 0 !important;
        margin: 2px 0 !important;
        list-style: none !important;
    }
    .structItemContainer.vamhub-grid .structItem-parts > li {
        display: inline !important;
    }
    .structItemContainer.vamhub-grid .structItem-parts > li:not(:last-child)::after {
        content: "\\00b7";
        margin-left: 4px;
        color: #777;
    }

    ol.block-body.vamhub-grid,
    .block-body.vamhub-grid {
        display: grid !important;
        grid-template-columns: repeat(auto-fill, minmax(var(--vamhub-card-min, 230px), 1fr));
        gap: 14px;
        padding: 8px;
        list-style: none;
    }
    ol.block-body.vamhub-grid .block-row.searchItemContainer,
    .block-body.vamhub-grid .block-row {
        display: block !important;
        background: #222;
        border-radius: 6px;
        overflow: hidden;
        border: 1px solid #333;
        padding: 0 !important;
        box-shadow: 0 1px 0 rgba(255,255,255,0.04);
        transition: border-color 0.15s ease, transform 0.15s ease, box-shadow 0.15s ease;
    }
    ol.block-body.vamhub-grid .block-row.searchItemContainer:hover,
    .block-body.vamhub-grid .block-row:hover {
        border-color: #4a6cf7;
        box-shadow: 0 8px 24px rgba(0,0,0,0.32);
        transform: translateY(-1px);
    }
    ol.block-body.vamhub-grid .contentRow.searchresultWrap,
    .block-body.vamhub-grid .contentRow {
        display: flex !important;
        flex-direction: column !important;
        height: 100%;
    }
    ol.block-body.vamhub-grid .contentRow-main.searchresultMain,
    .block-body.vamhub-grid .contentRow-main {
        display: flex;
        flex-direction: column;
        height: 100%;
        padding: 8px 10px 10px;
    }
    ol.block-body.vamhub-grid .searchResultIcon,
    .block-body.vamhub-grid .searchResultIcon {
        order: 1;
        width: 100%;
    }
    ol.block-body.vamhub-grid .searchResultIcon .contentRow-figure,
    .block-body.vamhub-grid .contentRow-figure {
        display: block;
        width: 100% !important;
        aspect-ratio: 4 / 5;
        margin: 0 !important;
        overflow: hidden;
    }
    ol.block-body.vamhub-grid .searchResultIcon .avatar,
    .block-body.vamhub-grid .contentRow-figure .avatar {
        display: block;
        width: 100%;
        height: 100%;
    }
    ol.block-body.vamhub-grid .searchResultIcon img,
    .block-body.vamhub-grid .contentRow-figure img {
        width: 100% !important;
        height: 100% !important;
        object-fit: cover;
    }
    ol.block-body.vamhub-grid .searchResultTitleContainer {
        order: 2;
        padding: 8px 10px 10px;
        flex: 1;
    }
    ol.block-body.vamhub-grid .contentRow-title,
    .block-body.vamhub-grid .contentRow-title {
        font-size: 14px;
        line-height: 1.3;
        margin-bottom: 4px;
    }
    ol.block-body.vamhub-grid .contentRow-snippet,
    .block-body.vamhub-grid .contentRow-snippet {
        font-size: 12px;
        color: #aaa;
        display: -webkit-box;
        -webkit-line-clamp: 3;
        -webkit-box-orient: vertical;
        overflow: hidden;
        margin-bottom: 6px;
    }
    ol.block-body.vamhub-grid .contentRow-minor,
    .block-body.vamhub-grid .contentRow-minor {
        font-size: 11px;
    }
    ol.block-body.vamhub-grid .searchResultsLabelsContainer,
    ol.block-body.vamhub-grid .tagItem,
    .block-body.vamhub-grid .searchResultsLabelsContainer,
    .block-body.vamhub-grid .tagItem {
        font-size: 10px;
    }

    .itemList.vamhub-grid {
        display: grid !important;
        grid-template-columns: repeat(auto-fill, minmax(var(--vamhub-card-min, 230px), 1fr));
        gap: 14px;
        padding: 8px;
    }
    .itemList.vamhub-grid .itemList-item--placeholder {
        display: none !important;
    }
    .itemList.vamhub-grid .itemList-item {
        width: auto !important;
        height: auto !important;
        aspect-ratio: 1 / 1;
        margin: 0 !important;
        border-radius: 6px;
        overflow: hidden;
        position: relative;
        background: #151515;
        transition: box-shadow 0.15s ease, transform 0.15s ease;
    }
    .itemList.vamhub-grid .itemList-item:hover {
        box-shadow: 0 8px 24px rgba(0,0,0,0.32);
        transform: translateY(-1px);
        z-index: 1;
    }
    .itemList.vamhub-grid a.js-lbImage {
        display: block;
        width: 100%;
        height: 100%;
    }
    .itemList.vamhub-grid .xfmgThumbnail {
        width: 100% !important;
        height: 100% !important;
    }
    .itemList.vamhub-grid .xfmgThumbnail-image {
        width: 100% !important;
        height: 100% !important;
        object-fit: cover;
    }
    .itemList.vamhub-grid .itemInfoRow-title {
        font-size: 13px;
        line-height: 1.3;
    }
    .itemList.vamhub-grid .itemInfoRow-status {
        font-size: 11px;
    }

    .vamhub-loader {
        text-align: center;
        padding: 16px;
        color: #999;
        font-size: 13px;
    }

    .vamhub-hover-preview {
        position: fixed;
        z-index: 9999;
        pointer-events: none;
        border: 2px solid #4a6cf7;
        border-radius: 8px;
        box-shadow: 0 8px 30px rgba(0,0,0,0.6);
        background: #111;
        overflow: hidden;
        opacity: 0;
        transition: opacity 0.12s ease;
        max-width: 420px;
        max-height: 560px;
    }
    .vamhub-hover-preview.visible {
        opacity: 1;
    }
    .vamhub-hover-preview img {
        display: block;
        width: 100%;
        height: 100%;
        object-fit: contain;
    }

    .vamhub-resource-toolbar {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        align-items: center;
        justify-content: flex-start;
        min-width: 0;
    }
    .action-button-container .vamhub-resource-toolbar {
        padding: 4px 0;
    }
    .vamhub-resource-toolbar .vamhub-control.button {
        margin: 0;
        white-space: nowrap;
    }
    .vamhub-resource-toolbar .vamhub-control.is-active {
        font-weight: 600;
    }
    .vamhub-resource-toolbar .vamhub-status {
        font-size: 12px;
        color: #9d9d9d;
        padding: 0 4px;
        white-space: nowrap;
    }
    .resourceBody-main .vamhub-resource-media {
        display: block;
        max-width: 100%;
        border-radius: 6px;
        background: #111;
        box-shadow: 0 1px 0 rgba(255,255,255,0.04);
    }
    body.vamhub-resource-media-fit .resourceBody-main .bbMediaWrapper,
    body.vamhub-resource-media-fit .resourceBody-main .vamhub-resource-media {
        max-width: min(100%, 980px);
    }
    body.vamhub-resource-media-fit .resourceBody-main video.vamhub-resource-media {
        width: 100%;
        max-height: 72vh;
    }
    body.vamhub-resource-media-full .resourceBody-main .bbMediaWrapper,
    body.vamhub-resource-media-full .resourceBody-main .vamhub-resource-media {
        width: 100%;
        max-width: 100%;
    }
    body.vamhub-resource-media-full .resourceBody-main video.vamhub-resource-media {
        width: 100%;
        max-height: none;
    }
    body.vamhub-resource-media-compact .resourceBody-main .bbMediaWrapper,
    body.vamhub-resource-media-compact .resourceBody-main .vamhub-resource-media {
        max-width: min(100%, 640px);
    }
    body.vamhub-resource-media-compact .resourceBody-main video.vamhub-resource-media {
        width: 100%;
        max-height: 56vh;
    }
    .resourceBody-main .vamhub-resource-media:hover,
    .authorOthers.vamhub-related-grid .contentRow-figure img:hover,
    .resource-header-avatar img:hover,
    .sidebar-resource-avatar img:hover {
        outline: 2px solid #4a6cf7;
        outline-offset: -2px;
    }
    .authorOthers.vamhub-related-grid .resourceAuthorOtherList {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(var(--vamhub-related-card-min, 210px), 1fr));
        grid-auto-rows: auto;
        align-items: stretch;
        gap: 12px;
        padding: 10px;
        list-style: none;
        max-height: none !important;
        overflow: visible !important;
    }
    .authorOthers.vamhub-related-grid.vamhub-card-small {
        --vamhub-related-card-min: 170px;
        --vamhub-related-thumb-height: 120px;
    }
    .authorOthers.vamhub-related-grid.vamhub-card-medium {
        --vamhub-related-card-min: 210px;
        --vamhub-related-thumb-height: 150px;
    }
    .authorOthers.vamhub-related-grid.vamhub-card-large {
        --vamhub-related-card-min: 270px;
        --vamhub-related-thumb-height: 180px;
    }
    .authorOthers.vamhub-related-grid .resourceAuthorOtherList > li {
        min-width: 0;
        height: auto !important;
        min-height: 0 !important;
        max-height: none !important;
        background: #222;
        border: 1px solid #333;
        border-radius: 6px;
        overflow: visible;
        display: flex;
        transition: border-color 0.15s ease, transform 0.15s ease, box-shadow 0.15s ease;
    }
    .authorOthers.vamhub-related-grid .resourceAuthorOtherList > li:hover {
        border-color: #4a6cf7;
        transform: translateY(-1px);
        box-shadow: 0 8px 24px rgba(0,0,0,0.32);
    }
    .authorOthers.vamhub-related-grid .resource-simple {
        display: flex;
        flex-direction: column;
        justify-content: flex-start;
        height: auto;
        min-height: 0;
        max-height: none !important;
        width: 100%;
        overflow: visible !important;
    }
    .authorOthers .vamhub-related-card-info {
        display: none;
    }
    .authorOthers.vamhub-related-grid .contentRow-figure {
        display: flex;
        flex: 0 0 auto;
        align-items: center;
        justify-content: center;
        width: 100%;
        height: var(--vamhub-related-thumb-height, 150px);
        min-height: var(--vamhub-related-thumb-height, 150px);
        max-height: var(--vamhub-related-thumb-height, 150px);
        margin: 0;
        background: #151515;
        overflow: hidden;
    }
    .authorOthers.vamhub-related-grid .contentRow-figure .avatar {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 100%;
        height: 100%;
        max-width: 100% !important;
        max-height: 100% !important;
        border-radius: 0;
        overflow: visible;
    }
    .authorOthers.vamhub-related-grid .contentRow-figure img {
        width: auto !important;
        height: auto !important;
        max-width: 100% !important;
        max-height: 100% !important;
        object-fit: contain;
    }
    .authorOthers.vamhub-related-grid .contentRow-main {
        display: none !important;
        flex: 1 1 auto !important;
        width: auto !important;
        min-width: 0 !important;
        padding: 8px 10px 10px;
        background: #222;
    }
    .authorOthers.vamhub-related-grid .vamhub-related-card-info {
        display: flex !important;
        flex: 0 0 auto;
        flex-direction: column;
        min-width: 0;
        width: 100%;
        height: auto !important;
        min-height: 0;
        max-height: none !important;
        box-sizing: border-box;
        padding: 8px 10px 10px;
        background: #222;
        overflow: visible;
        position: static !important;
        transform: none !important;
    }
    .authorOthers.vamhub-related-grid .vamhub-related-card-prefix {
        display: block;
        margin: 0 0 4px;
        min-height: 18px;
    }
    .authorOthers.vamhub-related-grid .vamhub-related-card-title {
        display: block !important;
        flex: 0 0 auto;
        height: auto !important;
        max-height: none !important;
        overflow: visible;
        color: #e7e7e7 !important;
        font-size: 13px;
        font-weight: 600;
        line-height: 1.3;
        overflow-wrap: anywhere;
        text-decoration: none !important;
    }
    .authorOthers.vamhub-related-grid .vamhub-related-card-title:hover {
        color: #8da2ff !important;
    }
    .authorOthers.vamhub-related-grid .vamhub-related-card-meta {
        display: block;
        flex: 0 0 auto;
        height: auto !important;
        max-height: none !important;
        margin-top: 6px;
        color: #aaa;
        font-size: 11px;
        line-height: 1.35;
        overflow: visible;
    }
    .authorOthers.vamhub-related-grid .vamhub-related-card-meta .simple-meta-container,
    .authorOthers.vamhub-related-grid .vamhub-related-card-meta .contentRow-minor {
        display: block !important;
    }
    .authorOthers.vamhub-related-grid .vamhub-related-card-meta .simple-meta-username,
    .authorOthers.vamhub-related-grid .vamhub-related-card-meta .simple-meta-date {
        display: block !important;
        overflow: visible;
        text-overflow: clip;
        white-space: normal;
    }
    .authorOthers.vamhub-related-grid .resource-simple-title {
        display: block !important;
        font-size: 13px;
        line-height: 1.3;
        color: #e7e7e7 !important;
        text-decoration: none !important;
    }
    .authorOthers.vamhub-related-grid .resource-simple-title .simple-prefix {
        display: block !important;
        margin: 0 0 4px;
        min-height: 18px;
    }
    .authorOthers.vamhub-related-grid .resource-simple-title .simple-title {
        display: block !important;
        overflow: visible;
        font-weight: 600;
        overflow-wrap: anywhere;
    }
    .authorOthers.vamhub-related-grid .resource-simple-title:hover .simple-title {
        color: #8da2ff;
    }
    .authorOthers.vamhub-related-grid .contentRow-minor {
        display: block !important;
        font-size: 11px;
        color: #aaa;
        margin-top: 6px;
    }
    .authorOthers.vamhub-related-grid .simple-meta-container {
        display: block !important;
    }
    .authorOthers.vamhub-related-grid .simple-meta-username,
    .authorOthers.vamhub-related-grid .simple-meta-date {
        display: block !important;
        overflow: visible;
        text-overflow: clip;
        white-space: normal;
    }
    @media (max-width: 650px) {
        .vamhub-resource-toolbar .vamhub-control.button {
            flex: 1 1 calc(50% - 6px);
        }
        .vamhub-resource-toolbar .vamhub-status {
            width: 100%;
        }
    }
    `;

    function injectStyle() {
        const s = document.createElement('style');
        s.textContent = STYLE;
        document.head.appendChild(s);
    }

    function detectPageType(root) {
        root = root || document;

        for (const type of PAGE_TYPES) {
            if (type.matches && !type.matches()) continue;

            const container = findContainerForType(root, type);
            if (container && container.querySelector(type.itemSelector)) {
                return { type, container };
            }
        }

        return null;
    }

    function findContainerForType(root, type) {
        const containers = root.querySelectorAll(type.containerSelector);
        for (const container of containers) {
            if (container.querySelector(type.itemSelector)) return container;
        }
        return null;
    }

    function getContainer() {
        if (!STATE.pageType) {
            const found = detectPageType(document);
            if (found) STATE.pageType = found.type;
        }
        if (!STATE.pageType) return null;
        return findContainerForType(document, STATE.pageType);
    }

    function applyGridClass() {
        const container = getContainer();
        if (!container) return;
        container.classList.toggle('vamhub-grid', STATE.gridEnabled);
        applyCardSizeClass();
        applyThumbnailModeClass();
        updateStatus();
    }

    function applyCardSizeClass() {
        const container = getContainer();
        if (!container) return;
        STATE.cardSize = normalizeCardSize(STATE.cardSize);
        container.classList.remove('vamhub-card-small', 'vamhub-card-medium', 'vamhub-card-large');
        container.classList.add('vamhub-card-' + STATE.cardSize);
    }

    function applyThumbnailModeClass() {
        const container = getContainer();
        if (!container) return;
        STATE.thumbnailMode = normalizeThumbnailMode(STATE.thumbnailMode);
        container.classList.remove('vamhub-thumbs-hover', 'vamhub-thumbs-pinned', 'vamhub-thumbs-off');
        container.classList.add('vamhub-thumbs-' + STATE.thumbnailMode);
    }

    function cycleCardSize() {
        const sizes = ['small', 'medium', 'large'];
        const currentIndex = sizes.indexOf(normalizeCardSize(STATE.cardSize));
        STATE.cardSize = sizes[(currentIndex + 1) % sizes.length];
        GM_setValueSafe('vamhub_card_size', STATE.cardSize);
        applyCardSizeClass();
        updateStatus();
        return STATE.cardSize;
    }

    function cycleThumbnailMode() {
        const modes = ['hover', 'pinned', 'off'];
        const currentIndex = modes.indexOf(normalizeThumbnailMode(STATE.thumbnailMode));
        STATE.thumbnailMode = modes[(currentIndex + 1) % modes.length];
        GM_setValueSafe('vamhub_thumbnail_mode', STATE.thumbnailMode);
        applyThumbnailModeClass();
        updateStatus();
        return STATE.thumbnailMode;
    }

    function getItemCount() {
        const container = getContainer();
        if (!container || !STATE.pageType) return 0;
        return container.querySelectorAll(STATE.pageType.itemSelector).length;
    }

    function updateStatus(prefix) {
        const parts = [];
        if (prefix) parts.push(prefix);
        parts.push(getItemCount() + ' items');
        parts.push('Cards: ' + normalizeCardSize(STATE.cardSize));
        parts.push('Thumbs: ' + normalizeThumbnailMode(STATE.thumbnailMode));
        if (STATE.done) parts.push('End');
        setStatus(parts.join(' | '));

        const bar = document.querySelector('.vamhub-toolbar');
        if (bar && bar._loadBtn) {
            bar._loadBtn.disabled = STATE.loading || STATE.done;
        }
    }

    function setButtonTooltip(button, text) {
        button.title = text;
        button.setAttribute('aria-label', text);
        button.dataset.xfInit = 'tooltip';
    }

    function updateToggleTooltips(gridBtn, autoBtn) {
        setButtonTooltip(gridBtn, STATE.gridEnabled ? 'Switch back to the normal list view.' : 'Switch listings into grid/card view.');
        setButtonTooltip(autoBtn, STATE.autoPagerEnabled ? 'Turn off automatic loading when you scroll near the bottom.' : 'Turn on automatic loading when you scroll near the bottom.');
    }

    function updateSizeTooltip(sizeBtn) {
        const sizes = ['small', 'medium', 'large'];
        const current = normalizeCardSize(STATE.cardSize);
        const next = sizes[(sizes.indexOf(current) + 1) % sizes.length];
        setButtonTooltip(sizeBtn, 'Current card size is ' + current + '. Click to change to ' + next + '.');
    }

    function updateThumbnailTooltip(thumbBtn) {
        const modes = ['hover', 'pinned', 'off'];
        const current = normalizeThumbnailMode(STATE.thumbnailMode);
        const next = modes[(modes.indexOf(current) + 1) % modes.length];
        setButtonTooltip(thumbBtn, 'Thumbnail strip is ' + current + '. Click to change to ' + next + '.');
    }

    function makeButton(label, iconClass, onClick) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'button vamhub-control';

        const text = document.createElement('span');
        text.className = 'button-text';

        if (iconClass) {
            const icon = document.createElement('i');
            icon.className = 'fa--xf far ' + iconClass + ' vamhub-control-icon';
            icon.setAttribute('aria-hidden', 'true');
            text.appendChild(icon);
        }

        const labelEl = document.createElement('span');
        labelEl.className = 'vamhub-control-label';
        labelEl.textContent = label;
        text.appendChild(labelEl);

        button.appendChild(text);
        if (onClick) button.addEventListener('click', onClick);
        return button;
    }

    function setButtonLabel(button, label) {
        const labelEl = button.querySelector('.vamhub-control-label');
        if (labelEl) labelEl.textContent = label;
        else button.textContent = label;
    }

    function setButtonActive(button, active) {
        button.classList.toggle('is-active', active);
        button.classList.toggle('button--primary', active);
    }

    function isResourceViewPage() {
        return document.body && document.body.dataset.template === 'xfrm_resource_view';
    }

    function getResourceMediaItems() {
        return Array.from(document.querySelectorAll('.resourceBody-main img.bbImage, .resourceBody-main video'));
    }

    function getRelatedResourceBlock() {
        return document.querySelector('.authorOthers');
    }

    function enhanceRelatedResourceCards() {
        const block = getRelatedResourceBlock();
        if (!block) return;

        block.querySelectorAll('.resourceAuthorOtherList > li').forEach((item) => {
            const row = item.querySelector('.resource-simple');
            if (!row || row.querySelector(':scope > .vamhub-related-card-info')) return;

            const sourceLink = row.querySelector('.resource-simple-title');
            const imageLink = row.querySelector('.contentRow-figure a[href]');
            const sourceTitle = row.querySelector('.resource-simple-title .simple-title');
            const titleText = (sourceTitle && sourceTitle.textContent.trim())
                || (sourceLink && sourceLink.textContent.trim())
                || (row.querySelector('.contentRow-figure img') && row.querySelector('.contentRow-figure img').alt.trim())
                || 'Resource';
            const href = (sourceLink && sourceLink.href) || (imageLink && imageLink.href) || '#';

            const info = document.createElement('div');
            info.className = 'vamhub-related-card-info';

            const prefix = sourceLink && sourceLink.querySelector('.simple-prefix');
            if (prefix && prefix.textContent.trim()) {
                const prefixClone = prefix.cloneNode(true);
                prefixClone.classList.add('vamhub-related-card-prefix');
                info.appendChild(prefixClone);
            }

            const title = document.createElement('a');
            title.className = 'vamhub-related-card-title';
            title.href = href;
            title.title = titleText;
            title.textContent = titleText;
            info.appendChild(title);

            const meta = row.querySelector('.simple-meta-container') || row.querySelector('.contentRow-minor');
            if (meta && meta.textContent.trim()) {
                const metaWrap = document.createElement('div');
                metaWrap.className = 'vamhub-related-card-meta';
                metaWrap.appendChild(meta.cloneNode(true));
                info.appendChild(metaWrap);
            }

            row.appendChild(info);
        });
    }

    function applyResourceMediaMode() {
        STATE.resourceMediaMode = normalizeResourceMediaMode(STATE.resourceMediaMode);
        document.body.classList.remove('vamhub-resource-media-fit', 'vamhub-resource-media-full', 'vamhub-resource-media-compact');
        document.body.classList.add('vamhub-resource-media-' + STATE.resourceMediaMode);
        updateResourceStatus();
    }

    function applyRelatedGrid() {
        const block = getRelatedResourceBlock();
        if (!block) return;
        enhanceRelatedResourceCards();
        block.classList.toggle('vamhub-related-grid', STATE.resourceRelatedGrid);
        block.classList.remove('vamhub-card-small', 'vamhub-card-medium', 'vamhub-card-large');
        block.classList.add('vamhub-card-' + normalizeCardSize(STATE.cardSize));
        updateResourceStatus();
    }

    function cycleResourceMediaMode() {
        const modes = ['fit', 'full', 'compact'];
        const currentIndex = modes.indexOf(normalizeResourceMediaMode(STATE.resourceMediaMode));
        STATE.resourceMediaMode = modes[(currentIndex + 1) % modes.length];
        GM_setValueSafe('vamhub_resource_media_mode', STATE.resourceMediaMode);
        applyResourceMediaMode();
        return STATE.resourceMediaMode;
    }

    function updateResourceMediaTooltip(mediaBtn) {
        const modes = ['fit', 'full', 'compact'];
        const current = normalizeResourceMediaMode(STATE.resourceMediaMode);
        const next = modes[(modes.indexOf(current) + 1) % modes.length];
        setButtonTooltip(mediaBtn, 'Resource media is ' + current + '. Click to change to ' + next + '.');
    }

    function updateResourceRelatedTooltip(relatedBtn) {
        setButtonTooltip(relatedBtn, STATE.resourceRelatedGrid ? 'Show related resources as the normal list.' : 'Show related resources as thumbnail cards.');
    }

    function updateResourceStatus(prefix) {
        const bar = document.querySelector('.vamhub-resource-toolbar');
        if (!bar || !bar._statusEl) return;

        const parts = [];
        if (prefix) parts.push(prefix);
        parts.push(getResourceMediaItems().length + ' media');
        if (getRelatedResourceBlock()) {
            parts.push(STATE.resourceRelatedGrid ? 'Related: grid' : 'Related: list');
        }
        bar._statusEl.textContent = parts.join(' | ');
    }

    function enhanceResourceMedia() {
        getResourceMediaItems().forEach((media) => {
            media.classList.add('vamhub-resource-media');
            if (media.tagName === 'IMG') {
                media.loading = media.loading || 'lazy';
            }
        });
    }

    function setupResourceHoverPreview() {
        const selectors = [
            '.resource-header-avatar img',
            '.sidebar-resource-avatar img',
            '.authorOthers .contentRow-figure img',
            '.communityGallery img',
            '.resourceBody-main img.bbImage',
        ].join(', ');

        document.addEventListener('mouseover', (e) => {
            const img = e.target.closest(selectors);
            if (!img) return;
            if (previewTarget === img) return;

            previewTarget = img;
            if (previewTimer) clearTimeout(previewTimer);
            previewTimer = setTimeout(() => {
                if (previewTarget === img) {
                    showPreview(img, e.clientX, e.clientY);
                }
            }, 120);
        });

        document.addEventListener('mousemove', (e) => {
            if (previewEl && previewEl.classList.contains('visible') && previewTarget) {
                positionPreview(previewEl, e.clientX, e.clientY);
            }
        });

        document.addEventListener('mouseout', (e) => {
            const img = e.target.closest(selectors);
            if (!img) return;
            if (e.relatedTarget && img.contains(e.relatedTarget)) return;
            hidePreview();
        });
    }

    function buildResourceToolbar() {
        if (document.querySelector('.vamhub-resource-toolbar')) return;

        const host = document.querySelector('.action-button-container .block-outer-left')
            || document.querySelector('.resource-header-main')
            || document.querySelector('.p-body-header')
            || document.querySelector('.p-body-pageContent');
        if (!host) return;

        const bar = document.createElement('div');
        bar.className = 'vamhub-resource-toolbar';

        const mediaBtn = makeButton('Media: ' + normalizeResourceMediaMode(STATE.resourceMediaMode), 'fa-photo-video', () => {
            setButtonLabel(mediaBtn, 'Media: ' + cycleResourceMediaMode());
            updateResourceMediaTooltip(mediaBtn);
        });
        updateResourceMediaTooltip(mediaBtn);

        const relatedBtn = makeButton('Related', 'fa-th-large', () => {
            STATE.resourceRelatedGrid = !STATE.resourceRelatedGrid;
            GM_setValueSafe('vamhub_resource_related_grid', STATE.resourceRelatedGrid);
            setButtonActive(relatedBtn, STATE.resourceRelatedGrid);
            updateResourceRelatedTooltip(relatedBtn);
            applyRelatedGrid();
        });
        setButtonActive(relatedBtn, STATE.resourceRelatedGrid);
        updateResourceRelatedTooltip(relatedBtn);
        if (!getRelatedResourceBlock()) relatedBtn.disabled = true;

        const sizeBtn = makeButton('Cards: ' + normalizeCardSize(STATE.cardSize), 'fa-expand-alt', () => {
            setButtonLabel(sizeBtn, 'Cards: ' + cycleCardSize());
            updateSizeTooltip(sizeBtn);
            applyRelatedGrid();
        });
        updateSizeTooltip(sizeBtn);
        if (!getRelatedResourceBlock()) sizeBtn.disabled = true;

        const backBtn = makeButton('Back', 'fa-arrow-left', () => {
            if (history.length > 1) {
                history.back();
            } else {
                location.href = 'https://hub.virtamate.com/resources/';
            }
        });
        setButtonTooltip(backBtn, 'Go back to the previous page, or Resources if there is no browser history.');

        const topBtn = makeButton('Top', 'fa-arrow-up', () => {
            window.scrollTo({ top: 0, behavior: 'smooth' });
        });
        setButtonTooltip(topBtn, 'Scroll back to the top of this page.');

        const status = document.createElement('div');
        status.className = 'vamhub-status';
        bar._statusEl = status;

        bar.appendChild(mediaBtn);
        bar.appendChild(relatedBtn);
        bar.appendChild(sizeBtn);
        bar.appendChild(backBtn);
        bar.appendChild(topBtn);
        bar.appendChild(status);

        host.appendChild(bar);
        activateXenForoContent(bar);
        updateResourceStatus();
    }

    function getToolbarHost(container) {
        const block = container.closest('.block');
        const overviewTopControls = block && block.querySelector('.filter-bars-container .block-filterBar.bar-controls .filterBar-controls');
        if (overviewTopControls && !overviewTopControls.closest('.block-outer--after')) {
            return { host: overviewTopControls, mode: 'inline' };
        }

        const documentTopControls = document.querySelector('.filter-bars-container .block-filterBar.bar-controls .filterBar-controls');
        if (documentTopControls && !documentTopControls.closest('.block-outer--after')) {
            return { host: documentTopControls, mode: 'inline' };
        }

        const blockContainer = container.closest('.block-container');
        const filterBar = blockContainer && blockContainer.querySelector(':scope > .block-filterBar:not(.bar-filters) .filterBar');
        if (filterBar) {
            return { host: filterBar, mode: 'inline' };
        }

        const topBlockOuter = block && Array.from(block.querySelectorAll(':scope > .block-outer:not(.block-outer--after) .block-outer-main'))
            .find((el) => !el.closest('.block-outer--after'));
        const blockOuterMain = topBlockOuter || (block && block.querySelector(':scope > .block-outer .block-outer-main'));
        if (blockOuterMain) {
            return { host: blockOuterMain, mode: 'inline' };
        }

        return { host: container.parentElement, mode: 'standalone' };
    }

    function placeToolbar(bar, container) {
        const target = getToolbarHost(container);
        bar.classList.toggle('vamhub-toolbar--standalone', target.mode === 'standalone');

        if (target.mode === 'standalone') {
            if (bar.parentElement !== target.host || bar.nextSibling !== container) {
                target.host.insertBefore(bar, container);
            }
        } else {
            target.host.classList.add('vamhub-filterbar-host');
            if (bar.parentElement !== target.host) {
                target.host.appendChild(bar);
            }
        }

        return target;
    }

    function activateXenForoContent(root) {
        if (!window.XF || !root) return;
        try {
            if (typeof window.XF.activate === 'function') {
                window.XF.activate(root);
            } else if (typeof window.XF.initElement === 'function') {
                root.querySelectorAll('[data-xf-init]').forEach((el) => window.XF.initElement(el));
            }
        } catch (e) {}
    }

    function buildToolbar() {
        const container = getContainer();
        if (!container) return;

        const existingBar = document.querySelector('.vamhub-toolbar');
        if (existingBar) {
            placeToolbar(existingBar, container);
            updateStatus();
            return;
        }

        const bar = document.createElement('div');
        bar.className = 'vamhub-toolbar';

        const gridBtn = makeButton('Grid', 'fa-th-large', () => {
            STATE.gridEnabled = !STATE.gridEnabled;
            GM_setValueSafe('vamhub_grid_enabled', STATE.gridEnabled);
            setButtonActive(gridBtn, STATE.gridEnabled);
            updateToggleTooltips(gridBtn, autoBtn);
            applyGridClass();
        });
        setButtonActive(gridBtn, STATE.gridEnabled);

        const autoBtn = makeButton('Auto', 'fa-sync-alt', () => {
            STATE.autoPagerEnabled = !STATE.autoPagerEnabled;
            GM_setValueSafe('vamhub_autopager_enabled', STATE.autoPagerEnabled);
            setButtonActive(autoBtn, STATE.autoPagerEnabled);
            updateToggleTooltips(gridBtn, autoBtn);
            if (STATE.autoPagerEnabled && !STATE.done) maybeLoadNextPage();
        });
        setButtonActive(autoBtn, STATE.autoPagerEnabled);

        const loadBtn = makeButton('More', 'fa-plus-circle', () => {
            maybeLoadNextPage(true);
        });
        setButtonTooltip(loadBtn, 'Load the next page of results now.');

        const sizeBtn = makeButton('Cards: ' + normalizeCardSize(STATE.cardSize), 'fa-expand-alt', () => {
            setButtonLabel(sizeBtn, 'Cards: ' + cycleCardSize());
            updateSizeTooltip(sizeBtn);
        });
        updateSizeTooltip(sizeBtn);

        const thumbBtn = makeButton('Thumbs: ' + normalizeThumbnailMode(STATE.thumbnailMode), 'fa-images', () => {
            setButtonLabel(thumbBtn, 'Thumbs: ' + cycleThumbnailMode());
            updateThumbnailTooltip(thumbBtn);
        });
        updateThumbnailTooltip(thumbBtn);

        const backBtn = makeButton('Back', 'fa-arrow-left', () => {
            if (history.length > 1) {
                history.back();
            } else {
                location.href = 'https://hub.virtamate.com/';
            }
        });
        setButtonTooltip(backBtn, 'Go back to the previous page, or the Hub home page if there is no browser history.');

        const topBtn = makeButton('Top', 'fa-arrow-up', () => {
            window.scrollTo({ top: 0, behavior: 'smooth' });
        });
        setButtonTooltip(topBtn, 'Scroll back to the top of this page.');

        updateToggleTooltips(gridBtn, autoBtn);

        const status = document.createElement('div');
        status.className = 'vamhub-status';
        status.textContent = '';
        bar.dataset.role = 'vamhub-status-holder';
        bar._statusEl = status;
        bar._loadBtn = loadBtn;

        bar.appendChild(gridBtn);
        bar.appendChild(autoBtn);
        bar.appendChild(loadBtn);
        bar.appendChild(sizeBtn);
        bar.appendChild(thumbBtn);
        bar.appendChild(backBtn);
        bar.appendChild(topBtn);
        bar.appendChild(status);

        placeToolbar(bar, container);

        activateXenForoContent(bar);
        updateStatus();
    }

    function setStatus(text) {
        const bar = document.querySelector('.vamhub-toolbar');
        if (bar && bar._statusEl) bar._statusEl.textContent = text;
        if (bar && bar._loadBtn) bar._loadBtn.disabled = STATE.loading || STATE.done;
    }

    function getNextPageUrl(root) {
        root = root || document;
        if (root === document && STATE.nextUrl) return STATE.nextUrl;

        const link = root.querySelector('link[rel="next"]');
        if (link && link.href) return link.href;

        const nextBtn = root.querySelector('.pageNav-jump--next, a[rel="next"]');
        if (nextBtn && nextBtn.href) return nextBtn.href;

        return null;
    }

    function ensureLoader() {
        let loader = document.querySelector('.vamhub-loader');
        if (!loader) {
            loader = document.createElement('div');
            loader.className = 'vamhub-loader';
            const container = getContainer();
            if (container) container.insertAdjacentElement('afterend', loader);
        }
        return loader;
    }

    async function maybeLoadNextPage(force) {
        if ((!STATE.autoPagerEnabled && !force) || STATE.loading || STATE.done) return;
        const nextUrl = getNextPageUrl();
        if (!nextUrl) {
            STATE.done = true;
            updateStatus('No more pages');
            const loader = ensureLoader();
            loader.textContent = 'No more pages.';
            return;
        }
        if (STATE.loadedUrls.has(nextUrl)) {
            STATE.done = true;
            updateStatus('Stopped duplicate page');
            return;
        }

        STATE.loading = true;
        STATE.loadedUrls.add(nextUrl);
        const loader = ensureLoader();
        loader.textContent = 'Loading more...';
        setStatus('Loading: ' + nextUrl);

        try {
            const res = await fetch(nextUrl, { credentials: 'same-origin' });
            const html = await res.text();
            const doc = new DOMParser().parseFromString(html, 'text/html');

            const type = STATE.pageType;
            const newContainer = type ? findContainerForType(doc, type) : null;
            const container = getContainer();
            let addedCount = 0;
            if (newContainer && container && type) {
                const newItems = newContainer.querySelectorAll(type.itemSelector);
                newItems.forEach((item) => {
                    container.appendChild(item);
                    addedCount += 1;
                });
                enhanceThumbnailControls(container);
                activateXenForoContent(container);
            }

            STATE.nextUrl = getNextPageUrl(doc);
            const currentNextLink = document.querySelector('link[rel="next"]');
            if (STATE.nextUrl && currentNextLink) {
                currentNextLink.href = STATE.nextUrl;
            } else if (!STATE.nextUrl && currentNextLink) {
                currentNextLink.remove();
                STATE.done = true;
            } else if (!STATE.nextUrl) {
                STATE.done = true;
            }

            applyGridClass();
            updateStatus(addedCount ? 'Loaded ' + addedCount + ' more' : 'No new items found');
        } catch (err) {
            STATE.loadedUrls.delete(nextUrl);
            setStatus('Error loading next page: ' + err.message);
        } finally {
            STATE.loading = false;
            loader.textContent = '';
        }
    }

    let previewEl = null;
    let previewTimer = null;
    let previewTarget = null;

    function getPreviewEl() {
        if (!previewEl) {
            previewEl = document.createElement('div');
            previewEl.className = 'vamhub-hover-preview';
            const img = document.createElement('img');
            previewEl.appendChild(img);
            document.body.appendChild(previewEl);
        }
        return previewEl;
    }

    function positionPreview(el, mouseX, mouseY) {
        const margin = 16;
        const rect = el.getBoundingClientRect();
        let left = mouseX + margin;
        let top = mouseY + margin;

        if (left + rect.width > window.innerWidth) {
            left = mouseX - rect.width - margin;
        }
        if (left < 0) left = margin;

        if (top + rect.height > window.innerHeight) {
            top = mouseY - rect.height - margin;
        }
        if (top < 0) top = margin;

        el.style.left = left + 'px';
        el.style.top = top + 'px';
    }

    function showPreview(thumbImg, mouseX, mouseY) {
        const el = getPreviewEl();
        const img = el.querySelector('img');
        const fullSrc = thumbImg.dataset.previewSrc || thumbImg.src;
        if (img.src !== fullSrc) img.src = fullSrc;
        el.classList.add('visible');
        positionPreview(el, mouseX, mouseY);
    }

    function hidePreview() {
        if (previewEl) previewEl.classList.remove('visible');
        previewTarget = null;
        if (previewTimer) {
            clearTimeout(previewTimer);
            previewTimer = null;
        }
    }

    function setupHoverPreview() {
        const container = getContainer();
        if (!container || !STATE.pageType) return;
        const thumbSelector = STATE.pageType.thumbSelector;

        container.addEventListener('mouseover', (e) => {
            if (!STATE.gridEnabled) return;
            const thumbImg = e.target.closest(thumbSelector);
            if (!thumbImg) return;
            if (previewTarget === thumbImg) return;

            const item = thumbImg.closest('.structItem, .block-row.searchItemContainer, .block-row');
            const hasFilmstrip = item && item.querySelector('.listMacrosThumbContainer .js-lbImage');
            if (hasFilmstrip) return;

            previewTarget = thumbImg;
            if (previewTimer) clearTimeout(previewTimer);
            previewTimer = setTimeout(() => {
                if (previewTarget === thumbImg) {
                    showPreview(thumbImg, e.clientX, e.clientY);
                }
            }, 150);
        });

        container.addEventListener('mousemove', (e) => {
            if (previewEl && previewEl.classList.contains('visible') && previewTarget) {
                positionPreview(previewEl, e.clientX, e.clientY);
            }
        });

        container.addEventListener('mouseout', (e) => {
            const thumbImg = e.target.closest(thumbSelector);
            if (!thumbImg) return;
            if (e.relatedTarget && thumbImg.contains(e.relatedTarget)) return;
            hidePreview();
        });
    }

    function makeThumbNavButton(direction) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'vamhub-thumb-nav vamhub-thumb-nav--' + direction;
        button.innerHTML = direction === 'prev'
            ? '<i class="fa--xf far fa-chevron-left" aria-hidden="true"></i>'
            : '<i class="fa--xf far fa-chevron-right" aria-hidden="true"></i>';

        const label = direction === 'prev' ? 'Scroll thumbnails left' : 'Scroll thumbnails right';
        button.title = label;
        button.setAttribute('aria-label', label);
        button.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();

            const strip = button.parentElement && button.parentElement.querySelector('.searchresultImages');
            if (!strip) return;

            const distance = Math.max(90, Math.floor(strip.clientWidth * 0.75));
            strip.scrollBy({ left: direction === 'prev' ? -distance : distance, behavior: 'smooth' });
        });

        return button;
    }

    function getMainCardImage(item) {
        return item && item.querySelector('.structItem-iconContainer > a.avatar img, .searchResultIcon img, .contentRow-figure img');
    }

    function setCardPreviewFromThumb(anchor) {
        const item = anchor.closest('.structItem, .block-row.searchItemContainer, .block-row');
        const mainImg = getMainCardImage(item);
        const thumbImg = anchor.querySelector('img');
        if (!mainImg || !thumbImg) return;

        if (!mainImg.dataset.vamhubOriginalSrc) {
            mainImg.dataset.vamhubOriginalSrc = mainImg.currentSrc || mainImg.src;
            if (mainImg.getAttribute('srcset')) {
                mainImg.dataset.vamhubOriginalSrcset = mainImg.getAttribute('srcset');
            }
        }

        mainImg.src = thumbImg.currentSrc || thumbImg.src;
        mainImg.removeAttribute('srcset');

        item.querySelectorAll('.js-lbImage.vamhub-thumb-active').forEach((el) => {
            el.classList.remove('vamhub-thumb-active');
        });
        anchor.classList.add('vamhub-thumb-active');
    }

    function restoreCardPreview(item) {
        const mainImg = getMainCardImage(item);
        if (!mainImg || !mainImg.dataset.vamhubOriginalSrc) return;

        mainImg.src = mainImg.dataset.vamhubOriginalSrc;
        if (mainImg.dataset.vamhubOriginalSrcset) {
            mainImg.setAttribute('srcset', mainImg.dataset.vamhubOriginalSrcset);
        }

        item.querySelectorAll('.js-lbImage.vamhub-thumb-active').forEach((el) => {
            el.classList.remove('vamhub-thumb-active');
        });
    }

    function enhanceThumbnailControls(root) {
        const scope = root || document;
        scope.querySelectorAll('.listMacrosThumbContainer').forEach((thumbContainer) => {
            const strip = thumbContainer.querySelector('.searchresultImages');
            if (!strip || !strip.querySelector('.js-lbImage')) return;

            if (!thumbContainer.querySelector('.vamhub-thumb-nav--prev')) {
                thumbContainer.insertBefore(makeThumbNavButton('prev'), thumbContainer.firstChild);
            }
            if (!thumbContainer.querySelector('.vamhub-thumb-nav--next')) {
                thumbContainer.appendChild(makeThumbNavButton('next'));
            }

            strip.querySelectorAll('.js-lbImage').forEach((anchor) => {
                if (anchor.dataset.vamhubThumbReady) return;
                anchor.dataset.vamhubThumbReady = '1';
                anchor.setAttribute('tabindex', '0');
                anchor.addEventListener('mouseenter', () => setCardPreviewFromThumb(anchor));
                anchor.addEventListener('focus', () => setCardPreviewFromThumb(anchor));
                anchor.addEventListener('click', () => setCardPreviewFromThumb(anchor), true);
            });
        });
    }

    function setupThumbnailControls() {
        const container = getContainer();
        if (!container) return;

        enhanceThumbnailControls(container);

        container.addEventListener('mouseout', (event) => {
            const item = event.target.closest('.structItem, .block-row.searchItemContainer, .block-row');
            if (!item || (event.relatedTarget && item.contains(event.relatedTarget))) return;
            restoreCardPreview(item);
        });
    }

    function setupScrollWatcher() {
        window.addEventListener('scroll', () => {
            if (!STATE.autoPagerEnabled || STATE.loading || STATE.done) return;
            const scrollBottom = window.innerHeight + window.scrollY;
            const threshold = document.body.offsetHeight - 800;
            if (scrollBottom >= threshold) {
                maybeLoadNextPage();
            }
        }, { passive: true });
    }

    function initResourceView() {
        injectStyle();
        enhanceResourceMedia();
        buildResourceToolbar();
        applyResourceMediaMode();
        applyRelatedGrid();
        setupResourceHoverPreview();
    }

    function init() {
        if (isResourceViewPage()) {
            initResourceView();
            return;
        }

        if (!getContainer()) return;
        injectStyle();
        buildToolbar();
        applyGridClass();
        setupThumbnailControls();
        setupScrollWatcher();
        setupHoverPreview();
        if (STATE.autoPagerEnabled) maybeLoadNextPage();
    }

    init();
})();
