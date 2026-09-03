/*
 * Qtiler Stories — public portal runtime.
 * Renders the portal pages and map gallery in the browser, aggregating
 * published maps from Qtiler2Origo, Qtiler2Hajk and Qtiler 3D Eye.
 */
(function () {
  'use strict';

  const $ = (sel) => document.querySelector(sel);

  const escapeHtml = (value) => String(value ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

  const sanitizeRichHtml = (html) => String(html || '')
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, '')
    .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/javascript:/gi, '');

  const sanitizeUrl = (url) => {
    const value = String(url || '').trim();
    if (!value) return '#';
    if (/^javascript:/i.test(value)) return '#';
    return value;
  };

  const consentKey = 'qtilerStories.gdprConsent';

  function getConsent() {
    try { return localStorage.getItem(consentKey); } catch { return null; }
  }

  function setConsent(value) {
    try { localStorage.setItem(consentKey, value); } catch {}
  }

  function applySiteIdentity(site, logoUrl) {
    const hero = $('#portalHero');
    const titleEl = $('#portalTitle');
    const subtitleEl = $('#portalSubtitle');
    const logoEl = $('#portalLogo');
    const footer = $('#portalFooter');
    const footerText = $('#portalFooterText');
    const footerLink = $('#portalFooterLink');

    const title = String(site?.title || '').trim();
    const subtitle = String(site?.subtitle || '').trim();
    if (titleEl) titleEl.textContent = title || 'Maps';
    if (subtitleEl) subtitleEl.textContent = subtitle;
    if (title) document.title = title;

    const logoSrc = String(site?.headerLogoUrl || '').trim() || String(logoUrl || '').trim();
    if (logoEl && logoSrc) {
      logoEl.src = logoSrc;
      logoEl.style.display = '';
    }

    if (hero) {
      const h = Number(site?.headerHeight) || 120;
      const font = String(site?.headerFont || 'fraunces').toLowerCase();
      const c1 = String(site?.headerColor1 || '#0f766e');
      const c2 = String(site?.headerColor2 || '#2563eb');
      const textColor = String(site?.headerTextColor || '#ffffff');
      const bgUrl = String(site?.headerBackgroundUrl || '').trim();
      const fontFamily = font === 'manrope' ? '"Manrope", "Segoe UI", sans-serif'
        : font === 'serif' ? 'Georgia, serif'
        : font === 'sans' ? '"Segoe UI", sans-serif'
        : '"Fraunces", Georgia, serif';
      hero.style.setProperty('--portal-header-height', `${h}px`);
      hero.style.setProperty('--portal-header-font', fontFamily);
      hero.style.setProperty('--portal-header-text', textColor);
      hero.style.setProperty('--portal-header-bg', bgUrl
        ? `linear-gradient(135deg, ${c1}, ${c2}), url('${bgUrl}')`
        : `linear-gradient(135deg, ${c1}, ${c2})`);
      if (bgUrl) {
        hero.style.backgroundImage = `linear-gradient(135deg, ${c1}cc, ${c2}cc), url('${bgUrl}')`;
      } else {
        hero.style.background = `linear-gradient(135deg, ${c1}, ${c2})`;
      }
    }

    const fText = String(site?.footerText || '').replace('{year}', String(new Date().getFullYear()));
    const fLinkLabel = String(site?.footerLinkLabel || '').trim();
    const fLink = String(site?.footerLink || '').trim();
    if (footer && (fText || (fLinkLabel && fLink))) {
      footer.style.display = '';
      if (footerText) footerText.textContent = fText;
      if (footerLink && fLinkLabel && fLink) {
        footerLink.textContent = fLinkLabel;
        footerLink.href = fLink;
      }
      footer.style.setProperty('--portal-footer-bg', String(site?.footerBackgroundColor || '#1f2933'));
      footer.style.setProperty('--portal-footer-text', String(site?.footerTextColor || '#cbd5e1'));
      footer.style.setProperty('--portal-footer-link', String(site?.footerLinkColor || '#93c5fd'));
    }
  }

  function applyGdpr(gdpr) {
    const banner = $('#cookieBanner');
    if (!banner || !gdpr?.enabled) return;
    if (getConsent()) return; // already answered

    const setText = (id, value, fallback) => {
      const el = $(id);
      if (el) el.textContent = String(value || fallback || '');
    };
    setText('#cookieTitle', gdpr.bannerTitle, 'Privacy and cookies');
    setText('#cookieText', gdpr.bannerText, 'This portal uses essential storage for language and consent settings.');
    setText('#cookieAccept', gdpr.acceptLabel, 'Accept all');
    setText('#cookieReject', gdpr.rejectLabel, 'Only necessary');

    const linksHost = $('#cookieLinks');
    if (linksHost) {
      const links = [];
      const company = String(gdpr.companyName || '').trim();
      if (gdpr.privacyUrl) links.push(`<a href="${escapeHtml(sanitizeUrl(gdpr.privacyUrl))}" target="_blank" rel="noreferrer">Privacy policy</a>`);
      if (gdpr.cookiePolicyUrl) links.push(`<a href="${escapeHtml(sanitizeUrl(gdpr.cookiePolicyUrl))}" target="_blank" rel="noreferrer">Cookie policy</a>`);
      if (gdpr.contactUrl) links.push(`<a href="${escapeHtml(sanitizeUrl(gdpr.contactUrl))}" target="_blank" rel="noreferrer">${escapeHtml(company || 'Contact')}</a>`);
      linksHost.innerHTML = links.join('');
    }

    banner.classList.add('is-visible');
    $('#cookieAccept')?.addEventListener('click', () => { setConsent('all'); banner.classList.remove('is-visible'); });
    $('#cookieReject')?.addEventListener('click', () => { setConsent('necessary'); banner.classList.remove('is-visible'); });
  }

  function renderNav(portal, currentSlug) {
    const wrap = $('#portalNavWrap');
    const nav = $('#portalNav');
    if (!nav || !portal) return;
    const pages = (portal.pages || []).filter((p) => p.showInNav !== false);
    if (!pages.length) return;
    if (wrap) wrap.style.display = '';
    nav.innerHTML = pages.map((page) => {
      const active = page.slug === currentSlug ? ' is-active' : '';
      return `<a href="${escapeHtml(page.url)}" class="${active.trim()}">${escapeHtml(page.navLabel || page.title)}</a>`;
    }).join('');
  }

  function mapSourceBadge(source) {
    const s = String(source || '').toLowerCase();
    if (s === 'hajk') return '<span class="map-source-badge map-source-badge--hajk">Hajk</span>';
    if (s === '3d') return '<span class="map-source-badge map-source-badge--3d">3D</span>';
    return '<span class="map-source-badge">Origo</span>';
  }

  function renderMapsGallery(items) {
    if (!items.length) {
      return `<div class="empty-state"><h2>No maps published yet</h2><p>Published maps from Qtiler2Origo, Qtiler2Hajk and Qtiler 3D Eye will appear here.</p></div>`;
    }
    return `<div class="columns is-multiline">${items.map((item) => {
      const thumb = String(item.thumbnailUrl || '').trim();
      const launch = sanitizeUrl(item.launchUrl || '#');
      return `
        <div class="column is-one-third-desktop is-half-tablet">
          <a class="map-card" href="${escapeHtml(launch)}" target="_blank" rel="noreferrer" style="text-decoration:none;color:inherit">
            <div class="map-card-image"${thumb ? ` style="background-image:url('${escapeHtml(thumb)}')"` : ''}>
              <h3 class="map-card-title">${escapeHtml(item.name || item.profileKey || '')}</h3>
            </div>
            <div class="map-card-body">
              <div class="map-card-desc">${escapeHtml(item.description || '')}</div>
              ${mapSourceBadge(item.source)}
            </div>
          </a>
        </div>`;
    }).join('')}</div>`;
  }

  function renderBlock(block, items) {
    const type = String(block?.type || 'text');
    if (type === 'hero') {
      const bg = block.backgroundUrl
        ? ` style="background-image: linear-gradient(135deg, rgba(0,87,216,0.92), rgba(13,148,136,0.72)), url('${escapeHtml(sanitizeUrl(block.backgroundUrl))}');"`
        : '';
      return `<section class="portal-section portal-section--hero"${bg}><div class="portal-section__body"><div class="portal-section__eyebrow">${escapeHtml(block.eyebrow || '')}</div><h2>${escapeHtml(block.title || '')}</h2><div class="portal-richtext">${sanitizeRichHtml(block.subtitle || '')}</div>${block.ctaLabel ? `<a class="portal-cta" href="${escapeHtml(sanitizeUrl(block.ctaUrl))}">${escapeHtml(block.ctaLabel)}</a>` : ''}</div></section>`;
    }
    if (type === 'text') {
      return `<section class="portal-section"><div class="portal-section__body"><h2>${escapeHtml(block.title || '')}</h2><div class="portal-richtext">${sanitizeRichHtml(block.body || '')}</div></div></section>`;
    }
    if (type === 'maps') {
      const keys = Array.isArray(block.profileKeys) ? block.profileKeys : [];
      const maps = keys.map((key) => items.find((item) => item.profileKey === key || item.projectId === key || item.name === key)).filter(Boolean);
      const layoutClass = block.layout === 'featured' ? 'is-featured' : '';
      const modeClass = block.displayMode === 'embed' ? 'is-embed' : block.displayMode === 'open' ? 'is-open' : '';
      const cards = maps.map((item) => {
        const thumb = String(item.thumbnailUrl || '').trim();
        const launch = sanitizeUrl(item.launchUrl || '#');
        if (block.displayMode === 'embed') {
          return `<div class="portal-map-card"><div class="portal-map-card__embed"><iframe src="${escapeHtml(launch)}" loading="lazy" referrerpolicy="same-origin" allowfullscreen></iframe></div><strong>${escapeHtml(item.name || item.profileKey || '')}</strong><p>${escapeHtml(item.description || '')}</p></div>`;
        }
        if (block.displayMode === 'open') {
          return `<div class="portal-map-card portal-map-card--open"><strong>${escapeHtml(item.name || item.profileKey || '')}</strong><p>${escapeHtml(item.description || '')}</p>${mapSourceBadge(item.source)}<a class="portal-map-card__action" href="${escapeHtml(launch)}" target="_blank" rel="noreferrer">Open map ↗</a></div>`;
        }
        return `<div class="portal-map-card"><div class="portal-map-card__thumb"${thumb ? ` style="background-image:url('${escapeHtml(thumb)}')"` : ''}></div><strong>${escapeHtml(item.name || item.profileKey || '')}</strong><p>${escapeHtml(item.description || '')}</p>${mapSourceBadge(item.source)}<a class="portal-map-card__action" href="${escapeHtml(launch)}" target="_blank" rel="noreferrer">Open map ↗</a></div>`;
      }).join('');
      return `<section class="portal-section"><div class="portal-section__body"><h2>${escapeHtml(block.title || '')}</h2>${block.intro ? `<div class="portal-section__intro">${sanitizeRichHtml(block.intro)}</div>` : ''}<div class="portal-maps ${layoutClass} ${modeClass}">${cards || '<p class="help">No maps selected for this section.</p>'}</div></div></section>`;
    }
    if (type === 'social') {
      const cards = (block.items || []).map((item) => `
        <a class="portal-social-link" href="${escapeHtml(sanitizeUrl(item.url))}" target="_blank" rel="noreferrer">
          ${item.imageUrl ? `<span class="portal-social-link__image" style="background-image:url('${escapeHtml(sanitizeUrl(item.imageUrl))}')"></span>` : `<span class="portal-social-link__icon">${escapeHtml((item.title || '?').slice(0, 1).toUpperCase())}</span>`}
          <span>${item.meta ? `<small class="portal-social-link__meta">${escapeHtml(item.meta)}</small><br>` : ''}<strong>${escapeHtml(item.title || '')}</strong>${item.text ? `<br>${escapeHtml(item.text)}` : ''}</span>
        </a>`).join('');
      return `<section class="portal-section"><div class="portal-section__body"><h2>${escapeHtml(block.title || '')}</h2>${block.intro ? `<div class="portal-section__intro">${sanitizeRichHtml(block.intro)}</div>` : ''}<div class="portal-social">${cards}</div></div></section>`;
    }
    // cards
    const cards = (block.items || []).map((item) => `
      <article class="portal-card">
        ${item.imageUrl ? `<div class="portal-card__image" style="background-image:url('${escapeHtml(sanitizeUrl(item.imageUrl))}')"></div>` : ''}
        ${item.meta ? `<small class="portal-card__meta">${escapeHtml(item.meta)}</small>` : ''}
        <strong>${escapeHtml(item.title || '')}</strong>
        <p>${escapeHtml(item.text || '')}</p>
        ${item.label ? `<a class="portal-card__action" href="${escapeHtml(sanitizeUrl(item.url))}" target="_blank" rel="noreferrer">${escapeHtml(item.label)}</a>` : ''}
      </article>`).join('');
    return `<section class="portal-section"><div class="portal-section__body"><h2>${escapeHtml(block.title || '')}</h2>${block.intro ? `<div class="portal-section__intro">${sanitizeRichHtml(block.intro)}</div>` : ''}<div class="portal-cards">${cards}</div></div></section>`;
  }

  function renderPortalPage(page, items) {
    const blocks = Array.isArray(page?.blocks) ? page.blocks : [];
    if (!blocks.length) {
      return `<div class="empty-state"><h2>${escapeHtml(page?.title || '')}</h2><p>This page has no content sections yet.</p></div>`;
    }
    return `<div class="portal-page">${blocks.map((block) => renderBlock(block, items)).join('')}</div>`;
  }

  async function loadPortalContent() {
    const params = new URLSearchParams(window.location.search);
    const pathMatch = window.location.pathname.match(/\/QtilerStories\/portal\/([^/?#]+)/);
    const slug = pathMatch ? pathMatch[1] : '';
    const mode = window.location.pathname.endsWith('/maps') ? 'maps' : '';
    const qs = new URLSearchParams();
    if (slug) qs.set('slug', slug);
    if (mode) qs.set('mode', mode);
    const url = `/plugins/QtilerStories/api/portal-content${qs.toString() ? `?${qs.toString()}` : ''}`;
    const res = await fetch(url, { credentials: 'include' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }

  async function init() {
    const host = $('#portalContent');
    try {
      const data = await loadPortalContent();
      applySiteIdentity(data.site || {}, data.logoUrl || '');
      applyGdpr(data.gdpr || {});
      renderNav(data.portal || {}, data.portal?.currentPage?.slug || '');

      if (!host) return;
      const isMapsMode = window.location.pathname.endsWith('/maps');
      if (isMapsMode || !data.portal?.currentPage) {
        host.innerHTML = renderMapsGallery(Array.isArray(data.items) ? data.items : []);
      } else {
        host.innerHTML = renderPortalPage(data.portal.currentPage, Array.isArray(data.items) ? data.items : []);
      }
    } catch (err) {
      if (host) {
        host.innerHTML = `<div class="empty-state"><h2>Could not load the portal</h2><p>${escapeHtml(err?.message || String(err))}</p></div>`;
      }
    }
  }

  init();
})();
