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
const PROFILE_DIR = path.join(ROOT, '.browser-profile');
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
  const months = Math.max(1, Math.min(12, +opts.months || 1));
  const out = [];
  for (let m = 0; m < months; m++) {
    const data = await scrapeCurrent(page, log);
    log(`${hotel.name}: read ${data.rows.length} rooms × ${data.rows[0].cells.length} days`);
    out.push(data);
    if (m < months - 1) {
      if (!opts.nextSelector) break;
      const next = page.locator(opts.nextSelector).first();
      if (!(await next.count())) { log(`${hotel.name}: "next month" button not found (${opts.nextSelector}), stopping`); break; }
      log(`${hotel.name}: going to next month`);
      await next.click();
      await settle(page, 2000);
    }
  }
  return out;
}

/* One hotel = one Everest account. Each gets its own saved browser profile, so Everest
 * remembers each browser after its first Google Authenticator code. */
async function importHotel(hotel, opts, log, visible) {
  const show = visible || !!opts.showBrowser;
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
  const opts = Object.assign({}, body, { loginUrl: body.loginUrl || EVEREST_LOGIN });
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
