// Version footer + "newer version available" check, shared by every Opal copy.
// The live web app publishes version.json; every other copy compares itself against it.
(function () {
  const ME = { version: '1.5.0', date: '2026-10-12' };
  const LIVE = 'https://gabrieljoseph002-coder.github.io/opal-web/version.json';
  const newer = (a, b) => { const x = a.split('.').map(Number), y = b.split('.').map(Number); for (let i = 0; i < 3; i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); } return false; };
  function footer(el, how) {
    if (!el) return;
    const d = new Date(ME.date + 'T12:00:00');
    el.textContent = `Opal v${ME.version} · updated ${d.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })}`;
    fetch(LIVE + '?t=' + Date.now()).then((r) => r.json()).then((live) => {
      if (live && live.version && newer(live.version, ME.version)) {
        const b = document.createElement('div');
        b.className = 'update-bar';
        b.textContent = `A newer Opal (v${live.version}) is available. ${how || 'Update this copy to get it.'}`;
        b.style.cssText = 'position:fixed;left:50%;transform:translateX(-50%);top:10px;z-index:90;background:#1b1b1b;border:1px solid #b9ecc6;color:#f4f4f4;padding:8px 14px;border-radius:999px;font:13px system-ui,sans-serif;box-shadow:0 4px 20px rgba(0,0,0,.5)';
        document.body.appendChild(b);
      }
    }).catch(() => {});
  }
  window.OpalVersion = { ...ME, footer };
})();
