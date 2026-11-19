/*
 * Shared cookie definitions + helpers (used by the browser AND by server.js).
 * All values are synthetic. Nothing here talks to any analytics/ad service.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('crypto'));
  else root.CTP = factory(null);
})(typeof self !== 'undefined' ? self : this, function (nodeCrypto) {
  'use strict';

  const CATEGORIES = ['Necessary', 'Functional', 'Performance', 'Analytics', 'Marketing', 'Advertisement', 'Targeting', 'Uncategorized'];
  const NAME_RE = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

  const MIN = 60e3, HOUR = 60 * MIN, DAY = 24 * HOUR;
  const EXPIRY_PRESETS = {
    session: null, '30m': 30 * MIN, '1h': HOUR, '1d': DAY, '7d': 7 * DAY,
    '30d': 30 * DAY, '90d': 90 * DAY, '180d': 180 * DAY, '1y': 365 * DAY, '395d': 395 * DAY,
  };

  // ---------- random helpers ----------
  function randBytes(n) {
    if (nodeCrypto) return nodeCrypto.randomBytes(n);
    const a = new Uint8Array(n); crypto.getRandomValues(a); return a;
  }
  const hex = (n) => Array.from(randBytes(Math.ceil(n / 2)), (b) => b.toString(16).padStart(2, '0')).join('').slice(0, n);
  const digits = (n) => Array.from(randBytes(n), (b, i) => (i === 0 ? 1 + (b % 9) : b % 10)).join('');
  const b64url = (n) => {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
    return Array.from(randBytes(n), (b) => chars[b % 64]).join('');
  };
  const pick = (arr) => arr[randBytes(1)[0] % arr.length];
  const uuid = () => { const h = hex(32); return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20)}`; };
  const nowS = () => Math.floor(Date.now() / 1000);

  // ---------- predefined cookies ----------
  // flags: s = Secure, h = HttpOnly. sameSite: Strict | Lax | None | '' (browser default)
  const PREDEFINED = [
    { name: 'session_id', category: 'Necessary', expiry: 'session', flags: 'sh', sameSite: 'Lax', gen: () => hex(32) },
    { name: 'csrf_token', category: 'Necessary', expiry: 'session', flags: 's', sameSite: 'Strict', gen: () => b64url(43) },
    { name: 'auth_session', category: 'Necessary', expiry: '1d', flags: 'sh', sameSite: 'Strict',
      gen: () => `eyJhbGciOiJIUzI1NiJ9.${b64url(48)}.${b64url(43)}` },
    { name: 'consent_status', category: 'Necessary', expiry: '180d', flags: '', sameSite: 'Lax',
      gen: () => pick(['pending', 'necessary_only', 'custom', 'all_accepted']) },

    { name: 'user_language', category: 'Functional', expiry: '1y', flags: '', sameSite: 'Lax',
      gen: () => pick(['en-US', 'en-GB', 'en-IN', 'de-DE', 'fr-FR', 'es-ES', 'ja-JP', 'hi-IN']) },
    { name: 'preferred_theme', category: 'Functional', expiry: '1y', flags: '', sameSite: 'Lax', gen: () => pick(['light', 'dark', 'system']) },
    { name: 'user_region', category: 'Functional', expiry: '1y', flags: '', sameSite: 'Lax',
      gen: () => pick(['IN-KA', 'IN-MH', 'US-CA', 'US-NY', 'GB-LND', 'DE-BE', 'SG-01']) },
    { name: 'display_settings', category: 'Functional', expiry: '1y', flags: '', sameSite: 'Lax',
      gen: () => `${pick(['compact', 'comfortable', 'spacious'])}.${pick([12, 14, 16, 18])}.${pick(['grid', 'list'])}` },

    { name: '_ga', category: 'Analytics', expiry: '395d', flags: '', sameSite: '', gen: () => `GA1.1.${digits(10)}.${nowS()}` },
    { name: '_gid', category: 'Analytics', expiry: '1d', flags: '', sameSite: '', gen: () => `GA1.1.${digits(9)}.${nowS()}` },
    { name: 'amplitude_id', category: 'Analytics', expiry: '1y', flags: '', sameSite: 'Lax', gen: () => uuid() },
    { name: 'analytics_session', category: 'Analytics', expiry: '30m', flags: '', sameSite: 'Lax', gen: () => `${nowS()}.${hex(12)}` },

    { name: '_fbp', category: 'Advertisement', expiry: '90d', flags: '', sameSite: 'Lax', gen: () => `fb.1.${Date.now()}.${digits(10)}` },
    { name: '_gcl_au', category: 'Advertisement', expiry: '90d', flags: '', sameSite: 'Lax', gen: () => `1.1.${digits(10)}.${nowS()}` },
    { name: 'ad_tracking_id', category: 'Advertisement', expiry: '30d', flags: 's', sameSite: 'None', gen: () => `adt_${hex(24)}` },
    { name: 'campaign_tracker', category: 'Advertisement', expiry: '7d', flags: '', sameSite: 'Lax',
      gen: () => `${pick(['newsletter', 'google', 'linkedin', 'partner'])}.${pick(['spring_sale', 'q4_launch', 'retarget_v2'])}.${pick(['cpc', 'email', 'social'])}` },

    { name: 'perf_page_load', category: 'Performance', expiry: '1d', flags: '', sameSite: 'Lax', gen: () => `${200 + (randBytes(1)[0] * 8)}ms.${pick(['fast', 'avg', 'slow'])}` },
    { name: '_dd_s', category: 'Performance', expiry: '30m', flags: '', sameSite: 'Strict', gen: () => `rum=1&id=${uuid()}&created=${Date.now()}` },
    { name: 'rum_session', category: 'Performance', expiry: 'session', flags: '', sameSite: 'Lax', gen: () => hex(20) },
    { name: 'cdn_pop', category: 'Performance', expiry: '7d', flags: 's', sameSite: 'Lax', gen: () => pick(['BOM', 'MAA', 'BLR', 'SIN', 'FRA', 'IAD']) + '-' + digits(2) },

    { name: 'hubspotutk', category: 'Marketing', expiry: '180d', flags: '', sameSite: 'Lax', gen: () => hex(32) },
    { name: '_mkto_trk', category: 'Marketing', expiry: '1y', flags: '', sameSite: 'Lax', gen: () => `id:${digits(3)}-ABC-${digits(3)}&token:_mch-example.test-${Date.now()}-${digits(5)}` },
    { name: 'mkt_campaign_ref', category: 'Marketing', expiry: '30d', flags: '', sameSite: 'Lax', gen: () => `${pick(['webinar', 'ebook', 'newsletter', 'event'])}_${pick(['2026q4', 'launch', 'nurture'])}` },
    { name: 'email_optin_source', category: 'Marketing', expiry: '90d', flags: '', sameSite: 'Lax', gen: () => pick(['footer_form', 'popup', 'checkout', 'blog_cta']) },

    { name: 'IDE', category: 'Targeting', expiry: '1y', flags: 's', sameSite: 'None', gen: () => `AHWqTU${b64url(40)}` },
    { name: '_ttp', category: 'Targeting', expiry: '1y', flags: '', sameSite: 'Lax', gen: () => b64url(27) },
    { name: 'personalization_id', category: 'Targeting', expiry: '1y', flags: 's', sameSite: 'None', gen: () => `v1_${b64url(22)}==` },
    { name: 'audience_segment', category: 'Targeting', expiry: '30d', flags: '', sameSite: 'Lax', gen: () => pick(['tech_buyers', 'privacy_pros', 'smb_owners', 'returning_visitors']) },

    { name: 'random_tracker', category: 'Uncategorized', expiry: 'session', flags: '', sameSite: '', gen: () => hex(16) },
    { name: 'visitor_identifier', category: 'Uncategorized', expiry: '1y', flags: '', sameSite: 'Lax', gen: () => uuid() },
    { name: 'custom_tracking_id', category: 'Uncategorized', expiry: '30d', flags: 'sh', sameSite: 'None', gen: () => `ctid-${Date.now().toString(36)}-${hex(8)}` },
  ];

  const NAME_PREFIX = {
    Necessary: ['sess_', 'xsrf_', 'auth_', 'lb_route_'],
    Functional: ['pref_', 'ui_', 'locale_', 'fn_'],
    Analytics: ['_an_', 'stat_', 'metrics_', '_pk_id_'],
    Advertisement: ['_ad_', 'retarget_', 'pixel_', 'adsrv_'],
    Performance: ['perf_', 'rum_', 'lat_', 'cdn_'],
    Marketing: ['mkt_', 'lead_', 'promo_', 'crm_'],
    Targeting: ['tgt_', 'seg_', 'aud_', 'persona_'],
    Uncategorized: ['trk_', 'vid_', 'misc_', 'tmp_'],
  };
  const randomName = (category) => pick(NAME_PREFIX[category] || NAME_PREFIX.Uncategorized) + hex(6);
  function randomValue(name) {
    const def = PREDEFINED.find((d) => d.name === name);
    return def ? def.gen() : pick([() => hex(24), () => uuid(), () => b64url(32), () => `${nowS()}.${digits(8)}`])();
  }

  // ---------- cookie string helpers ----------
  function parseCookieHeader(str) {
    const out = [];
    if (!str) return out;
    for (const part of str.split(/;\s*/)) {
      if (!part) continue;
      const i = part.indexOf('=');
      const name = i < 0 ? '' : part.slice(0, i).trim();
      const value = i < 0 ? part : part.slice(i + 1);
      if (name || value) out.push({ name: name || value, value: i < 0 ? '' : value });
    }
    return out;
  }
  function safeDecode(v) { try { return decodeURIComponent(v); } catch { return v; } }

  /** Build the "name=value; attrs" string. Same format for document.cookie and Set-Cookie. */
  function serialize(c, { forDelete = false } = {}) {
    const parts = [`${c.name}=${forDelete ? '' : encodeURIComponent(c.value ?? '')}`];
    parts.push(`Path=${c.path || '/'}`);
    if (c.domain) parts.push(`Domain=${c.domain}`);
    if (forDelete) parts.push('Expires=Thu, 01 Jan 1970 00:00:00 GMT', 'Max-Age=0');
    else if (c.maxAge != null) parts.push(`Expires=${new Date(Date.now() + c.maxAge * 1000).toUTCString()}`, `Max-Age=${c.maxAge}`);
    else if (c.expires) parts.push(`Expires=${new Date(c.expires).toUTCString()}`);
    if (c.secure) parts.push('Secure');
    if (c.httpOnly) parts.push('HttpOnly');
    if (c.sameSite) parts.push(`SameSite=${c.sameSite}`);
    return parts.join('; ');
  }

  /** Validation shared by client and server. Returns array of error strings. */
  function validate(c, { secureContext = true } = {}) {
    const errs = [];
    if (!c.name || !NAME_RE.test(c.name)) errs.push('Cookie name is required and may only contain letters, digits and !#$%&\'*+-.^_`|~ (no spaces, = ; , or quotes).');
    if (c.sameSite && !['Strict', 'Lax', 'None'].includes(c.sameSite)) errs.push('SameSite must be Strict, Lax or None.');
    if (c.sameSite === 'None' && !c.secure) errs.push('SameSite=None requires the Secure attribute (browsers reject it otherwise).');
    if (c.secure && !secureContext) errs.push('Secure cookies can only be set over HTTPS (or on localhost).');
    if (c.path && !c.path.startsWith('/')) errs.push('Path must start with "/".');
    if (c.name.startsWith('__Host-') && (!c.secure || c.domain || (c.path || '/') !== '/')) errs.push('__Host- cookies require Secure, Path=/ and no Domain.');
    if (c.name.startsWith('__Secure-') && !c.secure) errs.push('__Secure- cookies require Secure.');
    if (c.maxAge != null && (!Number.isFinite(c.maxAge) || c.maxAge <= 0)) errs.push('Expiration must be in the future.');
    if (c.setBy && !['server', 'script'].includes(c.setBy)) errs.push('Set by must be server or script.');
    if (c.httpOnly && c.setBy === 'script') errs.push('HttpOnly cookies can only be set by the server.');
    if (c.maxAge != null && c.maxAge * 1000 > 400 * DAY) errs.push('Browsers cap cookie lifetime at 400 days; pick an earlier expiration.');
    if (!CATEGORIES.includes(c.category)) errs.push('Unknown category.');
    if (encodeURIComponent(c.value ?? '').length + (c.name || '').length > 4000) errs.push('Cookie is larger than the ~4 KB browser limit.');
    return errs;
  }

  const presetToMaxAge = (preset) => (EXPIRY_PRESETS[preset] == null ? null : Math.round(EXPIRY_PRESETS[preset] / 1000));

  /** Profile entry (what the SITE sets for every visitor) from a predefined definition. */
  function predefinedEntry(def, { expiryPreset } = {}) {
    const httpOnly = def.flags.includes('h');
    return {
      name: def.name, value: def.gen(), category: def.category,
      maxAge: presetToMaxAge(expiryPreset && expiryPreset !== 'default' ? expiryPreset : def.expiry),
      secure: def.flags.includes('s'), httpOnly, sameSite: def.sameSite, domain: '', path: '/',
      // Realistic: necessary/HttpOnly cookies come from the server, tracking cookies from scripts.
      setBy: httpOnly || def.category === 'Necessary' ? 'server' : 'script',
    };
  }

  /** Attributes actually usable in this context (Secure needs HTTPS, except localhost). */
  function effective(entry, secureContext) {
    if (secureContext) return entry;
    return { ...entry, secure: false, sameSite: entry.sameSite === 'None' ? 'Lax' : entry.sameSite };
  }

  /** Normalise untrusted input into a profile entry. */
  function normalize(c) {
    return {
      name: String(c.name || '').trim(), value: String(c.value ?? ''), category: c.category || 'Uncategorized',
      maxAge: c.maxAge == null || c.maxAge === '' ? null : Math.round(Number(c.maxAge)),
      secure: !!c.secure, httpOnly: !!c.httpOnly, sameSite: c.sameSite || '',
      domain: String(c.domain || '').trim(), path: String(c.path || '/').trim() || '/',
      setBy: c.httpOnly ? 'server' : c.setBy === 'script' ? 'script' : 'server',
    };
  }

  return {
    CATEGORIES, PREDEFINED, EXPIRY_PRESETS, NAME_RE,
    randomName, randomValue, presetToMaxAge, parseCookieHeader, safeDecode, serialize, validate,
    predefinedEntry, effective, normalize,
  };
});
