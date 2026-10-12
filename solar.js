// Opal solar tools: string calculator, 120% rule + electrical tree, power flow, apps & portals, data log.
// Shared by the desktop app and the phone app. Pure browser code, no network.
(function () {
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const num = (el, id) => parseFloat(el.querySelector('#' + id).value);
  const BREAKERS = [15, 20, 25, 30, 35, 40, 45, 50, 60, 70, 80, 90, 100, 110, 125, 150, 175, 200, 225, 250, 300];
  const nextBreaker = (a) => BREAKERS.find((b) => b >= a) || Math.ceil(a);

  // ---------- Data log (stays on this device) ----------
  const LOGKEY = 'opal.log';
  const OpalLog = {
    list() { try { return JSON.parse(localStorage.getItem(LOGKEY) || '[]'); } catch { return []; } },
    add(kind, text) {
      const l = OpalLog.list(); l.unshift({ when: new Date().toISOString(), kind, text: String(text).slice(0, 300) });
      try { localStorage.setItem(LOGKEY, JSON.stringify(l.slice(0, 500))); } catch {}
    },
    clear() { try { localStorage.removeItem(LOGKEY); } catch {} },
    csv() {
      const q = (s) => '"' + String(s).replace(/"/g, '""') + '"';
      return ['when,kind,details'].concat(OpalLog.list().map((r) => [r.when, r.kind, r.text].map(q).join(','))).join(String.fromCharCode(10));
    },
  };

  // ---------- Apps & portals ----------
  const APPS = [
    ['Business', [
      ['Square Dashboard', 'https://app.squareup.com/dashboard/', 'Sales, invoices, items, bookings'],
      ['Opal website', 'https://opal-solutions.square.site/', 'Public site'],
      ['Google Drive', 'https://drive.google.com/drive/my-drive', 'Company docs'],
      ['Gmail', 'https://mail.google.com/', 'Email'],
      ['Google Calendar', 'https://calendar.google.com/', 'Schedule'],
    ]],
    ['Solar design & monitoring', [
      ['OpenSolar', 'https://app.opensolar.com/', 'Design and proposals'],
      ['Enphase Enlighten', 'https://enlighten.enphaseenergy.com/', 'Enphase monitoring and installer tools'],
      ['SolarEdge Monitoring', 'https://monitoring.solaredge.com/', 'SolarEdge sites'],
      ['Tesla Energy (Partner)', 'https://partners.tesla.com/', 'Powerwall installer portal'],
      ['Google Project Sunroof', 'https://sunroof.withgoogle.com/', 'Quick roof solar estimate'],
      ['NREL PVWatts', 'https://pvwatts.nrel.gov/', 'Production estimate'],
    ]],
    ['Permits & utilities (NC)', [
      ['Raleigh permit portal', 'https://permitportal.raleighnc.gov/', 'Raleigh permits and inspections'],
      ['Durham permits (LDO)', 'https://www.durhamnc.gov/1325/Permits-Inspections', 'City/County of Durham'],
      ['Wake County permits', 'https://www.wake.gov/departments-government/permits-inspections', 'Unincorporated Wake'],
      ['Duke Energy interconnection', 'https://www.duke-energy.com/business/products/renewables/generate-your-own', 'Interconnection requests'],
      ['NC Licensing Board', 'https://www.ncbeec.org/', 'Electrical contractors board'],
    ]],
  ];
  function appsHtml() {
    return APPS.map(([group, list]) => `<h3>${esc(group)}</h3><div class="sol-apps">` +
      list.map(([n, u, d]) => `<button class="sol-app" data-url="${esc(u)}"><b>${esc(n)}</b><span>${esc(d)}</span></button>`).join('') + '</div>').join('') +
      '<p class="note">In the desktop app, each portal opens in its own window and stays signed in.</p>';
  }

  // ---------- String calculator (NEC 690.7, 690.8) ----------
  const STR_FIELDS = [
    ['voc', 'Module Voc (V)', 41.0], ['vmp', 'Module Vmp (V)', 34.0], ['isc', 'Module Isc (A)', 13.9],
    ['tcv', 'Voc temp coeff (%/°C)', -0.26], ['tcp', 'Vmp temp coeff (%/°C)', -0.34],
    ['tmin', 'Record low temp (°C)', -14], ['thot', 'Hot cell temp (°C)', 70],
    ['vmax', 'Inverter max DC V', 600], ['mlo', 'MPPT low V', 100], ['mhi', 'MPPT high V', 480],
    ['imax', 'Inverter max input Isc (A)', 20], ['n', 'Modules per string (planned)', 12], ['s', 'Strings', 2],
  ];
  function stringCalc(el) {
    const v = Object.fromEntries(STR_FIELDS.map(([id]) => [id, num(el, 'sc_' + id)]));
    const vocCold = v.voc * (1 + (v.tmin - 25) * v.tcv / 100);
    const vmpHot = v.vmp * (1 + (v.thot - 25) * v.tcp / 100);
    const vmpCold = v.vmp * (1 + (v.tmin - 25) * v.tcp / 100);
    const maxN = Math.floor(v.vmax / vocCold);
    const minN = Math.ceil(v.mlo / vmpHot);
    const stringVoc = vocCold * v.n;
    const iMax = v.isc * 1.25; // 690.8(A)(1)
    const iCond = iMax * 1.25; // 690.8(B) conductor/OCPD
    const checks = [
      [stringVoc <= v.vmax, `Cold string Voc ${stringVoc.toFixed(0)} V vs inverter max ${v.vmax} V`],
      [vmpHot * v.n >= v.mlo, `Hot string Vmp ${(vmpHot * v.n).toFixed(0)} V vs MPPT low ${v.mlo} V`],
      [vmpCold * v.n <= v.mhi, `Cold string Vmp ${(vmpCold * v.n).toFixed(0)} V vs MPPT high ${v.mhi} V`],
      [v.isc <= v.imax, `Module Isc ${v.isc} A vs inverter max input ${v.imax} A per MPPT`],
    ];
    const ok = checks.every((c) => c[0]);
    OpalLog.add('String calc', `${v.s}x${v.n} modules, Voc ${v.voc} V, cold string ${stringVoc.toFixed(0)} V, ${ok ? 'OK' : 'CHECK'}`);
    return `<div class="kpis">
      <div class="kpi"><span>Max per string</span><b>${maxN}</b><small>Cold Voc ${vocCold.toFixed(1)} V/module</small></div>
      <div class="kpi"><span>Min per string</span><b>${minN}</b><small>Hot Vmp ${vmpHot.toFixed(1)} V/module</small></div>
      <div class="kpi"><span>Max circuit current</span><b>${iMax.toFixed(1)} A</b><small>Isc × 1.25 (690.8(A))</small></div>
      <div class="kpi"><span>Wire / fuse at least</span><b>${iCond.toFixed(1)} A</b><small>× 1.25 again (690.8(B))</small></div>
      <div class="kpi"><span>Array size</span><b>${v.s * v.n}</b><small>${v.s} strings × ${v.n}</small></div>
    </div>` + checks.map(([good, t]) => `<div class="alert ${good ? 'ok' : 'bad'}">${good ? '✓' : '✗'} ${esc(t)}</div>`).join('') +
      '<p class="note">Use spec-sheet values. Example numbers are placeholders. Low temp: use the ASHRAE extreme minimum for the site (690.7(A)). Microinverters: string limits do not apply; check the branch-circuit max per the micro spec sheet.</p>';
  }

  // ---------- 120% rule + electrical tree (NEC 705.12(B)(3)(2)) ----------
  const PANEL_FIELDS = [['bus', 'Busbar rating (A)', 200], ['main', 'Main breaker (A)', 200], ['kw', 'Inverter AC output (kW)', 7.6], ['volts', 'Service voltage (V)', 240], ['bkw', 'Battery inverter (kW, 0 if none)', 0]];
  function panelCalc(el) {
    const p = Object.fromEntries(PANEL_FIELDS.map(([id]) => [id, num(el, 'pc_' + id)]));
    const invA = (p.kw * 1000) / p.volts;
    const batA = (p.bkw * 1000) / p.volts;
    const pvBrk = nextBreaker(invA * 1.25);
    const batBrk = p.bkw > 0 ? nextBreaker(batA * 1.25) : 0;
    const allowed = p.bus * 1.2 - p.main;
    const used = (invA + batA) * 1.25;
    const ok = used <= allowed;
    const downsize = BREAKERS.filter((b) => b < p.main).reverse().find((b) => (invA + batA) * 1.25 <= p.bus * 1.2 - b);
    OpalLog.add('120% rule', `${p.bus}A bus, ${p.main}A main, ${p.kw} kW PV${p.bkw ? ' + ' + p.bkw + ' kW battery' : ''}: ${ok ? 'fits' : 'over'}`);
    const tree = [
      ['Utility', 'Duke Energy service'],
      ['Meter', `${p.volts} V`],
      ['Main panel', `${p.bus} A bus · ${p.main} A main`],
      ['PV breaker', `${pvBrk} A 2-pole (backfeed, opposite end from main)`],
      ['Inverter', `${p.kw} kW · ${invA.toFixed(1)} A continuous`],
    ];
    if (p.bkw > 0) tree.push(['Battery breaker', `${batBrk} A 2-pole · ${p.bkw} kW`]);
    tree.push(['PV array', 'Strings / microinverters (see string calculator)']);
    return `<div class="kpis">
      <div class="kpi"><span>Inverter current</span><b>${invA.toFixed(1)} A</b><small>${p.kw} kW ÷ ${p.volts} V</small></div>
      <div class="kpi"><span>PV breaker</span><b>${pvBrk} A</b><small>125% rounded up</small></div>
      <div class="kpi"><span>Room on bus</span><b>${allowed.toFixed(0)} A</b><small>120% × ${p.bus} − ${p.main}</small></div>
      <div class="kpi"><span>Needed</span><b>${used.toFixed(0)} A</b><small>125% of inverter output</small></div>
    </div>
    <div class="alert ${ok ? 'ok' : 'bad'}">${ok ? '✓ Fits the 120% rule (705.12(B)(3)(2)).' : '✗ Over the 120% rule.' + (downsize ? ` Option: derate main to ${downsize} A (load calc required), supply-side tap, or a panel upgrade.` : ' Options: supply-side tap (705.11) or a panel upgrade.')}</div>
    <h3>Electrical tree</h3><div class="sol-tree">${tree.map(([a, b], i) => `<div class="sol-node" style="margin-left:${Math.min(i, 4) * 18}px"><b>${esc(a)}</b><span>${esc(b)}</span></div>`).join('')}</div>
    <p class="note">Planning aid only. Your licensed electrician confirms against the 2023 NEC + NC amendments and the AHJ.</p>`;
  }

  // ---------- Power flow ----------
  const FLOW_FIELDS = [['sol', 'Solar now (kW)', 6.2], ['load', 'Home use now (kW)', 2.4], ['bat', 'Battery (kW, + = discharging)', 0]];
  function flowSvg(el) {
    const f = Object.fromEntries(FLOW_FIELDS.map(([id]) => [id, num(el, 'pf_' + id)]));
    const grid = f.load - f.sol - f.bat; // + = buying from grid
    const k = (x) => Math.abs(x).toFixed(1) + ' kW';
    const line = (x1, y1, x2, y2, on, rev) => `<line x1="${rev ? x2 : x1}" y1="${rev ? y2 : y1}" x2="${rev ? x1 : x2}" y2="${rev ? y1 : y2}" class="sol-flow ${on ? 'on' : ''}"/>`;
    const node = (x, y, t, v) => `<g><circle cx="${x}" cy="${y}" r="38" class="sol-circ"/><text x="${x}" y="${y - 4}" class="sol-t">${t}</text><text x="${x}" y="${y + 14}" class="sol-v">${v}</text></g>`;
    return `<svg viewBox="0 0 360 300" class="sol-svg" role="img" aria-label="Power flow">
      ${line(180, 60, 180, 150, f.sol > 0.05, false)}
      ${line(60, 150, 180, 150, Math.abs(grid) > 0.05, grid < 0)}
      ${line(180, 150, 300, 150, f.load > 0.05, false)}
      ${line(180, 240, 180, 150, Math.abs(f.bat) > 0.05, f.bat < 0)}
      ${node(180, 52, 'Solar', k(f.sol))}${node(56, 150, grid >= 0 ? 'Grid in' : 'Grid out', k(grid))}
      ${node(304, 150, 'Home', k(f.load))}${node(180, 248, f.bat >= 0 ? 'Battery out' : 'Battery in', k(f.bat))}
      <circle cx="180" cy="150" r="8" fill="var(--red)"/></svg>
      <p class="note">${grid < 0 ? 'Sending ' + k(grid) + ' back to the grid (net metering).' : 'Buying ' + k(grid) + ' from the grid.'} Live numbers come from the Energy Hub on the desktop app.</p>`;
  }

  function fields(prefix, list) {
    return '<div class="sol-form">' + list.map(([id, label, d]) => `<label><span>${esc(label)}</span><input id="${prefix}_${id}" type="number" step="any" value="${d}"></label>`).join('') + '</div>';
  }

  function logHtml() {
    const l = OpalLog.list();
    return (l.length ? '<table><tr><th>When</th><th>What</th><th>Details</th></tr>' + l.slice(0, 100).map((r) => `<tr><td>${esc(new Date(r.when).toLocaleString())}</td><td>${esc(r.kind)}</td><td>${esc(r.text)}</td></tr>`).join('') + '</table>' : '<div class="empty">Nothing logged yet. House lookups and calculations show up here.</div>');
  }

  function mount(el, opts = {}) {
    const open = opts.open || ((u) => window.open(u, '_blank', 'noopener'));
    el.innerHTML = `<div class="sol">
      <div class="sol-tabs" role="tablist">
        <button data-p="apps" class="on">Apps &amp; portals</button><button data-p="str">String calculator</button>
        <button data-p="panel">Panel &amp; tree</button><button data-p="flow">Power flow</button><button data-p="log">Data log</button>
      </div>
      <div data-pane="apps">${appsHtml()}</div>
      <div data-pane="str" hidden>${fields('sc', STR_FIELDS)}<button class="btn" id="scGo">Check strings</button><div id="scOut"></div></div>
      <div data-pane="panel" hidden>${fields('pc', PANEL_FIELDS)}<button class="btn" id="pcGo">Check panel</button><div id="pcOut"></div></div>
      <div data-pane="flow" hidden>${fields('pf', FLOW_FIELDS)}<div id="pfOut"></div></div>
      <div data-pane="log" hidden><div class="row"><button class="btn ghost" id="logCsv">Copy as CSV</button><button class="btn ghost" id="logClear">Clear log</button></div><div id="logOut"></div></div>
    </div>`;
    const panes = el.querySelectorAll('[data-pane]');
    el.querySelectorAll('.sol-tabs button').forEach((b) => b.onclick = () => {
      el.querySelectorAll('.sol-tabs button').forEach((x) => x.classList.toggle('on', x === b));
      panes.forEach((p) => { p.hidden = p.dataset.pane !== b.dataset.p; });
      if (b.dataset.p === 'log') el.querySelector('#logOut').innerHTML = logHtml();
    });
    el.querySelectorAll('.sol-app').forEach((b) => b.onclick = () => { OpalLog.add('Opened app', b.querySelector('b').textContent); open(b.dataset.url); });
    el.querySelector('#scGo').onclick = () => { el.querySelector('#scOut').innerHTML = stringCalc(el); };
    el.querySelector('#pcGo').onclick = () => { el.querySelector('#pcOut').innerHTML = panelCalc(el); };
    const pf = () => { el.querySelector('#pfOut').innerHTML = flowSvg(el); };
    el.querySelectorAll('[id^="pf_"]').forEach((i) => i.addEventListener('input', pf)); pf();
    el.querySelector('#logClear').onclick = () => { OpalLog.clear(); el.querySelector('#logOut').innerHTML = logHtml(); };
    el.querySelector('#logCsv').onclick = async () => {
      try { await navigator.clipboard.writeText(OpalLog.csv()); el.querySelector('#logCsv').textContent = 'Copied'; } catch { el.querySelector('#logCsv').textContent = 'Copy failed'; }
    };
  }

  window.OpalLog = OpalLog;
  window.OpalSolar = { mount, stringCalc, panelCalc };
})();
