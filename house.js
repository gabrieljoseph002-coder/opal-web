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
    try { if (window.OpalLog) window.OpalLog.add('House lookup', addr); } catch {}
    return result;
  }

  function linksFor(p) {
    const q = encodeURIComponent(`${p.siteadd}, ${p.scity}, NC`);
    const L = [['Google Maps', `https://www.google.com/maps/search/?api=1&query=${q}`]];
    if (p.lat) L.push(['Google Sunroof (solar potential)', `https://sunroof.withgoogle.com/building/${p.lat}/${p.lon}/#?f=buy`]);
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
      ${p.lat ? `<a class="roofpic" data-ext="1" href="https://www.google.com/maps/@?api=1&map_action=map&center=${p.lat},${p.lon}&zoom=20&basemap=satellite" target="_blank" rel="noopener"><img alt="Aerial view of the roof" loading="lazy" src="https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/export?bbox=${p.lon - 0.00045},${p.lat - 0.00028},${p.lon + 0.00045},${p.lat + 0.00028}&bboxSR=4326&imageSR=3857&size=640,400&format=jpg&f=image"><span>Roof from above · tap for Google satellite</span></a>` : ''}
      <div class="kpis">
        <div class="kpi"><span>Built</span><b>${y || '-'}</b><small>${age ? age + ' yrs old' : (y ? '' : 'not published by county')}</small></div>
        <div class="kpi"><span>Roof age</span><b>${r.roof ? (r.roof.sure ? '' : '~') + r.roof.age + ' yrs' + (r.roof.sure ? '' : '?') : '-'}</b><small>${r.roof ? esc(r.roof.basis) : 'no data'}</small></div>
        <div class="kpi"><span>Last sold</span><b>${esc((p.saledatetx || '-').slice(0, 10))}</b><small>${p.owntype ? esc(p.owntype) + ' owner' : ''}</small></div>
        <div class="kpi"><span>County value</span><b>$${num(p.parval)}</b><small>house $${num(p.improvval)} · land $${num(p.landval)}</small></div>
        <div class="kpi"><span>Lot</span><b>${p.gisacres != null ? (+p.gisacres).toFixed(2) + ' ac' : '-'}</b><small>${esc(p.parusedsc2 || p.parusedesc || '')}</small></div>
        <div class="kpi"><span>Flood zone</span><b>${r.flood ? esc(r.flood.zone) : '-'}</b><small>${r.flood && r.flood.special ? 'special flood hazard area' : 'FEMA'}</small></div>
      </div>
      <h3>Solar estimate</h3><div class="hs" id="houseSolar"></div>
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
  // ---------- Quick solar sizing (planning estimate, NC numbers) ----------
  // Raleigh-area PVWatts yield: ~1,380 kWh per kW DC per year, south 25° tilt, 14% losses.
  const FACE = { 'South': 1.0, 'South-east / South-west': 0.95, 'East / West': 0.82, 'Mixed (S + E/W)': 0.9 };
  function solarInputs(r) {
    const heated = r.county && +r.county.heated ? +r.county.heated : 2000;
    const attached = /TWNH|TOWN|CONDO|DUPLEX|ATTACH/i.test((r.p.parusedsc2 || '') + ' ' + (r.p.parusedesc || ''));
    const stories = r.permits && r.permits.find((x) => +x.stories) ? +r.permits.find((x) => +x.stories).stories : (attached || heated > 2400 ? 2 : 1);
    return { heated, stories, lotFt: r.p.gisacres ? +r.p.gisacres * 43560 : 0, use: 1100, watts: 430, usable: 45, face: 'Mixed (S + E/W)' };
  }
  function solarCalc(v) {
    // A house can't cover more than ~60% of its lot (keeps townhomes and small lots realistic).
    const footprint = Math.min(v.heated / Math.max(1, v.stories), v.lotFt ? v.lotFt * 0.6 : Infinity);
    const roof = footprint * 1.15 * 1.1; // pitch + overhangs
    const maxPanels = Math.floor((roof * v.usable / 100) / 21);
    const yieldKw = 1380 * (FACE[v.face] || 0.9);
    const yearUse = v.use * 12;
    const opt = (n) => { const kw = n * v.watts / 1000; const kwh = Math.round(kw * yieldKw); return { n, kw, kwh, off: Math.round(kwh / yearUse * 100) }; };
    const forOffset = (f) => Math.min(maxPanels, Math.ceil((yearUse * f) / yieldKw * 1000 / v.watts));
    const rows = [['50% offset', forOffset(0.5)], ['75% offset', forOffset(0.75)], ['100% offset', forOffset(1)], ['Max that fits', maxPanels]]
      .filter((x, i, a) => x[1] > 0 && a.findIndex((y) => y[1] === x[1]) === i).map(([label, n]) => ({ label, ...opt(n) }));
    return { footprint, roof, maxPanels, yieldKw, yearUse, rows };
  }
  function solarHtml(v, c) {
    return `<table><tr><th>Option</th><th>Panels</th><th>System</th><th>Makes / yr</th><th>Covers</th></tr>${c.rows.map((x) => `<tr><td>${esc(x.label)}</td><td>${x.n} × ${v.watts} W</td><td>${x.kw.toFixed(2)} kW</td><td>${num(x.kwh)} kWh</td><td>${x.off}%</td></tr>`).join('')}</table>
      <p class="note">Roof ≈ ${num(Math.round(c.roof))} ft² (footprint ${num(Math.round(c.footprint))} ft²), ${v.usable}% usable after fire-code setbacks and bad faces → up to ${c.maxPanels} panels. ${Math.round(c.yieldKw)} kWh per kW per year (${esc(v.face)}). Planning estimate: confirm in OpenSolar with real roof planes and shade.</p>`;
  }
  function proposalText(r, v, c) {
    const p = r.p;
    const L = ['OPAL SOLUTIONS - SITE DATA FOR DESIGN', '',
      `Address: ${p.siteadd}, ${p.scity}, NC ${p.szip || ''}`, `County: ${p.cntyname} | Parcel: ${p.parno}`,
      `Coordinates: ${p.lat ? p.lat.toFixed(6) + ', ' + p.lon.toFixed(6) : 'n/a'}`,
      `Year built: ${p.structyear || 'unknown'} | Stories (est.): ${v.stories} | Heated area: ${num(v.heated)} sq ft`,
      `Roof age: ${r.roof ? r.roof.age + ' yrs (' + r.roof.basis + ')' : 'unknown'}`,
      `Flood zone: ${r.flood ? r.flood.zone : 'unknown'} | Utility: Duke Energy (verify)`,
      `Existing solar permit: ${r.permits && r.permits.some((x) => x.tag === 'solar') ? 'YES - see permits' : 'none found'}`,
      '', `Usage: ${num(v.use)} kWh/month (${num(c.yearUse)} kWh/yr) | Panel: ${v.watts} W | Roof faces: ${v.face}`,
      `Estimated max panels: ${c.maxPanels} | Yield used: ${Math.round(c.yieldKw)} kWh/kW/yr`, '', 'System options:'];
    c.rows.forEach((x) => L.push(`- ${x.label}: ${x.n} panels, ${x.kw.toFixed(2)} kW DC, ~${num(x.kwh)} kWh/yr, ${x.off}% of usage`));
    if (r.permits && r.permits.length) { L.push('', 'Recent permits:'); r.permits.slice(0, 8).forEach((x) => L.push(`- ${x.date} ${x.type}: ${x.work.slice(0, 90)}`)); }
    L.push('', 'Estimates from public records; verify on site.');
    return L.join(String.fromCharCode(10));
  }
  function mountSolar(box, r, open) {
    if (!box) return;
    const v = solarInputs(r);
    const f = (k, label, step) => `<label><span>${label}</span><input data-k="${k}" type="number" step="${step}" value="${v[k]}"></label>`;
    box.innerHTML = `<div class="hs-form">${f('use', 'Usage kWh / month', 50)}${f('heated', 'Heated ft²', 50)}${f('stories', 'Stories', 1)}${f('watts', 'Panel watts', 5)}${f('usable', 'Usable roof %', 5)}
      <label><span>Roof faces</span><select data-k="face">${Object.keys(FACE).map((k) => `<option${k === v.face ? ' selected' : ''}>${k}</option>`).join('')}</select></label></div>
      <div class="hs-out"></div><div class="row"><button class="btn ghost" data-copy>Copy for OpenSolar / engineer</button><button class="btn ghost" data-os>Open OpenSolar</button><span class="note" data-msg></span></div>`;
    const draw = () => {
      box.querySelectorAll('[data-k]').forEach((i) => { v[i.dataset.k] = i.tagName === 'SELECT' ? i.value : (parseFloat(i.value) || 0); });
      box.querySelector('.hs-out').innerHTML = solarHtml(v, solarCalc(v));
    };
    box.querySelectorAll('[data-k]').forEach((i) => i.addEventListener('input', draw)); draw();
    box.querySelector('[data-copy]').onclick = async () => {
      const t = proposalText(r, v, solarCalc(v));
      try { await navigator.clipboard.writeText(t); box.querySelector('[data-msg]').textContent = 'Copied. Paste into OpenSolar notes or an email to the engineer.'; } catch { box.querySelector('[data-msg]').textContent = 'Copy blocked on this device.'; }
      try { if (window.OpalLog) window.OpalLog.add('Proposal data', r.p.siteadd); } catch {}
    };
    box.querySelector('[data-os]').onclick = () => (open || ((u) => window.open(u, '_blank')))('https://app.opensolar.com/');
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
    el.innerHTML = `<div class="row hs-search"><div class="hs-box"><input id="houseAddr" autocomplete="off" autocorrect="off" spellcheck="false" enterkeyhint="search" placeholder="Start typing an address…"><div class="hs-sug" id="houseSug" role="listbox" hidden></div></div>
      <button class="primary btn" id="houseGo">Look up</button><button class="btn ghost" id="houseHere" title="Look up the house you're standing at">📍 Here</button><button class="btn ghost" id="houseClear">Clear</button></div><div id="houseOut"></div>`;
    const out = el.querySelector('#houseOut'), input = el.querySelector('#houseAddr');
    const show = (r) => { out.innerHTML = html(r) + aiButtons('houseAI'); try { mountSolar(out.querySelector('#houseSolar'), r, opts.open); } catch (e) { console.error(e); } wireAI(out.querySelector('#houseAI'), () => houseBrief(r), opts.open); out.querySelectorAll('[data-ext]').forEach((a) => a.addEventListener('click', (e) => { if (opts.open) { e.preventDefault(); opts.open(a.href); } })); };
    const last = load();
    if (last) { input.value = last.address; show(last); }
    const sug = el.querySelector('#houseSug');
    const hide = () => { sug.hidden = true; sug.innerHTML = ''; };
    const go = async () => {
      hide();
      if (!input.value.trim()) return;
      out.innerHTML = '<p class="sub">Looking up county records, permits and flood maps…</p>';
      try { show(await lookup(input.value)); } catch (e) { out.innerHTML = `<div class="alert warn"><span>${esc(e.message || e)}</span></div>`; }
    };
    el.querySelector('#houseGo').onclick = go;
    input.addEventListener('keydown', (e) => {
      const items = [...sug.querySelectorAll('button')], i = items.indexOf(document.activeElement);
      if (e.key === 'Enter') { e.preventDefault(); go(); }
      else if (e.key === 'ArrowDown' && items.length) { e.preventDefault(); items[0].focus(); }
      else if (e.key === 'Escape') hide();
    });
    sug.addEventListener('keydown', (e) => {
      const items = [...sug.querySelectorAll('button')], i = items.indexOf(document.activeElement);
      if (e.key === 'ArrowDown') { e.preventDefault(); (items[i + 1] || items[i]).focus(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); (i > 0 ? items[i - 1] : input).focus(); }
      else if (e.key === 'Escape') { hide(); input.focus(); }
    });
    let t = null, seq = 0;
    input.addEventListener('input', () => {
      clearTimeout(t);
      const q = input.value, my = ++seq;
      if (q.trim().length < 4) return hide();
      t = setTimeout(async () => {
        let list = [];
        try { list = await suggest(q); } catch {}
        if (my !== seq) return; // a newer keystroke won
        if (!list.length) return hide();
        sug.innerHTML = list.map((x) => `<button type="button" role="option" data-v="${esc(x)}">${esc(x)}</button>`).join('');
        sug.hidden = false;
        sug.querySelectorAll('button').forEach((b) => b.onclick = () => { input.value = tidy(b.dataset.v); go(); });
      }, 220);
    });
    document.addEventListener('click', (e) => { if (!el.querySelector('.hs-box').contains(e.target)) hide(); });
    el.querySelector('#houseHere').onclick = () => {
      if (!navigator.geolocation) { out.innerHTML = '<div class="alert warn"><span>Location isn’t available on this device. Type the address instead.</span></div>'; return; }
      out.innerHTML = '<p class="sub">Finding where you are…</p>';
      navigator.geolocation.getCurrentPosition(async (pos) => {
        try {
          const d = await getJSON(GEO + '/reverseGeocode', { location: `${pos.coords.longitude},${pos.coords.latitude}`, f: 'json', featureTypes: 'PointAddress,StreetAddress' });
          const a = d.address || {};
          if (!a.Address) throw new Error('No street address found here.');
          input.value = `${a.Address}, ${a.City || ''}`.replace(/, $/, '');
          go();
        } catch (e) { out.innerHTML = `<div class="alert warn"><span>${esc(e.message || e)}</span></div>`; }
      }, () => { out.innerHTML = '<div class="alert warn"><span>Location permission was blocked. Allow location for Opal, or type the address.</span></div>'; }, { enableHighAccuracy: true, timeout: 15000 });
    };
    el.querySelector('#houseClear').onclick = () => { try { localStorage.removeItem(KEY); } catch {} input.value = ''; out.innerHTML = ''; hide(); };
  }

  window.OpalHouse = { lookup, html, mount, last: load };
  window.OpalAI = { ask: askAI, buttons: aiButtons, wire: wireAI };
})();
