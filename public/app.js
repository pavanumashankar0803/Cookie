/* Cookie Testing Playground – frontend.
 *
 * Two things are shown side by side:
 *   1. The SITE COOKIE PROFILE (server) – what this website sets for every visitor / scanner.
 *   2. Your BROWSER's real cookie jar – read from the request Cookie header (incl. HttpOnly),
 *      document.cookie, and the Cookie Store API for live attributes where supported.
 * Every add / edit / delete changes both: the profile (so the next scan reflects it) and
 * your browser's actual cookies (so you can verify it in DevTools right away).
 */
(() => {
  'use strict';
  const { CATEGORIES, PREDEFINED } = CTP;
  const BASE = document.currentScript ? document.currentScript.src : location.href;
  const api = (p) => new URL(`api/${p}`, BASE).href;
  const $ = (id) => document.getElementById(id);
  const host = location.hostname;
  const secureCtx = window.isSecureContext;

  let state = { profile: [], cookies: [], adminRequired: false, persistentStorage: false };
  let backendOk = true;
  let rows = [];
  let busy = false;
  let editing = null;
  let adminToken = '';

  // ---------------------------------------------------------------- utils
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  function toast(msg, type = 'success') {
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.textContent = msg;
    $('toasts').appendChild(el);
    while ($('toasts').children.length > 4) $('toasts').firstChild.remove();
    setTimeout(() => el.remove(), type === 'error' ? 9000 : 5000);
  }
  const rel = (ms) => { const a = Math.abs(ms); return a < 3600e3 ? `${Math.round(a / 60e3)} min` : a < 864e5 ? `${Math.round(a / 3600e3)} h` : `${Math.round(a / 864e5)} days`; };
  const fmtAbs = (ms) => `${new Date(ms).toLocaleString()} <span class="muted">(in ${rel(ms - Date.now())})</span>`;
  const fmtMaxAge = (s) => (s == null ? 'Session' : `${rel(s * 1000)} after visit`);
  const jsCookies = () => CTP.parseCookieHeader(document.cookie);
  const jsValue = (name) => { const c = jsCookies().find((x) => x.name === name); return c ? CTP.safeDecode(c.value) : undefined; };
  const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1).toLowerCase() : '');

  // ------------------------------------------------------------ read state
  async function loadState() {
    try {
      const r = await fetch(api('state'), { cache: 'no-store', credentials: 'same-origin' });
      if (!r.ok) throw new Error(r.status);
      state = await r.json();
      backendOk = true;
    } catch {
      backendOk = false;
      state = { ...state, cookies: jsCookies() };
    }
    $('backend-warning').hidden = backendOk;

    let live = {};
    if ('cookieStore' in window) {
      try { for (const c of await cookieStore.getAll()) if (!(c.name in live)) live[c.name] = c; } catch { live = {}; }
    }
    const jsNames = new Set(jsCookies().map((c) => c.name));
    const browser = new Map();
    for (const c of state.cookies) if (!browser.has(c.name)) browser.set(c.name, CTP.safeDecode(c.value));

    const out = [];
    for (const e of state.profile) {
      const scoped = e.path !== '/';
      const present = browser.has(e.name);
      const lv = live[e.name];
      out.push({
        ...e, inProfile: true, scoped, present,
        browserValue: present ? browser.get(e.name) : undefined,
        actualHttpOnly: present ? !jsNames.has(e.name) : undefined,
        liveExpires: lv ? lv.expires || null : undefined, live: !!lv,
      });
    }
    for (const [name, value] of browser) {
      if (state.profile.some((e) => e.name === name)) continue;
      const lv = live[name];
      out.push({
        name, value, browserValue: value, category: guessCategory(name), inProfile: false, external: true, present: true,
        actualHttpOnly: !jsNames.has(name), httpOnly: !jsNames.has(name), live: !!lv,
        domain: lv ? lv.domain || '' : undefined, path: lv ? lv.path || '/' : undefined,
        liveExpires: lv ? lv.expires || null : undefined, secure: lv ? !!lv.secure : undefined,
        sameSite: lv ? cap(lv.sameSite) : undefined, setBy: undefined,
      });
    }
    rows = out.sort((a, b) => CATEGORIES.indexOf(a.category) - CATEGORIES.indexOf(b.category) || a.name.localeCompare(b.name));
  }
  function guessCategory(name) { const d = PREDEFINED.find((x) => x.name === name); return d ? d.category : 'Uncategorized'; }

  async function refresh(showToast = false) {
    try { await loadState(); render(); if (showToast) toast(`Read ${rows.filter((r) => r.present).length} cookies from browser storage.`); }
    catch (e) { toast(`Refresh failed: ${e.message}`, 'error'); }
  }

  /** The page's own scripts set the profile's script-set cookies (like real analytics/ad tags do). */
  function applyScriptCookies(entries = state.profile) {
    for (const e of entries) {
      if (e.setBy !== 'script') continue;
      if (e.path === '/' && jsValue(e.name) === e.value) continue;
      document.cookie = CTP.serialize(CTP.effective(e, secureCtx));
    }
  }

  // ------------------------------------------------------------- mutations
  async function post(pathName, body) {
    if (!backendOk) throw new Error('Server not reachable: the site profile cannot be changed.');
    for (let attempt = 0; attempt < 2; attempt++) {
      const r = await fetch(api(pathName), {
        method: 'POST', credentials: 'same-origin', cache: 'no-store',
        headers: { 'Content-Type': 'application/json', ...(adminToken ? { 'X-Admin-Token': adminToken } : {}) },
        body: JSON.stringify(body),
      });
      const j = await r.json().catch(() => ({}));
      if (r.status === 401 && attempt === 0) {
        const t = prompt('This site is protected. Enter the admin token (ADMIN_TOKEN) to change cookies:');
        if (!t) throw new Error('Admin token required.');
        adminToken = t.trim();
        continue;
      }
      if (!r.ok) throw new Error(j.error || `Server error ${r.status}`);
      return j;
    }
  }
  function jsDelete(c) {
    const domains = [c.domain || ''];
    const parts = host.split('.');
    for (let i = 0; i < parts.length - 1; i++) domains.push(parts.slice(i).join('.'));
    for (const d of [...new Set(domains)]) {
      document.cookie = CTP.serialize({ name: c.name, path: c.path || '/', domain: d }, { forDelete: true });
      if (jsValue(c.name) === undefined) break;
    }
  }
  function clientChecks(e) {
    const errs = CTP.validate(e);
    if (e.secure && !secureCtx) errs.push('Secure cookies need HTTPS (or localhost).');
    if (e.domain) {
      const d = e.domain.replace(/^\./, '').toLowerCase();
      if (!(host === d || host.endsWith('.' + d))) errs.push(`Domain must be "${host}" or a parent domain.`);
    }
    return errs;
  }

  /** Create/update profile entries + browser cookies, then verify against browser storage. */
  async function save(entries, removes = []) {
    entries = entries.map(CTP.normalize);
    for (const e of entries) { const errs = clientChecks(e); if (errs.length) throw new Error(`${e.name || '(unnamed)'}: ${errs.join(' ')}`); }
    if (backendOk) await post('profile', { upsert: entries, remove: removes }); // server-set cookies arrive via Set-Cookie
    else {
      if (entries.some((e) => e.setBy === 'server')) throw new Error('No server available (static hosting): only script-set, non-HttpOnly cookies are possible.');
      const names = new Set(removes.filter((r) => r.fromProfile).map((r) => r.name));
      state.profile = state.profile.filter((p) => !names.has(p.name) && !entries.some((e) => e.name === p.name)).concat(entries);
    }
    for (const r of removes) jsDelete(r);
    applyScriptCookies(entries);                                       // script-set cookies via document.cookie
    await loadState();
    const failures = [];
    for (const e of entries) {
      if (e.path !== '/') continue; // not observable from this page
      const row = rows.find((r) => r.name === e.name);
      if (!row || !row.present) failures.push(`"${e.name}" is in the site profile but was NOT stored in your browser (rejected by the browser or blocked by a cookie manager).`);
      else if (row.browserValue !== e.value) failures.push(`"${e.name}" has a different value in your browser (possibly blocked or overridden).`);
    }
    render();
    return failures;
  }

  async function removeRows(list) {
    const removes = list.map((r) => ({ name: r.name, path: r.path || '/', domain: r.domain || '', fromProfile: r.inProfile }));
    if (backendOk && (removes.some((r) => r.fromProfile) || list.some((r) => r.actualHttpOnly))) await post('profile', { remove: removes });
    if (!backendOk) state.profile = state.profile.filter((p) => !list.some((r) => r.inProfile && r.name === p.name));
    for (const r of list) jsDelete(r);
    await loadState();
    render();
    return list.filter((r) => !r.scoped && rows.some((x) => x.name === r.name && x.present)).map((r) => r.name);
  }

  // --------------------------------------------------------------- render
  function render() {
    const inBrowser = rows.filter((r) => r.present);
    $('c-total').textContent = inBrowser.length;
    for (const c of CATEGORIES) $(`c-${c}`).textContent = inBrowser.filter((r) => r.category === c).length;
    const isSession = (r) => (r.live ? r.liveExpires === null : r.maxAge === null);
    const isPersistent = (r) => (r.live ? typeof r.liveExpires === 'number' : typeof r.maxAge === 'number');
    $('c-session').textContent = inBrowser.filter(isSession).length;
    $('c-persistent').textContent = inBrowser.filter(isPersistent).length;

    const q = $('search').value.trim().toLowerCase();
    const fc = $('filter-category').value;
    const ft = $('filter-type').value;
    const visible = rows.filter((r) =>
      (!q || r.name.toLowerCase().includes(q) || String(r.value ?? '').toLowerCase().includes(q)) &&
      (!fc || r.category === fc) && (!ft || (ft === 'session' ? isSession(r) : isPersistent(r))));

    const unknown = '<span class="muted" title="Not created by this site; the browser does not expose this attribute">unknown</span>';
    const yes = (b) => (b === undefined ? unknown : b ? '<span class="yes">✓ Yes</span>' : '<span class="no">No</span>');

    $('cookie-rows').innerHTML = visible.map((r) => {
      const idx = rows.indexOf(r);
      const tags = [];
      if (r.inProfile) tags.push(`<span class="tag ${r.setBy}" title="${r.setBy === 'server' ? 'Sent as a Set-Cookie header on every page load' : 'Written by page JavaScript (document.cookie) on every page load'}">${r.setBy === 'server' ? 'server' : 'script'}</span>`);
      if (r.external) tags.push('<span class="tag ext" title="Not part of this site\'s cookie profile (e.g. set by a Cookie Manager SDK)">external</span>');
      if (r.scoped) tags.push('<span class="tag scoped">scoped</span>');
      else if (r.inProfile && !r.present) tags.push('<span class="tag missing" title="In the site profile but not in your browser: blocked by a cookie manager or rejected by the browser">not in browser</span>');
      else if (r.inProfile && r.browserValue !== r.value) tags.push('<span class="tag missing">value differs</span>');

      const value = r.scoped ? `<code class="val">${esc(r.value)}</code><div class="muted small">only sent on Path=${esc(r.path)}</div>`
        : `<code class="val" title="${esc(r.present ? r.browserValue : r.value)}">${esc(r.present ? r.browserValue : r.value) || '<span class="muted">(empty)</span>'}</code>`;
      const exp = r.live ? (r.liveExpires ? fmtAbs(r.liveExpires) : 'Session') + ' <span class="tag live">live</span>'
        : r.inProfile ? `<span class="recorded">${fmtMaxAge(r.maxAge)}</span>` : unknown;
      return `<tr class="${r.scoped ? 'scoped-row' : r.inProfile && !r.present ? 'missing-row' : ''}">
        <td><b class="mono">${esc(r.name)}</b>${r.httpOnly ? ' 🔒' : ''}<div>${tags.join('')}</div></td>
        <td>${value}</td>
        <td><span class="badge cat-${r.category}">${r.category}</span></td>
        <td>${r.domain === undefined ? unknown : r.domain ? esc(r.domain) : `<span class="muted" title="Host-only cookie (no Domain attribute)">${esc(host)}</span>`}</td>
        <td>${r.path === undefined ? unknown : esc(r.path)}</td>
        <td class="exp">${exp}</td>
        <td>${yes(r.secure)}</td>
        <td>${yes(r.httpOnly)}</td>
        <td>${r.sameSite === undefined ? unknown : esc(r.sameSite || 'Not set')}</td>
        <td class="nowrap">
          <button class="btn sm" data-edit="${idx}">Edit</button>
          <button class="btn sm danger" data-del="${idx}">Delete</button>
        </td></tr>`;
    }).join('');
    $('empty').hidden = visible.length > 0;
    renderEnv();
  }

  function renderEnv() {
    $('env-info').innerHTML = [
      `<span class="pill">${esc(host)}</span>`,
      secureCtx ? '<span class="pill ok">HTTPS</span>' : '<span class="pill bad" title="Secure / SameSite=None cookies unavailable">Not HTTPS</span>',
      backendOk ? `<span class="pill ok">Site profile: ${state.profile.length} cookies</span>` : '<span class="pill bad">Server offline</span>',
      backendOk && !state.persistentStorage ? '<span class="pill warn" title="The server has no persistent disk configured (PROFILE_FILE). Changes are lost when the server restarts. Use Export and commit site-cookies.json to keep them.">Profile resets on restart</span>' : '',
      state.adminRequired ? '<span class="pill">🔑 Protected</span>' : '',
    ].join('');
  }

  // ----------------------------------------------------------------- form
  function fillSelects() {
    const opts = CATEGORIES.map((c) => `<option>${c}</option>`).join('');
    $('f-category').innerHTML = opts;
    $('g-category').innerHTML = opts + '<option value="Mixed">Mixed (random)</option>';
    $('filter-category').innerHTML = '<option value="">All categories</option>' + opts;
  }
  const toLocalInput = (ms) => new Date(ms - new Date(ms).getTimezoneOffset() * 60e3).toISOString().slice(0, 16);
  function formEntry() {
    const preset = $('f-exp-preset').value;
    let maxAge;
    if (preset === 'custom') {
      const v = $('f-exp-custom').value;
      if (!v) throw new Error('Choose a custom expiration date/time.');
      maxAge = Math.round((new Date(v).getTime() - Date.now()) / 1000);
    } else maxAge = CTP.presetToMaxAge(preset);
    const name = $('f-name').value.trim();
    const httpOnly = $('f-httponly').checked;
    return {
      name, value: $('f-value').value === '' ? CTP.randomValue(name) : $('f-value').value,
      category: $('f-category').value, maxAge, secure: $('f-secure').checked, httpOnly,
      sameSite: $('f-samesite').value, domain: $('f-domain').value.trim(), path: $('f-path').value.trim() || '/',
      setBy: httpOnly ? 'server' : $('f-setby').value,
    };
  }
  function resetForm() {
    $('cookie-form').reset();
    editing = null;
    $('f-path').value = '/';
    $('f-exp-custom-wrap').hidden = true;
    $('form-title').textContent = 'Add Cookie';
    $('f-submit').textContent = 'Add Cookie';
    $('f-cancel').hidden = true;
    updateHints();
  }
  function startEdit(r) {
    editing = { ...r };
    $('f-name').value = r.name;
    $('f-value').value = r.present ? r.browserValue : r.value;
    $('f-category').value = r.category;
    const maxAge = r.inProfile ? r.maxAge : r.liveExpires ? Math.round((r.liveExpires - Date.now()) / 1000) : null;
    const preset = Object.keys(CTP.EXPIRY_PRESETS).find((k) => CTP.presetToMaxAge(k) === maxAge && [...$('f-exp-preset').options].some((o) => o.value === k));
    if (preset) { $('f-exp-preset').value = preset; $('f-exp-custom-wrap').hidden = true; }
    else { $('f-exp-preset').value = 'custom'; $('f-exp-custom').value = toLocalInput(Date.now() + maxAge * 1000); $('f-exp-custom-wrap').hidden = false; }
    $('f-domain').value = r.domain || '';
    $('f-path').value = r.path || '/';
    $('f-secure').checked = !!r.secure;
    $('f-httponly').checked = !!r.httpOnly;
    $('f-samesite').value = r.sameSite || '';
    $('f-setby').value = r.setBy || (r.httpOnly ? 'server' : 'script');
    $('form-title').textContent = `Edit Cookie: ${r.name}`;
    $('f-submit').textContent = 'Save Changes';
    $('f-cancel').hidden = false;
    updateHints();
    $('cookie-form').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  function hintsFor(secure, httpOnly, sameSite, setBy) {
    const h = [];
    if (httpOnly) h.push('🔒 HttpOnly: set by the server with Set-Cookie. JavaScript cannot read, change or delete it.');
    else if (setBy === 'script') h.push('Set by page JavaScript (document.cookie) on every page load. A cookie manager can block it.');
    else h.push('Set by the server (Set-Cookie header) on every page load.');
    if (secure && !secureCtx) h.push('⚠ Secure needs HTTPS.');
    if (sameSite === 'None' && !secure) h.push('⚠ SameSite=None needs Secure.');
    return h.join(' ');
  }
  function updateHints() {
    $('f-setby').disabled = $('f-httponly').checked;
    if ($('f-httponly').checked) $('f-setby').value = 'server';
    $('g-setby').disabled = $('g-httponly').checked;
    if ($('g-httponly').checked) $('g-setby').value = 'server';
    $('f-hint').textContent = hintsFor($('f-secure').checked, $('f-httponly').checked, $('f-samesite').value, $('f-setby').value);
    const mode = $('g-mode').value;
    const predefined = mode === 'category' || mode === 'all';
    $('g-category-wrap').hidden = mode === 'all';
    $('g-one-wrap').hidden = mode !== 'one';
    $('g-count-wrap').hidden = mode !== 'many';
    $('g-attr-wrap').hidden = predefined;
    $('g-setby-wrap').hidden = predefined;
    $('g-exp-default').hidden = !predefined;
    if ($('g-exp').value === 'default' && !predefined) $('g-exp').value = '30d';
    $('g-hint').textContent = predefined
      ? 'Predefined cookies use realistic default attributes (necessary = server-set, tracking = script-set) and fresh random values.'
      : hintsFor($('g-secure').checked, $('g-httponly').checked, $('g-samesite').value, $('g-setby').value);
    [...$('g-category').options].forEach((o) => { if (o.value === 'Mixed') o.hidden = mode !== 'many'; });
    if (mode !== 'many' && $('g-category').value === 'Mixed') $('g-category').value = 'Necessary';
  }

  async function withBusy(fn) {
    if (busy) return;
    busy = true;
    document.body.classList.add('busy');
    try { await fn(); } catch (e) { toast(e.message, 'error'); await refresh(); } finally { busy = false; document.body.classList.remove('busy'); }
  }

  // ------------------------------------------------------------ handlers
  $('cookie-form').addEventListener('submit', (e) => {
    e.preventDefault();
    withBusy(async () => {
      const entry = formEntry();
      const original = editing;
      if (!original && rows.some((r) => r.name === entry.name) && !confirm(`A cookie named "${entry.name}" already exists. Overwrite it?`)) return;
      const removes = [];
      if (original) {
        const renamed = original.name !== entry.name;
        const moved = (original.path || '/') !== entry.path || (original.domain || '') !== entry.domain;
        const leavingHttpOnly = original.actualHttpOnly && !entry.httpOnly; // JS can't overwrite an HttpOnly cookie
        if (renamed) removes.push({ name: original.name, path: original.path || '/', domain: original.domain || '', fromProfile: true });
        else if (moved || leavingHttpOnly) removes.push({ name: original.name, path: original.path || '/', domain: original.domain || '', fromProfile: false });
      }
      const failures = await save([entry], removes);
      failures.forEach((f) => toast(f, 'error'));
      if (!failures.length) {
        toast(original ? `"${entry.name}" updated in your browser and in the site profile.` : `"${entry.name}" added to your browser and the site profile.`);
        resetForm();
      }
    });
  });
  $('f-cancel').addEventListener('click', resetForm);
  $('f-random').addEventListener('click', () => { $('f-value').value = CTP.randomValue($('f-name').value.trim()); });
  $('f-exp-preset').addEventListener('change', () => {
    $('f-exp-custom-wrap').hidden = $('f-exp-preset').value !== 'custom';
    if (!$('f-exp-custom').value) $('f-exp-custom').value = toLocalInput(Date.now() + 864e5);
  });
  ['f-secure', 'f-httponly', 'f-samesite', 'f-setby', 'g-secure', 'g-httponly', 'g-samesite', 'g-setby', 'g-mode'].forEach((id) => $(id).addEventListener('change', updateHints));

  $('gen-form').addEventListener('submit', (e) => {
    e.preventDefault();
    withBusy(async () => {
      const mode = $('g-mode').value;
      const exp = $('g-exp').value;
      let entries = [];
      if (mode === 'all' || mode === 'category') {
        const defs = mode === 'all' ? PREDEFINED : PREDEFINED.filter((d) => d.category === $('g-category').value);
        entries = defs.map((d) => CTP.predefinedEntry(d, { expiryPreset: exp }));
        if (!secureCtx) entries = entries.map((x) => CTP.effective(x, false));
      } else {
        const count = mode === 'one' ? 1 : Math.max(1, Math.min(50, parseInt($('g-count').value, 10) || 1));
        const used = new Set(rows.map((r) => r.name));
        for (let i = 0; i < count; i++) {
          const cat = $('g-category').value === 'Mixed' ? CATEGORIES[Math.floor(Math.random() * CATEGORIES.length)] : $('g-category').value;
          let name = mode === 'one' && $('g-name').value.trim() ? $('g-name').value.trim() : CTP.randomName(cat);
          while (mode === 'many' && used.has(name)) name = CTP.randomName(cat);
          used.add(name);
          entries.push({
            name, value: mode === 'one' && $('g-value').value !== '' ? $('g-value').value : CTP.randomValue(name),
            category: cat, maxAge: CTP.presetToMaxAge(exp === 'default' ? '30d' : exp),
            secure: $('g-secure').checked, httpOnly: $('g-httponly').checked, sameSite: $('g-samesite').value,
            domain: '', path: '/', setBy: $('g-httponly').checked ? 'server' : $('g-setby').value,
          });
        }
      }
      const failures = await save(entries);
      failures.forEach((f) => toast(f, 'error'));
      const ok = entries.length - failures.length;
      if (ok) toast(`Generated ${ok} cookie${ok === 1 ? '' : 's'} in your browser and the site profile.`);
    });
  });

  $('cookie-rows').addEventListener('click', (e) => {
    const editBtn = e.target.closest('[data-edit]');
    const delBtn = e.target.closest('[data-del]');
    if (editBtn) startEdit(rows[Number(editBtn.dataset.edit)]);
    if (delBtn) {
      const r = rows[Number(delBtn.dataset.del)];
      withBusy(async () => {
        const left = await removeRows([r]);
        if (left.length) toast(`"${r.name}" is still in your browser (it may belong to another domain/path).`, 'error');
        else toast(r.inProfile ? `"${r.name}" deleted from your browser and removed from the site profile.` : `"${r.name}" deleted from your browser.`);
        if (editing && editing.name === r.name) resetForm();
      });
    }
  });

  $('btn-refresh').addEventListener('click', () => refresh(true));
  ['search', 'filter-category', 'filter-type'].forEach((id) => $(id).addEventListener('input', render));

  $('btn-delete-all').addEventListener('click', () => { $('confirm-external').checked = false; $('confirm-dialog').showModal(); });
  $('confirm-dialog').addEventListener('close', () => {
    if ($('confirm-dialog').returnValue !== 'ok') return;
    withBusy(async () => {
      await loadState();
      const target = rows.filter((r) => r.inProfile || $('confirm-external').checked);
      if (!target.length) return toast('No cookies to delete.', 'warn');
      const left = await removeRows(target);
      if (left.length) toast(`Could not delete from your browser: ${left.join(', ')}`, 'error');
      toast(`Deleted ${target.length - left.length} cookie(s). The site now sets ${state.profile.length} cookies for visitors.`);
    });
  });

  $('btn-reset').addEventListener('click', () => {
    if (!confirm('Reset the site cookie profile to the default cookies from site-cookies.json? Cookies you added will be removed from the site.')) return;
    withBusy(async () => {
      const old = state.profile;
      const j = await post('profile/reset', {});
      const keep = new Set(j.profile.map((e) => e.name));
      const gone = old.filter((e) => !keep.has(e.name)).map((e) => ({ name: e.name, path: e.path, domain: e.domain, fromProfile: false }));
      if (gone.length) { await post('profile', { remove: gone }); gone.forEach(jsDelete); }
      location.reload(); // a fresh page load applies the profile exactly like a new visitor/scanner gets it
    });
  });
  $('btn-export').addEventListener('click', () => { location.href = api('profile/export'); });

    window.addEventListener('saveCookies', (ev) => {
    console.log('[cookie-banner] saveCookies', ev.detail);
    toast('Cookie banner: consent saved', 'warn');
    setTimeout(() => refresh(), 500);
  });
  window.addEventListener('deleteAllCookies', () => {
    toast('Cookie banner: all cookies rejected', 'warn');
    setTimeout(() => refresh(), 500);
  });

  // Stay in sync with changes made outside the app (cookie manager SDK, DevTools…).
  window.addEventListener('focus', () => !busy && refresh());
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && !busy && refresh());
  if ('cookieStore' in window) { let t; cookieStore.addEventListener('change', () => { clearTimeout(t); t = setTimeout(() => !busy && refresh(), 300); }); }
  setInterval(() => { if (!busy && document.visibilityState === 'visible') refresh(); }, 5000);

  // ------------------------------------------------------------------ init
  (async () => {
    fillSelects();
    updateHints();
    await loadState();
    if (backendOk) applyScriptCookies();
    else {
      // Static hosting fallback (e.g. GitHub Pages): no server, so only script cookies from the defaults.
      const defaults = PREDEFINED.filter((d) => !d.flags.includes('h')).map((d) => CTP.effective({ ...CTP.predefinedEntry(d), setBy: 'script' }, secureCtx));
      state.profile = defaults;
      applyScriptCookies(defaults);
    }
    await loadState().catch(() => {});
    render();
  })();
})();
