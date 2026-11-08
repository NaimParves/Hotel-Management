/* Local server for the Everest Check-in Board.
 * - Serves index.html on http://localhost:3000
 * - POST /api/scrape logs into Everest with the given credentials in a hidden
 *   Chromium window, opens each hotel's planning page, runs everest-scrape.js
 *   there, and returns the scraped grids to the board.
 * Credentials are only used for this one request; they are never written to disk.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const PORT = +process.env.PORT || 3000;
const ROOT = __dirname;
const DEBUG_DIR = path.join(ROOT, 'debug');
const PROFILE_DIR = process.env.EVEREST_PROFILE_DIR || path.join(ROOT, '.browser-profile');
const SCRAPER_SRC = fs.readFileSync(path.join(ROOT, 'everest-scrape.js'), 'utf8');

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json', '.css': 'text/css' };
const STATIC = new Set(['index.html', 'everest-scrape.js']);

let busy = false;

function send(res, code, body, type) {
  res.writeHead(code, { 'Content-Type': type || 'application/json', 'Cache-Control': 'no-store' });
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let s = '';
    req.on('data', c => { s += c; if (s.length > 1e6) { reject(new Error('Request too large')); req.destroy(); } });
    req.on('end', () => { try { resolve(JSON.parse(s || '{}')); } catch (e) { reject(new Error('Bad JSON')); } });
  });
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
const settle = async (page, extra) => {
  await page.waitForLoadState('domcontentloaded').catch(() => {});
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
  await sleep(extra || 800);
};

async function saveDebug(page, name) {
  try {
    fs.mkdirSync(DEBUG_DIR, { recursive: true });
    const file = path.join(DEBUG_DIR, `${new Date().toISOString().replace(/[:.]/g, '-')}-${name}.png`);
    await page.screenshot({ path: file, fullPage: true });
    return path.relative(ROOT, file);
  } catch (e) { return null; }
}

const visiblePw = async page => {
  for (const f of page.frames()) {
    if (await f.locator('input[type=password]:visible').count().catch(() => 0)) return true;
  }
  return false;
};

/* Everest (booking.onestephost.com) login: Vue form with username, password and,
 * for a browser that is not yet activated, a Google Authenticator code. On success it
 * redirects to the "goto" page with ?sid=... in the URL. */
async function login(page, { loginUrl, username, password, interactive }, log) {
  log('Opening the Everest login page');
  await page.goto(loginUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await settle(page);
  if (/[?&]sid=/.test(page.url()) && !(await visiblePw(page))) { log('Already logged in'); return; }

  let frame = null;
  for (let i = 0; i < 20 && !frame; i++) {
    for (const f of page.frames()) {
      const n = await f.locator('input[type=password]:visible').count().catch(() => 0);
      if (n) { frame = f; break; }
    }
    if (!frame) await sleep(500);
  }
  if (!frame) {
    log('No password field on the login page; maybe already logged in.');
    return;
  }

  const marked = await frame.evaluate(() => {
    const vis = el => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none'; };
    const pw = [...document.querySelectorAll('input[type=password]')].find(vis);
    const all = [...document.querySelectorAll('input')].filter(vis);
    const idx = all.indexOf(pw);
    const user = all.slice(0, idx).reverse().find(el => /^(text|email|tel|)$/i.test(el.type || ''));
    pw.setAttribute('data-ev-pw', '1');
    if (user) user.setAttribute('data-ev-user', '1');
    return !!user;
  });
  if (!marked) throw new Error('Could not find the username field on the login page.');

  log('Filling in credentials');
  await frame.fill('[data-ev-user]', username);
  await frame.fill('[data-ev-pw]', password);

  // Everest's Login button is type="button" (Vue click handler), so click the form's button.
  const submitBtn = frame.locator('form:has([data-ev-pw]) button:visible, form:has([data-ev-pw]) input[type=submit]:visible').last();
  const clickLogin = async () => {
    if (await submitBtn.count()) await submitBtn.click();
    else await frame.press('[data-ev-pw]', 'Enter');
  };
  const formText = async () => (await frame.locator('form:has([data-ev-pw]), .alert:visible').allInnerTexts().catch(() => [])).join(' ');
  const codeField = frame.locator('input[placeholder="Code"]:visible, input[type=text]:visible:not([data-ev-user])').first();

  // Wait for: redirect with sid (success), an error, or the authenticator code prompt.
  const waitResult = async () => {
    for (let i = 0; i < 60; i++) {
      await sleep(500);
      if (/[?&]sid=/.test(page.url()) || !(await visiblePw(page))) {
        await settle(page, 1500);
        if (!(await visiblePw(page))) return 'ok';
      }
      const t = await formText();
      if (/gesperrt/i.test(t)) return 'locked';
      if (/nicht erfolgreich|incorrect|falsch/i.test(t)) return 'bad';
      if (/Authenticator|Code/i.test(t) && await codeField.count()) return 'code';
    }
    return 'timeout';
  };

  await clickLogin();
  let r = await waitResult();
  if (r === 'code') {
    // Hidden browser: reopen as a visible window so the person can type the code there.
    if (!interactive) throw Object.assign(new Error('NEED_CODE'), { needCode: true });
    log('Everest asks for a Google Authenticator code. Type it in the Everest window that just opened and click Login (waiting up to 3 minutes).');
    for (let i = 0; i < 180; i++) {
      await sleep(1000);
      if (page.isClosed()) throw new Error('The Everest window was closed before the code was entered.');
      if (/[?&]sid=/.test(page.url()) && !(await visiblePw(page))) { r = 'ok'; await settle(page, 1500); break; }
    }
    if (r !== 'ok') throw new Error('No Google Authenticator code was entered within 3 minutes. Try again.');
  }
  if (r === 'ok') { log('Logged in'); return; }
  const shot = await saveDebug(page, 'login-failed');
  const why = r === 'locked' ? 'The Everest account is locked. Contact OneStepHost support.'
    : r === 'bad' ? 'Login failed: wrong username or password.'
    : 'Login failed: Everest did not respond in time.';
  throw new Error(why + (shot ? ` Screenshot: ${shot}` : ''));
}

/* Planning URLs copied from the browser carry an old ?sid=...; swap in the current one. */
function withSid(url, sid) {
  try {
    const u = new URL(url);
    if (sid) u.searchParams.set('sid', sid); else u.searchParams.delete('sid');
    return u.toString();
  } catch (e) { return url; }
}

async function runScraper(page) {
  return page.evaluate(`(function(){window.__everestAuto=true;${SCRAPER_SRC};return everestScrape();})()`);
}

/* Wait for the booking grid to render, then scrape it. */
async function scrapeCurrent(page, log) {
  let last = null;
  for (let i = 0; i < 20; i++) {
    try { last = await runScraper(page); } catch (e) { last = { error: e.message }; }
    if (last && last.data && last.data.rows && last.data.rows.length) return last.data;
    await sleep(1000);
  }
  const shot = await saveDebug(page, 'no-grid');
  throw new Error('No booking grid found on ' + page.url() + (last && last.error ? ` (${last.error})` : '') + (shot ? `. Screenshot: ${shot}` : ''));
}

const EVEREST_LOGIN = 'https://booking.onestephost.com/everest/login.php?goto=%2Feverest%2Fcockpit%2Fplanning1%2F';

/* After login Everest lands on /everest/cockpit/planning1/?sid=... for that account's hotel.
 * Make sure we are there, then read the grid (and optionally the following months). */
async function scrapePlanning(page, hotel, opts, log) {
  const sid = new URL(page.url()).searchParams.get('sid');
  if (!page.url().includes('/cockpit/planning1')) {
    const url = withSid(new URL('/everest/cockpit/planning1/', opts.loginUrl).toString(), sid);
    log(`${hotel.name}: opening the planning page`);
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await settle(page, 1500);
  }
  const months = Math.max(1, Math.min(2, +opts.months || 1));
  const out = [];
  let days = 0;
  for (let m = 0; m < months; m++) {
    let data;
    if (!out.length) data = await scrapeCurrent(page, log);
    else {
      try { data = await scrapeCurrent(page, log); }
      catch (e) { log(`${hotel.name}: could not read the next month (${e.message}); only this month was imported`); break; }
    }
    log(`${hotel.name}: read ${data.rows.length} rooms × ${data.rows[0].cells.length} days`);
    // Same grid as before → the page did not move on to the next month.
    if (out.length && signature(data) === signature(out[out.length - 1])) {
      log(`${hotel.name}: the page did not change to the next month; only this month was imported`);
      break;
    }
    out.push(data);
    days += data.rows[0].cells.length;
    if (m < months - 1) {
      if (days >= 50) { log(`${hotel.name}: the page already shows ${days} days, no need to switch month`); break; }
      const found = await clickNextMonth(page);
      if (!found) { log(`${hotel.name}: could not find the "next month" arrow on the planning page; only this month was imported`); await saveDebug(page, 'no-next-button'); break; }
      log(`${hotel.name}: going to the next month (clicked ${found})`);
      await settle(page, 2500);
    }
  }
  return out;
}

const signature = d => JSON.stringify([d.months && d.months[0], d.ml && d.ml[0], d.rows.map(r => r.cells.map(c => c.d + (c.k || '') + c.tl + c.br).join(''))]);

/* Find the planning page's "next month" control and click it. Looks for arrow-like
 * buttons/links (›, », >, →, chevron/arrow-right icons, "weiter", "next", ...) that are
 * visible and sit above the booking grid, preferring the one closest to the top-right
 * of the grid's header. Returns a short description of what was clicked, or null. */
async function clickNextMonth(page) {
  for (const frame of page.frames()) {
    const desc = await frame.evaluate(() => {
      const TXT = /^(›|»|>|>>|→|⟩|❯|▶|►|⇒|weiter|vor|vorwärts|nächste[rns]?( monat)?|next( month)?|\+1 monat)$/i;
      const CLS = /(^|[\s_-])(next|forward|weiter|right|chevron-right|angle-right|arrow-right|caret-right|angle-double-right|fa-forward|glyphicon-chevron-right|fa-step-forward)([\s_-]|$)/i;
      const vis = el => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && +cs.opacity > 0.1; };
      const cls = el => (typeof el.className === 'string' ? el.className : (el.getAttribute('class') || ''));
      const grid = document.querySelector('.planning1-item-day');
      const gridTop = grid ? grid.getBoundingClientRect().top + window.scrollY : Infinity;
      const cands = [];
      document.querySelectorAll('a,button,span,i,div,li,img,svg,input[type=button]').forEach(el => {
        if (!vis(el) || el.closest('.datepicker, .ui-datepicker, .daterangepicker, .flatpickr-calendar, .modal:not(.in):not(.show)')) return;
        const t = (el.innerText || el.value || '').replace(/\s+/g, ' ').trim();
        const label = [cls(el), el.getAttribute('title') || '', el.getAttribute('aria-label') || '', el.getAttribute('alt') || '', el.getAttribute('data-original-title') || ''].join(' ');
        const textHit = t && t.length <= 20 && TXT.test(t);
        const clsHit = CLS.test(label) || /n[äa]chste|weiter|next/i.test(label);
        if (!textHit && !clsHit) return;
        if (/prev|back|zurück|left|vorig/i.test(label + ' ' + t)) return;
        const target = el.closest('a,button,[onclick],[role=button],input[type=button]') || el;
        if (!vis(target)) return;
        const r = target.getBoundingClientRect(), top = r.top + window.scrollY;
        if (r.width > 260 || r.height > 120) return;
        // Above the grid scores best; further right scores better (next arrows usually sit right of the month name).
        const score = (top <= gridTop + 5 ? 1000 : 0) - Math.abs(gridTop - top) / 10 + r.left / 100 + (textHit ? 5 : 0);
        cands.push({ target, score, d: (t || label.trim()).slice(0, 40) });
      });
      if (!cands.length) return null;
      cands.sort((a, b) => b.score - a.score);
      cands[0].target.setAttribute('data-ev-next', '1');
      return cands[0].d || 'arrow';
    }).catch(() => null);
    if (desc) {
      await frame.locator('[data-ev-next]').first().click({ timeout: 5000 }).catch(() => {});
      await frame.evaluate(() => { const e = document.querySelector('[data-ev-next]'); if (e) e.removeAttribute('data-ev-next'); }).catch(() => {});
      return desc;
    }
  }
  return null;
}

/* One hotel = one Everest account. Each gets its own saved browser profile, so Everest
 * remembers each browser after its first Google Authenticator code. */
async function importHotel(hotel, opts, log, visible) {
  const show = !!visible; // hidden, except when Everest asks for an authenticator code
  const ctx = await chromium.launchPersistentContext(path.join(PROFILE_DIR, hotel.id), {
    headless: !show, viewport: { width: 1600, height: 1000 }, bypassCSP: true, locale: 'de-AT',
  });
  try {
    const page = ctx.pages()[0] || await ctx.newPage();
    if (show) await page.bringToFront().catch(() => {});
    const tag = s => log(`${hotel.name}: ${s}`);
    await login(page, { loginUrl: opts.loginUrl, username: hotel.username, password: hotel.password, interactive: show }, tag);
    return await scrapePlanning(page, hotel, opts, log);
  } catch (e) {
    if (e.needCode && !visible) {
      await ctx.close().catch(() => {});
      return importHotel(hotel, opts, log, true); // retry in a visible window for the code
    }
    throw e;
  } finally {
    await ctx.close().catch(() => {});
  }
}

async function handleScrape(body) {
  const logs = [];
  const log = s => { logs.push(s); console.log('  ' + s); };
  // EVEREST_LOGIN_URL lets a test server stand in for the real Everest.
  const opts = Object.assign({}, body, { loginUrl: process.env.EVEREST_LOGIN_URL || EVEREST_LOGIN });
  const hotels = (body.hotels || []).filter(h => h && h.id && h.username && h.password);
  if (!hotels.length) throw Object.assign(new Error('Enter the username and password for Itzling and/or Grödig.'), { logs });
  const results = [];
  for (const h of hotels) {
    try { results.push({ id: h.id, scrapes: await importHotel(h, opts, log) }); }
    catch (e) { log(`${h.name}: ${e.message}`); results.push({ id: h.id, error: e.message, scrapes: [] }); }
  }
  return { ok: true, results, logs };
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/api/ping') return send(res, 200, { ok: true });
  if (url.pathname === '/api/scrape' && req.method === 'POST') {
    if (busy) return send(res, 409, { ok: false, error: 'An import is already running. Wait for it to finish.' });
    busy = true;
    console.log(new Date().toLocaleString(), 'Auto-import started');
    try { send(res, 200, await handleScrape(await readBody(req))); }
    catch (e) { console.log('  Failed:', e.message); send(res, 200, { ok: false, error: e.message, logs: e.logs || [] }); }
    finally { busy = false; }
    return;
  }
  const name = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname.slice(1));
  if (!STATIC.has(name)) return send(res, 404, 'Not found', 'text/plain');
  fs.readFile(path.join(ROOT, name), (err, buf) => {
    if (err) return send(res, 404, 'Not found', 'text/plain');
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(name)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(buf);
  });
});

// Never let one bad import take the whole server down.
process.on('uncaughtException', e => console.error('Unexpected error:', e && e.message));
process.on('unhandledRejection', e => console.error('Unexpected error:', e && e.message));

server.on('error', e => {
  if (e.code === 'EADDRINUSE') console.error(`Port ${PORT} is already in use. The board server is probably already running in another window.`);
  else console.error(e);
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Everest Check-in Board running at http://localhost:${PORT}`);
  console.log('Keep this window open while you use the board. Press Ctrl+C to stop.');
});
