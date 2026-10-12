// Opal weather: shared by the Opal desktop app, the phone app and the web app.
// National Weather Service (forecast, alerts, radar) + NOAA Storm Prediction Center (damage reports). No keys.
(function () {
  const NWS = 'https://api.weather.gov';
  const HOME = { lat: 35.7796, lon: -78.6382, name: 'Raleigh' };
  const CORE = /^(Wake|Durham|Orange|Chatham|Johnston|Granville|Franklin)$/i;
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const getJSON = async (u) => { const r = await fetch(u, { headers: { Accept: 'application/geo+json' } }); if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); };
  const mph = (s) => { const m = String(s || '').match(/(\d+)(?:\s*to\s*(\d+))?/); return m ? +(m[2] || m[1]) : 0; };
  const icon = (t) => /thunder/i.test(t) ? '⛈️' : /snow|sleet|ice/i.test(t) ? '🌨️' : /rain|shower|drizzle/i.test(t) ? '🌧️' : /fog|haze/i.test(t) ? '🌫️' : /partly|mostly sunny|mostly clear/i.test(t) ? '⛅' : /cloud|overcast/i.test(t) ? '☁️' : /wind/i.test(t) ? '💨' : '☀️';

  function where() {
    return new Promise((res) => {
      if (!navigator.geolocation) return res(HOME);
      navigator.geolocation.getCurrentPosition((p) => res({ lat: +p.coords.latitude.toFixed(4), lon: +p.coords.longitude.toFixed(4), name: 'your location' }), () => res(HOME), { timeout: 6000, maximumAge: 600000 });
    });
  }

  // Can a crew safely work on a roof in the next 8 daylight hours?
  function workCheck(hours) {
    const day = hours.filter((h) => h.isDaytime).slice(0, 8);
    if (!day.length) return { ok: null, text: 'Night time: check again in the morning.' };
    const why = [];
    const maxWind = Math.max(...day.map((h) => mph(h.windSpeed)));
    const maxRain = Math.max(...day.map((h) => (h.probabilityOfPrecipitation && h.probabilityOfPrecipitation.value) || 0));
    const maxTemp = Math.max(...day.map((h) => h.temperature));
    const storm = day.some((h) => /thunder/i.test(h.shortForecast));
    if (storm) why.push('thunderstorms (lightning)');
    if (maxWind >= 25) why.push(`wind up to ${maxWind} mph`);
    if (maxRain >= 50) why.push(`${maxRain}% chance of rain (slick roof)`);
    if (maxTemp >= 98) why.push(`heat ${maxTemp}°F`);
    const caution = [];
    if (!why.length && maxWind >= 15) caution.push(`breezy (${maxWind} mph): watch panels on ladders`);
    if (!why.length && maxRain >= 30) caution.push(`${maxRain}% rain chance`);
    if (!why.length && maxTemp >= 90) caution.push(`hot (${maxTemp}°F): water and shade breaks, hot shingles`);
    if (why.length) return { ok: false, text: 'Not a roof day: ' + why.join(', ') + '.' };
    if (caution.length) return { ok: 'caution', text: 'OK with care: ' + caution.join(', ') + '.' };
    return { ok: true, text: `Good roof day: wind under ${Math.max(maxWind, 5)} mph, rain chance ${maxRain}%, high ${maxTemp}°F.` };
  }

  async function stormReports() {
    const list = [];
    for (const day of ['today', 'yesterday']) for (const kind of ['hail', 'wind', 'torn']) {
      try {
        const csv = await (await fetch(`https://www.spc.noaa.gov/climo/reports/${day}_filtered_${kind}.csv`)).text();
        for (const line of csv.split(/\r?\n/)) {
          const f = line.split(',');
          if (f.length < 7 || f[0] === 'Time' || f[4] !== 'NC') continue;
          list.push({ day, kind, time: f[0], size: f[1], location: f[2], county: f[3], lat: f[5], lon: f[6], comments: f.slice(7).join(',') });
        }
      } catch {}
    }
    const sev = (r) => (r.kind === 'torn' ? 3 : r.kind === 'hail' ? (+r.size >= 100 ? 2 : 1) : (+r.size >= 58 || r.size === 'UNK' ? 1 : 0)) + (CORE.test(r.county) ? 0.5 : 0);
    return list.sort((a, b) => sev(b) - sev(a));
  }

  async function load() {
    const loc = await where();
    const pt = await getJSON(`${NWS}/points/${loc.lat},${loc.lon}`);
    const P = pt.properties;
    const city = P.relativeLocation && P.relativeLocation.properties ? P.relativeLocation.properties.city : loc.name;
    const [daily, hourly, alerts, reports] = await Promise.allSettled([
      getJSON(P.forecast), getJSON(P.forecastHourly), getJSON(`${NWS}/alerts/active?area=NC`), stormReports(),
    ]);
    return {
      city, radar: P.radarStation || 'KRAX', loc,
      daily: daily.status === 'fulfilled' ? daily.value.properties.periods : [],
      hourly: hourly.status === 'fulfilled' ? hourly.value.properties.periods : [],
      alerts: alerts.status === 'fulfilled' ? alerts.value.features.map((f) => f.properties) : [],
      reports: reports.status === 'fulfilled' ? reports.value : [],
    };
  }

  function html(w) {
    const now = w.hourly[0];
    const wc = w.hourly.length ? workCheck(w.hourly) : null;
    const days = [];
    for (let i = 0; i < w.daily.length; i++) {
      const d = w.daily[i];
      if (!d.isDaytime && i > 0) continue;
      const night = w.daily[i + 1] && !w.daily[i + 1].isDaytime ? w.daily[i + 1] : null;
      days.push({ name: i === 0 && !d.isDaytime ? 'Tonight' : d.name.replace(/ Night$/, ''), hi: d.isDaytime ? d.temperature : null, lo: night ? night.temperature : (!d.isDaytime ? d.temperature : null), text: d.shortForecast, rain: (d.probabilityOfPrecipitation && d.probabilityOfPrecipitation.value) || 0, wind: d.windSpeed });
    }
    const sevClass = (s) => (/extreme|severe/i.test(s) ? 'bad' : /moderate/i.test(s) ? 'warn' : 'ok');
    const kindName = { hail: 'Hail', wind: 'Wind', torn: 'Tornado' };
    return `<div class="wx">
      ${now ? `<div class="wx-now">
        <div class="wx-big">${icon(now.shortForecast)}<b>${now.temperature}°</b></div>
        <div class="wx-now-txt"><b>${esc(now.shortForecast)}</b><span>${esc(w.city)} · wind ${esc(now.windSpeed)} ${esc(now.windDirection)} · rain ${(now.probabilityOfPrecipitation && now.probabilityOfPrecipitation.value) || 0}%</span></div>
      </div>` : ''}
      ${wc ? `<div class="wx-work ${wc.ok === true ? 'good' : wc.ok === false ? 'no' : 'maybe'}"><b>${wc.ok === true ? '✓ Roof day' : wc.ok === false ? '✕ No roof work' : '! Use caution'}</b><span>${esc(wc.text)}</span></div>` : ''}
      <div class="wx-hours">${w.hourly.slice(0, 12).map((h) => `<div class="wx-hour"><span>${new Date(h.startTime).toLocaleTimeString([], { hour: 'numeric' })}</span><i>${icon(h.shortForecast)}</i><b>${h.temperature}°</b><small>${(h.probabilityOfPrecipitation && h.probabilityOfPrecipitation.value) || 0}%</small></div>`).join('')}</div>
      <h3>7-day forecast</h3>
      <div class="wx-days">${days.slice(0, 7).map((d) => `<div class="wx-day"><span>${esc(d.name.slice(0, 3))}</span><i>${icon(d.text)}</i><b>${d.hi ?? '–'}°<small> / ${d.lo ?? '–'}°</small></b><small>${esc(d.text)}</small><small>${d.rain ? '💧' + d.rain + '%' : ''}</small></div>`).join('')}</div>
      <h3>NC weather alerts (${w.alerts.length})</h3>
      ${w.alerts.length ? w.alerts.slice(0, 12).map((a) => `<div class="alert ${sevClass(a.severity)}"><span><b>${esc(a.event)}</b> · ${esc((a.areaDesc || '').slice(0, 140))}<br><small>${esc(a.headline || '')}</small></span></div>`).join('') : '<p class="sub">No active watches or warnings in North Carolina.</p>'}
      <h3>Live radar (${esc(w.radar)})</h3>
      <img class="wx-radar" alt="NWS radar loop" src="https://radar.weather.gov/ridge/standard/${esc(w.radar)}_loop.gif?t=${Date.now() / 300000 | 0}">
      <h3>Storm damage reports (NC, today + yesterday)</h3>
      <div id="wxReports">${w.reports.length ? w.reports.map((r, i) => `<div class="wx-rep"><span class="tag ${r.kind === 'torn' || CORE.test(r.county) ? 'hot' : ''}">${kindName[r.kind]}</span>
        <div><b>${esc(r.location)}, ${esc(r.county)} Co.${CORE.test(r.county) ? ' ★' : ''}</b><small>${r.day} ${esc(r.time)}Z · ${r.kind === 'hail' ? (+r.size / 100).toFixed(2) + '" hail' : r.kind === 'wind' ? (r.size === 'UNK' ? 'wind damage' : esc(r.size) + ' mph') : 'tornado'} · ${esc(r.comments.slice(0, 110))}</small></div>
        <button class="btn ghost" data-wxmap="${i}">Map</button></div>`).join('') : '<p class="sub">No hail, wind or tornado reports in NC today or yesterday.</p>'}</div>
      <p class="note">★ = Opal core county. Hail 1"+ or wind 58 mph+ often means roof and panel damage: inspections, removal & reinstall, critter guard. Sources: National Weather Service, NOAA Storm Prediction Center.</p>
    </div>`;
  }

  function stormBrief(w) {
    const L = ['I run Opal Solutions (solar, battery, electrical service) in Raleigh-Durham NC. Core counties: Wake, Durham, Orange, Chatham, Johnston, Granville, Franklin.',
      'Using this weather data: 1) which storm-hit areas should we target for roof/solar damage checks, inspections and removal & reinstall jobs, ranked with reasons, 2) a short outreach plan (door-knocking with permits; no robocalls/texts without consent), 3) which days this week are safe for roof work.', ''];
    if (w.reports.length) { L.push('Storm reports:'); w.reports.slice(0, 40).forEach((r) => L.push(`- ${r.day} ${r.time}Z ${r.kind} ${r.size || ''} at ${r.location}, ${r.county} County: ${r.comments.slice(0, 100)}`)); }
    if (w.alerts.length) { L.push('Active alerts:'); w.alerts.slice(0, 10).forEach((a) => L.push(`- ${a.event}: ${(a.areaDesc || '').slice(0, 120)}`)); }
    if (w.daily.length) { L.push('Forecast:'); w.daily.slice(0, 10).forEach((d) => L.push(`- ${d.name}: ${d.temperature}°F, ${d.shortForecast}, wind ${d.windSpeed}`)); }
    return L.join(String.fromCharCode(10));
  }

  // opts.open(url) opens links in-app; opts.map(lat, lon, label) opens a map.
  function mount(el, opts = {}) {
    el.innerHTML = '<div class="row"><button class="btn" id="wxRefresh">Refresh</button><span class="sub" id="wxWhen"></span></div><div id="wxOut"><p class="sub">Loading weather…</p></div>';
    const out = el.querySelector('#wxOut');
    const go = async () => {
      out.innerHTML = '<p class="sub">Loading weather…</p>';
      try {
        const w = await load();
        out.innerHTML = html(w) + (window.OpalAI ? window.OpalAI.buttons('wxAI') : '');
        el.querySelector('#wxWhen').textContent = 'Updated ' + new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
        out.querySelectorAll('[data-wxmap]').forEach((b) => b.addEventListener('click', () => { const r = w.reports[b.dataset.wxmap]; if (opts.map) opts.map(r.lat, r.lon, r.location); }));
        if (window.OpalAI) window.OpalAI.wire(out.querySelector('#wxAI'), () => stormBrief(w), opts.open);
      } catch (e) { out.innerHTML = `<div class="alert warn"><span>Weather service didn't answer (${esc(e.message || e)}). Try Refresh.</span></div>`; }
    };
    el.querySelector('#wxRefresh').onclick = go;
    let loaded = false;
    return { load: () => { if (!loaded) { loaded = true; go(); } }, refresh: go };
  }

  window.OpalWeather = { load, html, mount, workCheck };
})();
