// "Get the AI apps": official download / store links and install commands, filtered to the device in hand.
// Official sources only (claude.ai, chatgpt.com/openai, google). Links checked 2026-10-12. Never host installers ourselves.
(function () {
  const APPS = [
    { name: 'Claude', by: 'Anthropic', items: {
      windows: [['Claude desktop app', 'link', 'https://claude.ai/download'], ['Claude Code (PowerShell)', 'cmd', 'irm https://claude.ai/install.ps1 | iex']],
      mac: [['Claude desktop app', 'link', 'https://claude.ai/download'], ['Claude Code (Terminal)', 'cmd', 'curl -fsSL https://claude.ai/install.sh | bash']],
      linux: [['Claude Code (Linux terminal)', 'cmd', 'curl -fsSL https://claude.ai/install.sh | bash'], ['Claude on the web', 'link', 'https://claude.ai/new']],
      ios: [['Claude on the App Store', 'link', 'https://apps.apple.com/us/app/claude-by-anthropic/id6473753684']],
      android: [['Claude on Google Play', 'link', 'https://play.google.com/store/apps/details?id=com.anthropic.claude']],
    } },
    { name: 'ChatGPT', by: 'OpenAI', items: {
      windows: [['ChatGPT desktop app', 'link', 'https://chatgpt.com/download'], ['Codex CLI (needs Node.js)', 'cmd', 'npm install -g @openai/codex']],
      mac: [['ChatGPT desktop app', 'link', 'https://chatgpt.com/download'], ['Codex CLI (needs Node.js)', 'cmd', 'npm install -g @openai/codex']],
      linux: [['Codex CLI (needs Node.js)', 'cmd', 'npm install -g @openai/codex'], ['ChatGPT on the web', 'link', 'https://chatgpt.com/']],
      ios: [['ChatGPT on the App Store', 'link', 'https://apps.apple.com/us/app/chatgpt/id6448311069']],
      android: [['ChatGPT on Google Play', 'link', 'https://play.google.com/store/apps/details?id=com.openai.chatgpt']],
    } },
    { name: 'Gemini', by: 'Google', items: {
      windows: [['Gemini app for Windows', 'link', 'https://blog.google/innovation-and-ai/products/gemini-app/the-gemini-app-is-now-available-for-windows/'], ['Gemini CLI (needs Node.js)', 'cmd', 'npm install -g @google/gemini-cli']],
      mac: [['Gemini on the web', 'link', 'https://gemini.google.com/app'], ['Gemini CLI (needs Node.js)', 'cmd', 'npm install -g @google/gemini-cli']],
      linux: [['Gemini CLI (needs Node.js)', 'cmd', 'npm install -g @google/gemini-cli'], ['Gemini on the web', 'link', 'https://gemini.google.com/app']],
      ios: [['Google Gemini on the App Store', 'link', 'https://apps.apple.com/us/app/google-gemini/id6477489729']],
      android: [['Google Gemini on Google Play', 'link', 'https://play.google.com/store/apps/details?id=com.google.android.apps.bard']],
    } },
  ];
  const NODE = ['Node.js (needed for the terminal tools)', 'link', 'https://nodejs.org/en/download'];
  const LABEL = { windows: 'Windows', mac: 'Mac', linux: 'Linux / Chromebook', ios: 'iPhone / iPad', android: 'Android' };
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  function device() {
    const cap = window.Capacitor && window.Capacitor.getPlatform && window.Capacitor.getPlatform();
    if (cap === 'ios' || cap === 'android') return cap;
    const ua = navigator.userAgent || '';
    if (/iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return 'ios';
    if (/Android/.test(ua)) return 'android';
    if (/CrOS|Linux/.test(ua)) return 'linux';
    if (/Mac/.test(ua)) return 'mac';
    return 'windows';
  }

  function html(dev) {
    const needsNode = ['windows', 'mac', 'linux'].includes(dev);
    return `<div class="aiapps">
      <p class="sub">Showing downloads for <b>${LABEL[dev]}</b>. <a href="#" data-aidev="all">Show all devices</a></p>
      ${APPS.map((a) => `<div class="aiapp"><div class="aiapp-head"><b>${a.name}</b><span>${a.by}</span></div>
        ${(a.items[dev] || []).map(([label, kind, val]) => kind === 'link'
          ? `<button class="btn ghost" data-aiopen="${esc(val)}">${esc(label)} ↗</button>`
          : `<div class="aicmd"><span>${esc(label)}</span><code>${esc(val)}</code><button class="btn ghost" data-aicopy="${esc(val)}">Copy</button></div>`).join('')}
      </div>`).join('')}
      ${needsNode ? `<p class="note">The CLI tools need Node.js first: <a href="#" data-aiopen="${NODE[2]}">nodejs.org</a>. Official links only; installers are never re-hosted by Opal.</p>` : '<p class="note">Official App Store / Google Play listings.</p>'}
    </div>`;
  }

  function allHtml() {
    return Object.keys(LABEL).map((d) => `<h3>${LABEL[d]}</h3>` + html(d).replace(/<p class="sub">[\s\S]*?<\/p>/, '')).join('');
  }

  function mount(el, opts = {}) {
    const open = (u) => (opts.open ? opts.open(u) : window.open(u, '_blank'));
    const render = (all) => {
      el.innerHTML = all ? allHtml() : html(device());
      el.querySelectorAll('[data-aiopen]').forEach((b) => b.addEventListener('click', (e) => { e.preventDefault(); open(b.dataset.aiopen); }));
      el.querySelectorAll('[data-aicopy]').forEach((b) => b.addEventListener('click', async () => {
        try { await navigator.clipboard.writeText(b.dataset.aicopy); b.textContent = 'Copied ✓'; }
        catch { b.textContent = 'Select & copy'; }
        setTimeout(() => (b.textContent = 'Copy'), 2000);
      }));
      const allLink = el.querySelector('[data-aidev="all"]');
      if (allLink) allLink.addEventListener('click', (e) => { e.preventDefault(); render(true); });
    };
    render(false);
  }

  window.OpalAIApps = { mount, device, APPS };
})();
