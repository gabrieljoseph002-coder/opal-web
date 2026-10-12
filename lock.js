// Opal app lock: PIN + device biometrics (Windows Hello, Touch ID, Face ID / passkey).
// Each device is added once by the owner (sets the PIN there). Nothing secret is stored in this code:
// the PIN is kept only as a salted PBKDF2 hash on the device itself.
// Desktop: the main process holds the lock (window.opal.lock*). Phone/web: this file does it with WebCrypto + WebAuthn.
(function () {
  const IDLE_MIN = 15;          // lock after 15 minutes of no use
  const AWAY_MIN = 5;           // lock if the app was in the background this long
  const ITER = 310000;          // OWASP 2023 PBKDF2-SHA256 guidance
  const K = 'opal.sec';
  const enc = new TextEncoder();
  const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
  const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  // ---------- Web backend (phone, Android, browser) ----------
  const read = () => { try { return JSON.parse(localStorage.getItem(K) || 'null'); } catch { return null; } };
  const write = (v) => { try { localStorage.setItem(K, JSON.stringify(v)); } catch {} };
  async function hash(pin, salt) {
    const key = await crypto.subtle.importKey('raw', enc.encode(pin), 'PBKDF2', false, ['deriveBits']);
    return b64(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: ITER }, key, 256));
  }
  function same(a, b) { if (a.length !== b.length) return false; let x = 0; for (let i = 0; i < a.length; i++) x |= a.charCodeAt(i) ^ b.charCodeAt(i); return x === 0; }
  function guessDevice() {
    const u = navigator.userAgent;
    if (/iPhone/.test(u)) return 'iPhone'; if (/iPad/.test(u)) return 'iPad'; if (/Android/.test(u)) return 'Android phone';
    if (/CrOS/.test(u)) return 'Chromebook'; if (/Mac OS X/.test(u)) return 'MacBook'; if (/Windows/.test(u)) return 'Windows PC'; return 'This device';
  }
  // Never let a slow browser check hold up the lock screen.
  const platformAuth = async () => {
    try {
      if (!window.PublicKeyCredential || !window.isSecureContext) return false;
      return !!(await Promise.race([PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable(), new Promise((r) => setTimeout(() => r(false), 1500))]));
    } catch { return false; }
  };
  const web = {
    async state() {
      const s = read();
      return { enrolled: !!(s && s.hash), device: s && s.name, bio: s && s.cred ? 'Face ID / Touch ID' : '', bioAvailable: await platformAuth(), lockUntil: (s && s.lockUntil) || 0 };
    },
    async enroll(pin, name) {
      if (read()) return { ok: false, msg: 'This device is already set up.' };
      const salt = crypto.getRandomValues(new Uint8Array(16));
      write({ name: name || guessDevice(), salt: b64(salt), hash: await hash(pin, salt), added: new Date().toISOString(), failed: 0, lockUntil: 0 });
      return { ok: true };
    },
    async pin(pin) {
      const s = read(); if (!s) return { ok: false, msg: 'Not set up.' };
      if (Date.now() < (s.lockUntil || 0)) return { ok: false, msg: `Too many tries. Wait ${Math.ceil((s.lockUntil - Date.now()) / 60000)} min.` };
      if (same(await hash(pin, unb64(s.salt)), s.hash)) { s.failed = 0; s.lockUntil = 0; write(s); return { ok: true }; }
      s.failed = (s.failed || 0) + 1;
      if (s.failed >= 5) s.lockUntil = Date.now() + Math.min(60, 2 ** (s.failed - 5) * 5) * 60000; // 5, 10, 20, 40, 60 min
      write(s); return { ok: false, msg: s.failed >= 5 ? 'Too many tries. Locked for a while.' : `Wrong PIN (${5 - s.failed} tries left).` };
    },
    async addBio() {
      const s = read(); if (!s) return { ok: false, msg: 'Set up the PIN first.' };
      try {
        const c = await navigator.credentials.create({ publicKey: {
          challenge: crypto.getRandomValues(new Uint8Array(32)), rp: { name: 'Opal Solutions' },
          user: { id: crypto.getRandomValues(new Uint8Array(16)), name: 'opal-' + s.name, displayName: 'Opal on ' + s.name },
          pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
          authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'preferred' }, timeout: 60000 } });
        s.cred = b64(c.rawId); write(s); return { ok: true };
      } catch (e) { return { ok: false, msg: 'Face ID / Touch ID setup was canceled.' }; }
    },
    async bio() {
      const s = read(); if (!s || !s.cred) return { ok: false };
      try {
        await navigator.credentials.get({ publicKey: { challenge: crypto.getRandomValues(new Uint8Array(32)), allowCredentials: [{ type: 'public-key', id: unb64(s.cred) }], userVerification: 'required', timeout: 60000 } });
        return { ok: true };
      } catch { return { ok: false, msg: 'Face ID / Touch ID didn’t verify.' }; }
    },
    async reset() { try { localStorage.removeItem(K); } catch {} return { ok: true }; },
  };
  // Desktop: main process owns the lock.
  const be = window.opal && window.opal.lock ? window.opal.lock : web;

  // ---------- UI ----------
  let el = null, locked = true, lastUse = Date.now(), hiddenAt = 0;
  const listeners = [];
  function overlay() {
    if (el) return el;
    el = document.createElement('div');
    el.id = 'opalLock';
    el.innerHTML = `<style>
      #opalLock { position: fixed; inset: 0; z-index: 9999; background: radial-gradient(circle at 50% 30%, #241310, #0b0b0b 70%); color: #f4f4f4; display: flex; align-items: center; justify-content: center; font: 15px/1.5 "Open Sans", system-ui, sans-serif; padding: 16px; }
      #opalLock .card { width: 100%; max-width: 360px; text-align: center; }
      #opalLock img { width: 72px; height: 72px; border-radius: 16px; }
      #opalLock h1 { font: 400 30px "Bungee", Impact, sans-serif; letter-spacing: .05em; margin: 10px 0 2px; }
      #opalLock p { color: #a9a9a9; font-size: 13px; margin: 4px 0 14px; }
      #opalLock input { width: 100%; text-align: center; font: 600 26px "Open Sans", sans-serif; letter-spacing: .4em; background: #171717; color: #fff; border: 1px solid #2d2d2d; border-radius: 14px; padding: 12px; margin-bottom: 10px; }
      #opalLock input.name { font-size: 15px; letter-spacing: 0; }
      #opalLock button { width: 100%; border: 0; border-radius: 999px; padding: 12px; font: 600 15px "Open Sans", sans-serif; margin-bottom: 8px; cursor: pointer; background: #d1432a; color: #fff; }
      #opalLock button.ghost { background: #171717; border: 1px solid #2d2d2d; }
      #opalLock .msg { min-height: 20px; color: #e8c46a; font-size: 13px; }
    </style><div class="card"><img src="${document.querySelector('header img') ? document.querySelector('header img').getAttribute('src') : 'assets/icon.png'}" alt=""><h1>OPAL</h1><div id="lkBody"></div><div class="msg" id="lkMsg"></div></div>`;
    document.body.appendChild(el);
    return el;
  }
  const msg = (t) => { el.querySelector('#lkMsg').textContent = t || ''; };
  function unlocked() {
    locked = false; lastUse = Date.now();
    if (el) { el.remove(); el = null; }
    window.__opalUnlocked = true;
    listeners.splice(0).forEach((f) => { try { f(); } catch (e) { console.error(e); } });
  }
  async function show() {
    locked = true; window.__opalUnlocked = false;
    overlay();
    let s;
    try { s = await be.state(); } catch (e) { s = { enrolled: false }; }
    if (s.open) return unlocked(); // desktop self-test profile
    const body = el.querySelector('#lkBody');
    if (!s.enrolled) {
      body.innerHTML = `<p>Add this device to Opal. Only your devices should be set up.</p>
        <input class="name" id="lkName" placeholder="Device name (e.g. iPhone 16 Pro)" value="${esc(s.guess || guessDevice())}">
        <input id="lkPin" type="password" inputmode="numeric" autocomplete="new-password" placeholder="PIN">
        <input id="lkPin2" type="password" inputmode="numeric" autocomplete="new-password" placeholder="PIN again">
        <button id="lkGo">Add this device</button>`;
      body.querySelector('#lkGo').onclick = async () => {
        const a = body.querySelector('#lkPin').value, b = body.querySelector('#lkPin2').value;
        if (!/^\d{4,12}$/.test(a)) return msg('PIN must be 4 to 12 digits.');
        if (a !== b) return msg('The two PINs don’t match.');
        const r = await be.enroll(a, body.querySelector('#lkName').value.trim());
        if (!r.ok) return msg(r.msg);
        if (s.bioAvailable && be.addBio) await offerBio(); else unlocked();
      };
      return;
    }
    body.innerHTML = `<p>${esc(s.device || '')} · locked</p>
      ${s.bio ? `<button id="lkBio">Unlock with ${esc(s.bio)}</button>` : ''}
      <input id="lkPin" type="password" inputmode="numeric" autocomplete="current-password" placeholder="PIN">
      <button id="lkGo" class="${s.bio ? 'ghost' : ''}">Unlock</button>
      ${!s.bio && s.bioAvailable && be.addBio ? '<p>Tip: after unlocking you can add Face ID / Touch ID in the lock settings.</p>' : ''}`;
    const pinIn = body.querySelector('#lkPin');
    const tryPin = async () => { const r = await be.pin(pinIn.value); pinIn.value = ''; if (r.ok) unlocked(); else msg(r.msg); };
    body.querySelector('#lkGo').onclick = tryPin;
    pinIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') tryPin(); });
    const bioBtn = body.querySelector('#lkBio');
    if (bioBtn) { bioBtn.onclick = async () => { const r = await be.bio(); if (r.ok) unlocked(); else msg(r.msg || ''); }; setTimeout(() => bioBtn.click(), 300); }
    else setTimeout(() => pinIn.focus(), 100);
  }
  async function offerBio() {
    const body = el.querySelector('#lkBody');
    body.innerHTML = `<p>Also unlock with your face or fingerprint?</p><button id="lkAdd">Add Face ID / Touch ID / Hello</button><button id="lkSkip" class="ghost">PIN only</button>`;
    body.querySelector('#lkAdd').onclick = async () => { const r = await be.addBio(); if (r.ok) unlocked(); else msg(r.msg); };
    body.querySelector('#lkSkip').onclick = unlocked;
  }
  function lock() { if (!locked) { if (be.lockNow) be.lockNow(); show(); } }

  // Auto-lock: idle, or back from the background after a while.
  ['pointerdown', 'keydown', 'touchstart', 'wheel'].forEach((ev) => document.addEventListener(ev, () => { lastUse = Date.now(); }, { passive: true, capture: true }));
  setInterval(() => { if (!locked && Date.now() - lastUse > IDLE_MIN * 60000) lock(); }, 30000);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) hiddenAt = Date.now();
    else if (!locked && hiddenAt && Date.now() - hiddenAt > AWAY_MIN * 60000) lock();
  });
  if (window.opal && window.opal.onLocked) window.opal.onLocked(() => { if (!locked) show(); });

  window.OpalLock = {
    start: () => (document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', show) : show()),
    onUnlock: (f) => (locked ? listeners.push(f) : f()),
    lock,
    addBio: async () => (be.addBio ? be.addBio() : { ok: false, msg: 'Not available here.' }),
    state: () => be.state(),
    resetThisDevice: async () => { await be.reset(); location.reload(); },
  };
  window.OpalLock.start();
})();
