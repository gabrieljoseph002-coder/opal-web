// Opal house lookup: shared by the Opal desktop app, the phone app and the Energy Hub.
// Sources (all public, no keys): NC OneMap parcels (every NC county), City of Raleigh permits, FEMA flood zones.
// The last lookup is saved on the device and stays on screen until "Clear".
(function () {
  const PARCELS = 'https://services.nconemap.gov/secure/rest/services/NC1Map_Parcels/FeatureServer/1/query';
  const RALEIGH = 'https://services.arcgis.com/v400IkDOw1ad7Yad/ArcGIS/rest/services';
  const FEMA = 'https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer/28/query';
  const SUF = { STREET: 'ST', ROAD: 'RD', DRIVE: 'DR', CIRCLE: 'CIR', LANE: 'LN', AVENUE: 'AVE', COURT: 'CT', PLACE: 'PL', BOULEVARD: 'BLVD', TRAIL: 'TRL', PARKWAY: 'PKWY', TERRACE: 'TER', HIGHWAY: 'HWY', NORTH: 'N', SOUTH: 'S', EAST: 'E', WEST: 'W' };
  const SOLAR = /solar|photo ?volt|\bpv\b|battery|powerwall|energy storage|\bess\b|inverter/i;
  const ELEC = /service (upgrade|change)|\bpanel\b|\d+ ?amp|generator|ev charg|meter base|rewir|electric/i;
  const ROOF = /roof|reroof|shingle/i;
  const KEY = 'opal.house.last';
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const num = (n) => (n == null || n === '' ? '-' : Number(n).toLocaleString('en-US', { maximumFractionDigits: 0 }));
  const save = (v) => { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch {} };
  const load = () => { try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { return null; } };
  const day = (ms) => (ms ? new Date(ms).toISOString().slice(0, 10) : '');

  function parseAddr(text) {
    const raw = String(text || '').toUpperCase().split(',');
    const street = raw[0].replace(/[^A-Z0-9 ]/g, ' ').split(/\s+/).filter(Boolean).map((w) => SUF[w] || w).join(' ');
    const city = (raw[1] || '').replace(/[^A-Z ]/g, '').trim();
    return { street, city };
  }
  async function getJSON(url, params, ms = 15000) {
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), ms);
    const full = url + '?' + new URLSearchParams(params);
    if (window.opal && window.opal.fetchJSON) { // desktop app: let the app fetch (no browser CORS limits)
      try { return await Promise.race([window.opal.fetchJSON(full), new Promise((_, no) => setTimeout(() => no(new Error('timed out')), ms))]); }
      finally { clearTimeout(t); }
    }
    let r;
    try { r = await fetch(full, { signal: ctl.signal }); }
    catch (e) { throw new Error(e.name === 'AbortError' ? 'timed out' : 'network error'); }
    finally { clearTimeout(t); }
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.json();
  }

  async function parcel(addr) {
    const { street, city } = parseAddr(addr);
    if (!street) throw new Error('Type the street number and name, then a comma and the city.');
    const where = `siteadd = '${street.replace(/'/g, '')}'` + (city ? ` AND scity = '${city}'` : '');
    const d = await getJSON(PARCELS, { where, outFields: 'parno,nparno,siteadd,scity,szip,cntyname,structyear,struct,multistruc,structno,parval,improvval,landval,parvaltype,saledatetx,saledate,gisacres,parusedsc2,parusedesc,owntype,subdivisio,revdatetx', returnGeometry: 'true', outSR: '4326', resultRecordCount: '3', f: 'json' });
    const f = d.features && d.features[0];
    if (!f) throw new Error('Not found in NC county records. Use the street number and name, then the city (e.g. "2708 Saltaire Ave, Durham").');
    let lat = null, lon = null;
    const ring = f.geometry && f.geometry.rings && f.geometry.rings[0];
    if (ring && ring.length) { lon = ring.reduce((s, p) => s + p[0], 0) / ring.length; lat = ring.reduce((s, p) => s + p[1], 0) / ring.length; }
    return { ...f.attributes, lat, lon };
  }

  async function raleighPermits(pin, street) {
    const rows = [];
    const pinClean = String(pin || '').replace(/[^0-9A-Za-z]/g, '');
    const st = String(street || '').replace(/'/g, '').toUpperCase();
    const where = [pinClean && `pin='${pinClean}'`, st && `upper(originaladdress1)='${st}'`].filter(Boolean).join(' OR ');
    let ok = 0;
    for (const [kind, layer, extra, w] of [['Building', 'Building_Permits', ',estprojectcost', where], ['Trade', 'Permits_Other_Than_Buildings', '', pinClean ? `pin='${pinClean}'` : where]]) {
      let d;
      try { d = await getJSON(`${RALEIGH}/${layer}/FeatureServer/0/query`, { where: w, outFields: 'permitnum,issueddate,permittype,description,proposedworkdescription,contractorcompanyname,numberstories,statuscurrentmapped' + extra, returnGeometry: 'false', f: 'json' }, 25000); }
      catch { continue; }
      if (!d || d.error) continue;
      ok++;
      for (const ft of d.features || []) {
        const a = ft.attributes, text = `${a.description || ''} ${a.proposedworkdescription || ''} ${a.permittype || ''}`;
        rows.push({ date: day(a.issueddate), type: (a.permittype || kind), work: (a.proposedworkdescription || a.description || '').trim(), by: (a.contractorcompanyname || '').trim(), cost: a.estprojectcost || null, stories: a.numberstories || null,
          tag: SOLAR.test(text) ? 'solar' : ROOF.test(text) ? 'roof' : ELEC.test(text) ? 'electrical' : '' });
      }
    }
    if (!ok) throw new Error('Raleigh permits unavailable');
    const seen = new Set();
    return rows.sort((a, b) => (a.date < b.date ? 1 : -1)).filter((r) => { const k = r.date + r.work.slice(0, 30); if (seen.has(k)) return false; seen.add(k); return true; });
  }

  const DURHAM = 'https://services2.arcgis.com/G5vR3cOjh6g2Ed8E/ArcGIS/rest/services/Parcels_NEW/FeatureServer/0/query';
  async function durham(siteadd) {
    const d = await getJSON(DURHAM, { where: `LOCATION_ADDR='${String(siteadd).replace(/'/g, '')}'`, outFields: 'HEATED_AREA,PERMIT_DATE,PERMIT_NUMBER,ZONING,PKG_SALE_DATE,PKG_SALE_PRICE,NEIGHBORHOOD,HISTORIC_VALUE_DEFERRED', returnGeometry: 'false', f: 'json' });
    const a = d.features && d.features[0] && d.features[0].attributes;
    return a ? { heated: a.HEATED_AREA, zoning: a.ZONING, salePrice: a.PKG_SALE_PRICE, saleDate: day(a.PKG_SALE_DATE), neighborhood: a.NEIGHBORHOOD, lastPermit: a.PERMIT_DATE ? day(a.PERMIT_DATE) + (a.PERMIT_NUMBER ? ' #' + a.PERMIT_NUMBER : '') : '', historic: a.HISTORIC_VALUE_DEFERRED > 0 } : null;
  }

  async function flood(lat, lon) {
    const d = await getJSON(FEMA, { geometry: `${lon},${lat}`, geometryType: 'esriGeometryPoint', inSR: '4326', spatialRel: 'esriSpatialRelIntersects', outFields: 'FLD_ZONE,ZONE_SUBTY,SFHA_TF', returnGeometry: 'false', f: 'json' });
    const a = d.features && d.features[0] && d.features[0].attributes;
    return a ? { zone: a.FLD_ZONE, sub: a.ZONE_SUBTY, special: a.SFHA_TF === 'T' } : { zone: 'Not mapped / minimal', special: false };
  }

  function roofEstimate(year, permits) {
    const roofP = permits.find((p) => p.tag === 'roof');
    const now = new Date().getFullYear();
    if (roofP) { const age = now - +roofP.date.slice(0, 4); return { age, basis: `roof permit ${roofP.date}${roofP.by ? ' by ' + roofP.by : ''}`, sure: true }; }
    if (!year) return null;
    const age = now - year;
    // Asphalt shingles last ~20-25 years in NC; an older house has likely been reroofed at least once.
    const est = age <= 22 ? age : age % 22;
    return { age: est, basis: age <= 22 ? 'original roof (from year built)' : `estimate: likely reroofed, original house ${age} yrs old (no roof permit on file)`, sure: false };
  }

  function watchFor(p, roof, permits, fz) {
    const out = [], y = +p.structyear || 0;
    if (roof && !roof.sure && (+p.structyear || 0) && new Date().getFullYear() - +p.structyear > 22) {
      out.push(['warn', `Roof age unknown: no roof permit on file and the house is ${new Date().getFullYear() - +p.structyear} yrs old, so it has likely been reroofed at least once. Inspect the shingles (granule loss, curling, soft decking) before quoting solar.`]);
    } else if (roof) {
      if (roof.age >= 18) out.push(['bad', `Roof about ${roof.age} yrs old: shingles near end of life (20-25 yrs). Plan for reroof before or with solar; R&R likely if solar goes on now.`]);
      else if (roof.age >= 12) out.push(['warn', `Roof about ${roof.age} yrs old: check shingle condition; may need replacing during the solar system's life.`]);
      else out.push(['ok', `Roof about ${roof.age} yrs old: good for solar.`]);
    }
    if (y && y <= 1990) out.push(['warn', 'Built 1990 or earlier: check for FPE/Zinsco panels, small service (100A or less), water-pipe-only grounding.']);
    if (y >= 1965 && y <= 1973) out.push(['bad', 'Built 1965-1973: possible aluminum branch wiring. Inspect before any electrical work.']);
    if (y && y < 1978) out.push(['warn', 'Built before 1978: possible lead paint; use lead-safe practices when drilling or cutting.']);
    if (y && y < 1950) out.push(['warn', 'Built before 1950: possible knob-and-tube wiring and rafters that need a structural check.']);
    if (+p.structno > 1 || p.multistruc === 'Y') out.push(['ok', `${p.structno || 'Multiple'} structures on the lot: detached garage or shed could host panels or a battery.`]);
    const sol = permits.filter((x) => x.tag === 'solar');
    if (sol.length) { const s = sol[sol.length - 1]; out.push(['ok', `Solar already permitted ${s.date}${s.by ? ' by ' + s.by : ''}. Warranty and monitoring may still be with that installer.`]); }
    if (p.__county && p.__county.historic) out.push(['bad', 'Historic property (deferred value): solar visible from the street may need historic commission approval.']);
    if (fz && fz.special) out.push(['bad', `FEMA flood zone ${fz.zone}: equipment height and disconnect location rules apply; flood insurance likely required.`]);
    return out;
  }

  async function lookup(addr) {
    const p = await parcel(addr);
    const result = { address: addr, when: new Date().toISOString(), p, permits: [], permitNote: '', flood: null };
    const isRaleigh = /RALEIGH/i.test(p.scity || '');
    if (!isRaleigh) result.permitNote = `Live permit history is wired for the City of Raleigh. For ${p.cntyname || 'this'} County, use the permit portal link below.`;
    // Run the extra sources side by side; any one failing or slow doesn't block the others.
    const [perm, fz, cty] = await Promise.allSettled([
      isRaleigh ? raleighPermits(p.parno, p.siteadd) : Promise.resolve([]),
      p.lat ? flood(p.lat, p.lon) : Promise.resolve(null),
      /DURHAM/i.test(p.cntyname || '') ? durham(p.siteadd) : Promise.resolve(null),
    ]);
    if (perm.status === 'fulfilled') result.permits = perm.value; else result.permitNote = "Couldn't reach Raleigh permit records right now.";
    result.flood = fz.status === 'fulfilled' ? fz.value : null;
    result.county = cty.status === 'fulfilled' ? cty.value : null;
    if (result.county && result.county.lastPermit) result.permitNote = `Durham County's latest permit on this parcel: ${result.county.lastPermit}. Full history in the Durham permit portal below.`;
    result.roof = roofEstimate(+p.structyear || 0, result.permits);
    p.__county = result.county;
    result.watch = watchFor(p, result.roof, result.permits, result.flood);
    delete p.__county;
    save(result);
    return result;
  }

  function linksFor(p) {
    const q = encodeURIComponent(`${p.siteadd}, ${p.scity}, NC`);
    const L = [['Google Maps', `https://www.google.com/maps/search/?api=1&query=${q}`]];
    if (p.lat) L.push(['Street View', `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${p.lat},${p.lon}`]);
    const c = (p.cntyname || '').toUpperCase();
    if (c === 'WAKE') L.push(['Wake real estate record', `https://services.wake.gov/realestate/Account.asp?id=&stype=addr&stnum=&stname=${encodeURIComponent(p.siteadd || '')}`], ['Raleigh permit portal', 'https://permitportal.raleighnc.gov'], ['Wake permits', 'https://www.wake.gov/departments-government/permits-inspections']);
    if (c === 'DURHAM') L.push(['Durham tax record', 'https://property.spatialest.com/nc/durham'], ['Durham permits', 'https://www.durhamnc.gov/1086/Building-Permits']);
    if (c === 'ORANGE') L.push(['Orange County permits', 'https://www.orangecountync.gov/1004/Permits-Inspections']);
    if (c === 'MECKLENBURG') L.push(['Mecklenburg permits', 'https://www.mecknc.gov/LUESA/CodeEnforcement']);
    return L;
  }

  function html(r) {
    if (!r) return '';
    const p = r.p, y = +p.structyear || null, age = y ? new Date().getFullYear() - y : null;
    const tag = (t) => (t ? `<span class="pill ${t === 'solar' ? 'ok' : t === 'roof' ? 'warn' : ''}">${esc(t)}</span>` : '');
    return `<div class="house">
      <div class="house-head"><b>${esc(p.siteadd)}, ${esc(p.scity)} ${esc(p.szip || '')}</b><span>${esc(p.cntyname)} County · parcel ${esc(p.parno)} · looked up ${esc(r.when.slice(0, 16).replace('T', ' '))}</span></div>
      <div class="kpis">
        <div class="kpi"><span>Built</span><b>${y || '-'}</b><small>${age ? age + ' yrs old' : (y ? '' : 'not published by county')}</small></div>
        <div class="kpi"><span>Roof age</span><b>${r.roof ? (r.roof.sure ? '' : '~') + r.roof.age + ' yrs' + (r.roof.sure ? '' : '?') : '-'}</b><small>${r.roof ? esc(r.roof.basis) : 'no data'}</small></div>
        <div class="kpi"><span>Last sold</span><b>${esc((p.saledatetx || '-').slice(0, 10))}</b><small>${p.owntype ? esc(p.owntype) + ' owner' : ''}</small></div>
        <div class="kpi"><span>County value</span><b>$${num(p.parval)}</b><small>house $${num(p.improvval)} · land $${num(p.landval)}</small></div>
        <div class="kpi"><span>Lot</span><b>${p.gisacres != null ? (+p.gisacres).toFixed(2) + ' ac' : '-'}</b><small>${esc(p.parusedsc2 || p.parusedesc || '')}</small></div>
        <div class="kpi"><span>Flood zone</span><b>${r.flood ? esc(r.flood.zone) : '-'}</b><small>${r.flood && r.flood.special ? 'special flood hazard area' : 'FEMA'}</small></div>
      </div>
      ${r.county ? `<div class="kpis">
        <div class="kpi"><span>Heated area</span><b>${num(r.county.heated)} ft²</b></div>
        <div class="kpi"><span>Zoning</span><b>${esc(r.county.zoning || '-')}</b></div>
        <div class="kpi"><span>Sale price</span><b>${r.county.salePrice ? '$' + num(r.county.salePrice) : '-'}</b><small>${esc(r.county.saleDate || '')}</small></div>
        <div class="kpi"><span>Neighborhood</span><b style="font-size:13px">${esc(r.county.neighborhood || '-')}</b></div></div>` : ''}
      ${p.subdivisio ? `<p class="sub">Subdivision: ${esc(p.subdivisio)}${p.structno ? ' · ' + esc(p.structno) + ' structure(s)' : ''}</p>` : ''}
      <h3>Watch for</h3>${(r.watch || []).map(([lvl, t]) => `<div class="alert ${lvl}"><span>${esc(t)}</span></div>`).join('') || '<p class="sub">Nothing to flag.</p>'}
      <h3>Permit history</h3>${r.permits.length ? `<table><tr><th>Date</th><th>Type</th><th>Work</th><th>By</th></tr>${r.permits.slice(0, 40).map((x) => `<tr><td>${esc(x.date)}</td><td>${esc(x.type)} ${tag(x.tag)}</td><td>${esc(x.work.slice(0, 120))}</td><td>${esc(x.by)}</td></tr>`).join('')}</table>` : `<p class="sub">${esc(r.permitNote || 'No permits on file (outside city limits, or work never permitted).')}</p>`}
      <div class="links">${linksFor(p).map(([t, u]) => `<a href="${esc(u)}" data-ext="1">${esc(t)}</a>`).join('')}</div>
      <p class="note">County tax records (NC OneMap), City of Raleigh permits, FEMA flood maps. Roof age without a roof permit is an estimate. These are things to check, not findings.</p>
    </div>`;
  }

  const GEO = 'https://geocode.arcgis.com/arcgis/rest/services/World/GeocodeServer';
  async function suggest(text) {
    if (!text || text.length < 4) return [];
    const d = await getJSON(GEO + '/suggest', { text, f: 'json', countryCode: 'USA', category: 'Address', location: '-78.8,35.85', maxSuggestions: '6' });
    return (d.suggestions || []).filter((x) => /, NC|North Carolina/i.test(x.text)).map((x) => x.text);
  }
  function tidy(t) { // "123 Main St, Raleigh, North Carolina, 27601" -> "123 Main St, Raleigh"
    const parts = String(t).split(',').map((x) => x.trim());
    return parts.length >= 2 ? parts[0] + ', ' + parts[1] : t;
  }


  // ---------- Ask AI (Claude / ChatGPT / Gemini) with the data on screen ----------
  const AI_URL = {
    claude: (q) => 'https://claude.ai/new?q=' + encodeURIComponent(q),
    chatgpt: (q) => 'https://chatgpt.com/?q=' + encodeURIComponent(q),
    gemini: () => 'https://gemini.google.com/app',
  };
  async function askAI(target, text, open) {
    const q = text.length > 6000 ? text.slice(0, 6000) + ' [trimmed]' : text;
    if (target === 'gemini') { try { await navigator.clipboard.writeText(q); } catch {} }
    const url = AI_URL[target](q);
    if (open) open(url); else window.open(url, '_blank');
    return target === 'gemini' ? 'Question copied. Paste it into Gemini (long-press > Paste).' : '';
  }
  function aiButtons(id) {
    return `<div class="ai-row" id="${id}"><span class="sub">Ask AI about this:</span>
      <button class="btn ghost" data-ai="claude">Claude</button><button class="btn ghost" data-ai="chatgpt">ChatGPT</button><button class="btn ghost" data-ai="gemini">Gemini</button><span class="sub ai-msg"></span></div>`;
  }
  function wireAI(el, getText, open) {
    el.querySelectorAll('[data-ai]').forEach((b) => b.addEventListener('click', async () => {
      const msg = await askAI(b.dataset.ai, getText(), open);
      const m = el.querySelector('.ai-msg'); if (m) m.textContent = msg;
    }));
  }
  function houseBrief(r) {
    const p = r.p;
    const lines = [
      'I run Opal Solutions, a solar, battery and electrical service company in the Raleigh-Durham, NC area.',
      'Using the public records below, tell me: 1) the biggest risks for solar, battery or electrical work at this house, 2) what to inspect on site, 3) which of our services fit (solar install, removal & reinstall, battery, panel upgrade, EV charger, cleaning, critter guard), and 4) anything that should change the quote. Be specific and brief.',
      '',
      `Address: ${p.siteadd}, ${p.scity}, NC (${p.cntyname} County)`,
      `Year built: ${p.structyear || 'unknown'}; lot ${p.gisacres ? (+p.gisacres).toFixed(2) + ' ac' : '?'}; use: ${p.parusedsc2 || p.parusedesc || '?'}; structures: ${p.structno || '?'}`,
      `County value $${num(p.parval)} (house $${num(p.improvval)}); last sold ${String(p.saledatetx || '?').slice(0, 10)}`,
      `Roof age: ${r.roof ? r.roof.age + ' yrs (' + r.roof.basis + ')' : 'unknown'}`,
      `Flood zone: ${r.flood ? r.flood.zone + (r.flood.special ? ' (special flood hazard area)' : '') : 'unknown'}`,
    ];
    if (r.county) lines.push(`Heated area ${num(r.county.heated)} sq ft; zoning ${r.county.zoning || '?'}; sale price $${num(r.county.salePrice)}`);
    if (r.permits && r.permits.length) { lines.push('Permits:'); r.permits.slice(0, 15).forEach((x) => lines.push(`- ${x.date} ${x.type}${x.tag ? ' [' + x.tag + ']' : ''}: ${x.work.slice(0, 100)}${x.by ? ' (' + x.by + ')' : ''}`)); }
    else lines.push('Permits: ' + (r.permitNote || 'none on file'));
    if (r.watch && r.watch.length) { lines.push('Flags already noted:'); r.watch.forEach(([, t]) => lines.push('- ' + t)); }
    return lines.join(String.fromCharCode(10));
  }

  // Mounts the lookup into a container. opts.open(url) opens links (app window / in-app browser).
  function mount(el, opts = {}) {
    el.innerHTML = `<div class="row"><input id="houseAddr" list="houseSug" autocomplete="off" placeholder="Start typing an address…" style="flex:1 1 280px"><datalist id="houseSug"></datalist>
      <button class="primary btn" id="houseGo">Look up</button><button class="btn ghost" id="houseClear">Clear</button></div><div id="houseOut"></div>`;
    const out = el.querySelector('#houseOut'), input = el.querySelector('#houseAddr');
    const show = (r) => { out.innerHTML = html(r) + aiButtons('houseAI'); wireAI(out.querySelector('#houseAI'), () => houseBrief(r), opts.open); out.querySelectorAll('[data-ext]').forEach((a) => a.addEventListener('click', (e) => { if (opts.open) { e.preventDefault(); opts.open(a.href); } })); };
    const last = load();
    if (last) { input.value = last.address; show(last); }
    const go = async () => {
      if (!input.value.trim()) return;
      out.innerHTML = '<p class="sub">Looking up county records, permits and flood maps…</p>';
      try { show(await lookup(input.value)); } catch (e) { out.innerHTML = `<div class="alert warn"><span>${esc(e.message || e)}</span></div>`; }
    };
    el.querySelector('#houseGo').onclick = go;
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
    let t = null;
    const dl = el.querySelector('#houseSug');
    input.addEventListener('input', () => {
      clearTimeout(t);
      if (dl.querySelector(`option[value="${CSS.escape(input.value)}"]`)) { input.value = tidy(input.value); go(); return; }
      t = setTimeout(async () => { try { dl.innerHTML = (await suggest(input.value)).map((x) => `<option value="${esc(x)}">`).join(''); } catch {} }, 250);
    });
    el.querySelector('#houseClear').onclick = () => { try { localStorage.removeItem(KEY); } catch {} input.value = ''; out.innerHTML = ''; };
  }

  window.OpalHouse = { lookup, html, mount, last: load };
  window.OpalAI = { ask: askAI, buttons: aiButtons, wire: wireAI };
})();
