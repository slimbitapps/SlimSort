'use strict';
/**
 * Kleiner WebDriver-Client für die Tauri-App (über tauri-driver) mit den
 * wenigen Befehlen, die der E2E-Test braucht – angelehnt an Playwright.
 */
const { spawn } = require('node:child_process');
const fs = require('node:fs');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ELEMENT = 'element-6066-11e4-a52e-4f735466cecf';

const KEYS = {
  Delete: '', Backspace: '', End: '', Home: '', ArrowRight: '', ArrowLeft: '',
  ArrowUp: '', ArrowDown: '', Escape: '', Tab: '', Enter: '', F1: '', F10: '',
  F11: '', Shift: '', Control: '', Meta: '', Alt: '', ' ': ' ',
};

function keyValue(k) {
  if (KEYS[k]) return KEYS[k];
  const m = /^(?:Digit|Numpad)(\d)$/.exec(k);
  if (m) return m[1];
  if (/^Key[A-Z]$/.test(k)) return k.slice(3).toLowerCase();
  return k;
}

class Page {
  constructor(base, sid) {
    this.base = base;
    this.sid = sid;
  }

  async cmd(method, path, body) {
    const r = await fetch(`${this.base}/session/${this.sid}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const j = await r.json();
    if (j.value && j.value.error) throw new Error(`${j.value.error}: ${j.value.message} (${method} ${path})`);
    return j.value;
  }

  /** Funktion im Fenster ausführen (wie page.evaluate) */
  async evaluate(fn, arg) {
    const src = typeof fn === 'function' ? fn.toString() : `() => (${fn})`;
    return this.cmd('POST', '/execute/async', {
      script: `const done = arguments[arguments.length - 1];
        Promise.resolve((${src})(arguments[0])).then((v) => done({ ok: true, v }), (e) => done({ ok: false, e: String(e && e.stack || e) }));`,
      args: [arg === undefined ? null : arg],
    }).then((r) => {
      if (!r || !r.ok) throw new Error('evaluate: ' + (r && r.e));
      return r.v;
    });
  }

  async find(selector) {
    if (selector.startsWith('text=')) {
      const t = selector.slice(5).replace(/"/g, '\\"');
      return this.cmd('POST', '/element', { using: 'xpath', value: `//*[normalize-space(.)="${t}" and not(*[normalize-space(.)="${t}"])]` })
        .then((v) => v && v[ELEMENT])
        .catch(() => null);
    }
    return this.cmd('POST', '/element', { using: 'css selector', value: selector }).then((v) => v && v[ELEMENT]).catch(() => null);
  }

  async findAll(selector) {
    const v = await this.cmd('POST', '/elements', { using: 'css selector', value: selector });
    return v.map((e) => e[ELEMENT]);
  }

  async $(selector) {
    return (await this.find(selector)) ? { selector } : null;
  }

  async $$(selector) {
    const ids = await this.findAll(selector);
    return ids.map((id, i) => ({
      id,
      click: (o = {}) => this.clickId(id, o.modifiers || []),
      getAttribute: (a) => this.cmd('GET', `/element/${id}/attribute/${a}`),
    }));
  }

  async $$eval(selector, fn) {
    return this.cmd('POST', '/execute/sync', { script: `return (${fn.toString()})([...document.querySelectorAll(arguments[0])]);`, args: [selector] });
  }

  async waitForSelector(selector, o = {}) {
    const t0 = Date.now();
    const timeout = o.timeout || 15000;
    while (Date.now() - t0 < timeout) {
      const id = await this.find(selector);
      if (id) {
        const shown = await this.cmd('GET', `/element/${id}/displayed`).catch(() => true);
        if (shown !== false) return id;
      }
      await sleep(80);
    }
    throw new Error('waitForSelector: ' + selector);
  }

  async waitForFunction(fn, _arg, o = {}) {
    const t0 = Date.now();
    const timeout = (o && o.timeout) || 15000;
    while (Date.now() - t0 < timeout) {
      try {
        if (await this.evaluate(fn)) return;
      } catch {
        /* Element noch nicht da */
      }
      await sleep(100);
    }
    throw new Error('waitForFunction: ' + fn.toString().slice(0, 120));
  }

  async clickId(id, modifiers = []) {
    if (!modifiers.length) {
      // WebKit meldet manchmal kurz „nicht anklickbar“, während die Ansicht sich aufbaut → nochmal
      for (let i = 0; ; i++) {
        try {
          return await this.cmd('POST', `/element/${id}/click`, {});
        } catch (e) {
          if (!/not interactable/.test(String(e))) throw e;
          if (i >= 2) {
            // dann wie ein Mensch: Maus hinbewegen und klicken
            await this.cmd('POST', '/actions', {
              actions: [{ type: 'pointer', id: 'mouse', parameters: { pointerType: 'mouse' }, actions: [
                { type: 'pointerMove', duration: 0, origin: { [ELEMENT]: id }, x: 0, y: 0 },
                { type: 'pointerDown', button: 0 }, { type: 'pointerUp', button: 0 },
              ] }],
            });
            return this.cmd('DELETE', '/actions');
          }
          await sleep(300);
        }
      }
    }
    const keys = modifiers.map(keyValue);
    return this.cmd('POST', '/actions', {
      actions: [
        { type: 'key', id: 'kb', actions: [...keys.map((v) => ({ type: 'keyDown', value: v })), { type: 'pause', duration: 0 }, { type: 'pause', duration: 0 }, { type: 'pause', duration: 0 }, ...keys.map((v) => ({ type: 'keyUp', value: v }))] },
        {
          type: 'pointer',
          id: 'mouse',
          parameters: { pointerType: 'mouse' },
          actions: [
            ...keys.map(() => ({ type: 'pause', duration: 0 })),
            { type: 'pointerMove', duration: 0, origin: { [ELEMENT]: id }, x: 0, y: 0 },
            { type: 'pointerDown', button: 0 },
            { type: 'pointerUp', button: 0 },
          ],
        },
      ],
    }).then(() => this.cmd('DELETE', '/actions'));
  }

  /** Warten, bis das Element nicht mehr animiert (Position zweimal gleich) */
  async waitStable(selector) {
    let last = '';
    for (let i = 0; i < 40; i++) {
      const r = await this.evaluate((sel) => {
        const b = document.querySelector(sel)?.getBoundingClientRect();
        return b ? [b.x, b.y, b.width, b.height].map(Math.round).join(',') : '';
      }, selector).catch(() => '');
      if (r && r === last) return;
      last = r;
      await sleep(60);
    }
  }

  async click(selector) {
    await this.waitForSelector(selector);
    if (!selector.startsWith('text=')) await this.waitStable(selector);
    const id = await this.find(selector);
    await this.clickId(id);
    await sleep(120); // der Oberfläche Zeit zum Neuzeichnen geben (wie Playwrights Auto-Warten)
  }

  /** Mit der Maus von einem Element zu einem anderen ziehen (echte Zeiger-Ereignisse) */
  async dragTo(fromId, toSelector) {
    const to = await this.waitForSelector(toSelector);
    const steps = [];
    for (let i = 1; i <= 6; i++) steps.push({ type: 'pointerMove', duration: 40, origin: { [ELEMENT]: to }, x: Math.round(-60 + i * 10), y: 0 });
    await this.cmd('POST', '/actions', {
      actions: [
        {
          type: 'pointer',
          id: 'mouse',
          parameters: { pointerType: 'mouse' },
          actions: [
            { type: 'pointerMove', duration: 0, origin: { [ELEMENT]: fromId }, x: 0, y: 0 },
            { type: 'pointerDown', button: 0 },
            { type: 'pointerMove', duration: 60, origin: { [ELEMENT]: fromId }, x: 15, y: 10 },
            ...steps,
            { type: 'pointerUp', button: 0 },
          ],
        },
      ],
    });
    await this.cmd('DELETE', '/actions');
    await sleep(150);
  }

  /** Rechtsklick auf ein Element */
  async rightClick(selector) {
    const id = await this.waitForSelector(selector);
    await this.cmd('POST', '/actions', {
      actions: [{ type: 'pointer', id: 'mouse', parameters: { pointerType: 'mouse' }, actions: [{ type: 'pointerMove', duration: 0, origin: { [ELEMENT]: id }, x: 0, y: 0 }, { type: 'pointerDown', button: 2 }, { type: 'pointerUp', button: 2 }] }],
    });
    await this.cmd('DELETE', '/actions');
    await sleep(150);
  }

  async hover(selector) {
    const id = await this.waitForSelector(selector);
    await this.cmd('POST', '/actions', { actions: [{ type: 'pointer', id: 'mouse', parameters: { pointerType: 'mouse' }, actions: [{ type: 'pointerMove', duration: 0, origin: { [ELEMENT]: id }, x: 0, y: 0 }] }] });
  }

  async textContent(selector) {
    // wie Playwright: Text auch von gerade ausgeblendeten Elementen lesen
    const t0 = Date.now();
    while (!(await this.find(selector)) && Date.now() - t0 < 15000) await sleep(80);
    return this.evaluate((sel) => document.querySelector(sel).textContent, selector);
  }

  async isVisible(selector) {
    const id = await this.find(selector);
    return !!id && (await this.cmd('GET', `/element/${id}/displayed`));
  }

  async fill(selector, value) {
    const id = await this.waitForSelector(selector);
    await this.cmd('POST', `/element/${id}/clear`, {});
    await this.cmd('POST', `/element/${id}/value`, { text: String(value) });
  }

  async selectOption(selector, value) {
    await this.evaluate(
      ([sel, v]) => {
        const el = document.querySelector(sel);
        Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(el, v);
        el.dispatchEvent(new Event('change', { bubbles: true }));
      },
      [selector, value]
    );
  }

  async screenshot({ path }) {
    const b64 = await this.cmd('GET', '/screenshot');
    fs.writeFileSync(path, Buffer.from(b64, 'base64'));
  }

  get keyboard() {
    return {
      press: async (combo) => {
        const parts = combo === '+' ? ['+'] : combo.split('+');
        const keys = parts.map(keyValue);
        const actions = [...keys.map((v) => ({ type: 'keyDown', value: v })), ...keys.slice().reverse().map((v) => ({ type: 'keyUp', value: v }))];
        await this.cmd('POST', '/actions', { actions: [{ type: 'key', id: 'kb', actions }] });
        await this.cmd('DELETE', '/actions');
        await sleep(30);
      },
    };
  }

  get mouse() {
    return {
      move: (x, y) =>
        this.cmd('POST', '/actions', { actions: [{ type: 'pointer', id: 'mouse', parameters: { pointerType: 'mouse' }, actions: [{ type: 'pointerMove', duration: 0, origin: 'viewport', x, y }] }] }),
    };
  }
}

/** Startet tauri-driver + App und liefert { page, close }. */
async function launch({ app, env, port = 4444 }) {
  const driver = spawn('tauri-driver', ['--port', String(port)], { env: { ...process.env, ...env }, stdio: ['ignore', 'ignore', 'pipe'] });
  let errText = '';
  driver.stderr.on('data', (d) => (errText += d));
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 100; i++) {
    try {
      await fetch(base + '/status');
      break;
    } catch {
      await sleep(100);
    }
  }
  const r = await fetch(base + '/session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ capabilities: { alwaysMatch: { 'tauri:options': { application: app } } } }),
  }).then((x) => x.json());
  if (!r.value || !r.value.sessionId) throw new Error('Sitzung konnte nicht starten: ' + JSON.stringify(r) + errText);
  const page = new Page(base, r.value.sessionId);
  // warten, bis das Fenster wirklich sichtbar ist (es erscheint erst, wenn die Oberfläche bereit ist)
  for (let i = 0; i < 100; i++) {
    const w = await page.evaluate(() => window.innerWidth).catch(() => 0);
    if (w > 0) break;
    await sleep(100);
  }
  return {
    page,
    close: async () => {
      await fetch(`${base}/session/${r.value.sessionId}`, { method: 'DELETE' }).catch(() => {});
      driver.kill();
    },
  };
}

module.exports = { launch, sleep };
