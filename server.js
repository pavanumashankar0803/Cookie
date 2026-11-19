/*
 * Cookie Testing Playground – server (no dependencies).
 *
 * The server keeps the SITE COOKIE PROFILE: the list of cookies this website sets for
 * every visitor. Because scanners visit with a fresh browser, the profile is what a
 * scan detects. Editing/deleting cookies in the UI edits the profile, so the next scan
 * reflects the change.
 *
 *   setBy "server" → sent as Set-Cookie headers with every page load (required for HttpOnly)
 *   setBy "script" → written by the page's JavaScript with document.cookie on every page load
 */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const CTP = require('./public/cookie-data.js');

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const TRUST_PROXY = ['1', 'true'].includes(String(process.env.TRUST_PROXY || (process.env.RENDER ? '1' : '')));
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || ''; // if set, required to change the profile
const DEFAULTS_FILE = path.join(__dirname, 'site-cookies.json');
const PROFILE_FILE = process.env.PROFILE_FILE || path.join(__dirname, 'data', 'profile.json');
const MAX_ENTRIES = 150;
const PUBLIC_DIR = path.join(__dirname, 'public');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.txt': 'text/plain' };

// ------------------------------------------------------------------ profile store
function loadDefaults() {
  try {
    const list = JSON.parse(fs.readFileSync(DEFAULTS_FILE, 'utf8'));
    if (Array.isArray(list)) return list.map(CTP.normalize);
  } catch {}
  return CTP.PREDEFINED.map((d) => CTP.predefinedEntry(d));
}
function loadProfile() {
  try {
    const list = JSON.parse(fs.readFileSync(PROFILE_FILE, 'utf8'));
    if (Array.isArray(list)) return list.map(CTP.normalize);
  } catch {}
  return loadDefaults();
}
let profile = loadProfile();
function saveProfile() {
  try {
    fs.mkdirSync(path.dirname(PROFILE_FILE), { recursive: true });
    fs.writeFileSync(PROFILE_FILE + '.tmp', JSON.stringify(profile, null, 2));
    fs.renameSync(PROFILE_FILE + '.tmp', PROFILE_FILE);
  } catch (e) { console.error('Could not save profile:', e.message); }
}
if (!fs.existsSync(DEFAULTS_FILE)) fs.writeFileSync(DEFAULTS_FILE, JSON.stringify(profile, null, 2));

// ------------------------------------------------------------------ helpers
function isSecureContext(req) {
  if (req.socket.encrypted) return true;
  if (TRUST_PROXY && String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https') return true;
  const host = String(req.headers.host || '').replace(/:\d+$/, '');
  return ['localhost', '127.0.0.1', '[::1]'].includes(host) || host.endsWith('.localhost');
}
const hostname = (req) => String((TRUST_PROXY && req.headers['x-forwarded-host']) || req.headers.host || '').replace(/:\d+$/, '').toLowerCase();
function domainAllowed(domain, host) {
  if (!domain) return true;
  const d = domain.replace(/^\./, '').toLowerCase();
  return host === d || host.endsWith('.' + d);
}
function sendJSON(res, status, body, setCookies = []) {
  const headers = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' };
  if (setCookies.length) headers['Set-Cookie'] = setCookies;
  res.writeHead(status, headers);
  res.end(JSON.stringify(body));
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => { data += c; if (data.length > 1e6) { reject(new Error('Body too large')); req.destroy(); } });
    req.on('end', () => { try { resolve(data ? JSON.parse(data) : {}); } catch { reject(new Error('Invalid JSON')); } });
    req.on('error', reject);
  });
}
function authorized(req) {
  if (!ADMIN_TOKEN) return true;
  const given = Buffer.from(String(req.headers['x-admin-token'] || ''));
  const want = Buffer.from(ADMIN_TOKEN);
  return given.length === want.length && crypto.timingSafeEqual(given, want);
}

/** Set-Cookie headers for server-set profile cookies the browser doesn't have yet (or has a different value). */
function profileHeaders(req) {
  const secure = isSecureContext(req);
  const have = new Map(CTP.parseCookieHeader(req.headers.cookie).map((c) => [c.name, c.value]));
  return profile
    .filter((e) => e.setBy === 'server' && have.get(e.name) !== encodeURIComponent(e.value))
    .map((e) => CTP.serialize(CTP.effective(e, secure)));
}

// ------------------------------------------------------------------ API
async function handleApi(req, res, pathname) {
  const secure = isSecureContext(req);
  const host = hostname(req);

  if (pathname.endsWith('/api/state') && req.method === 'GET') {
    // Cookie header = everything the browser holds for this path, including HttpOnly cookies.
    return sendJSON(res, 200, {
      profile, cookies: CTP.parseCookieHeader(req.headers.cookie), secureContext: secure, host,
      adminRequired: !!ADMIN_TOKEN, persistentStorage: !!process.env.PROFILE_FILE,
    });
  }
  if (pathname.endsWith('/api/profile/export') && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Disposition': 'attachment; filename="site-cookies.json"', 'Cache-Control': 'no-store' });
    return res.end(JSON.stringify(profile, null, 2));
  }
  if (req.method !== 'POST') return sendJSON(res, 405, { error: 'Method not allowed' });
  if (!authorized(req)) return sendJSON(res, 401, { error: 'Admin token required to change the site cookie profile.' });

  let body;
  try { body = await readBody(req); } catch (e) { return sendJSON(res, 400, { error: e.message }); }
  const setCookies = [];

  if (pathname.endsWith('/api/profile/reset')) {
    const old = profile;
    profile = Array.isArray(body.entries) ? body.entries.map(CTP.normalize) : loadDefaults();
    const errs = profile.flatMap((e) => CTP.validate(e).map((m) => `${e.name}: ${m}`));
    if (errs.length) { profile = old; return sendJSON(res, 400, { error: errs.join(' ') }); }
    saveProfile();
    return sendJSON(res, 200, { ok: true, profile });
  }

  if (!pathname.endsWith('/api/profile')) return sendJSON(res, 404, { error: 'Not found' });

  // Validate everything first so a request is applied all-or-nothing.
  const upserts = (Array.isArray(body.upsert) ? body.upsert : []).map(CTP.normalize);
  const errors = [];
  for (const e of upserts) {
    const errs = CTP.validate(e);
    if (!domainAllowed(e.domain, host)) errs.push(`Domain "${e.domain}" is not "${host}" or a parent of it; browsers would reject it.`);
    if (e.secure && !secure) errs.push('Secure cookies need HTTPS (or localhost).');
    if (errs.length) errors.push(`${e.name || '(unnamed)'}: ${errs.join(' ')}`);
  }
  if (errors.length) return sendJSON(res, 400, { error: errors.join(' ') });

  // Removals: drop from the profile AND expire in this browser (works for HttpOnly too).
  for (const r of Array.isArray(body.remove) ? body.remove : []) {
    if (!r || !CTP.NAME_RE.test(String(r.name || ''))) continue;
    const entry = profile.find((e) => e.name === r.name);
    if (r.fromProfile !== false) profile = profile.filter((e) => e.name !== r.name);
    setCookies.push(CTP.serialize({ name: r.name, path: r.path || (entry && entry.path) || '/', domain: r.domain ?? (entry && entry.domain) ?? '' }, { forDelete: true }));
  }
  for (const e of upserts) {
    const i = profile.findIndex((x) => x.name === e.name);
    if (i >= 0) profile[i] = e; else profile.push(e);
    if (e.setBy === 'server') setCookies.push(CTP.serialize(CTP.effective(e, secure)));
  }
  if (profile.length > MAX_ENTRIES) { profile = loadProfile(); return sendJSON(res, 400, { error: `The site profile is limited to ${MAX_ENTRIES} cookies (browsers allow ~180 per site).` }); }
  if (upserts.length || (body.remove || []).some((r) => r.fromProfile !== false)) saveProfile();
  return sendJSON(res, 200, { ok: true, profile }, setCookies);
}

// ------------------------------------------------------------------ static
function serveStatic(req, res, pathname) {
  let urlPath = decodeURIComponent(pathname);
  const isPage = urlPath === '/' || !path.extname(urlPath) || urlPath.endsWith('.html');
  if (isPage) urlPath = '/index.html'; // every page path serves the app (lets you test Path= cookies)
  let file = path.normalize(path.join(PUBLIC_DIR, urlPath));
  if (!file.startsWith(PUBLIC_DIR)) { res.writeHead(403); return res.end('Forbidden'); }
  if (!fs.existsSync(file)) file = path.join(PUBLIC_DIR, path.basename(file)); // asset requested from a sub-path page
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('Not found'); }
    const headers = { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'X-Content-Type-Options': 'nosniff' };
    if (isPage) {
      headers['Cache-Control'] = 'no-store';
      const sc = profileHeaders(req);
      if (sc.length) headers['Set-Cookie'] = sc;
    }
    res.writeHead(200, headers);
    res.end(req.method === 'HEAD' ? undefined : data);
  });
}

http.createServer((req, res) => {
  const { pathname } = new URL(req.url, 'http://x');
  if (pathname.includes('/api/')) return handleApi(req, res, pathname).catch((e) => sendJSON(res, 500, { error: e.message }));
  if (pathname === '/healthz') return sendJSON(res, 200, { ok: true });
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); }
  serveStatic(req, res, pathname);
}).listen(PORT, HOST, () => console.log(`Cookie Testing Playground on http://localhost:${PORT} (profile: ${PROFILE_FILE})`));
