// Opal mobile: navigation + native Wi-Fi (Android) and Bluetooth LE (Android + iOS) scanning.
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const Cap = window.Capacitor;
const P = (Cap && Cap.Plugins) || {};
const platform = Cap ? Cap.getPlatform() : 'web';

document.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => {
  document.querySelectorAll('nav [data-tab]').forEach((x) => x.classList.toggle('on', x === b));
  document.querySelectorAll('section').forEach((s) => s.classList.toggle('active', s.id === b.dataset.tab));
}));
document.querySelectorAll('[data-go]').forEach((b) => b.addEventListener('click', () => { location.href = b.dataset.go; }));
document.querySelectorAll('[data-url]').forEach((b) => b.addEventListener('click', () => {
  if (P.Browser) P.Browser.open({ url: b.dataset.url, toolbarColor: '#111111' }); else window.open(b.dataset.url, '_blank');
}));

const SSIDS = [
  [/^TEG-/i, 'Tesla Gateway 2 / Backup Gateway', 'Password on the sticker behind the gateway door.', 1],
  [/^TeslaPW_/i, 'Tesla Powerwall 3', 'Join it, then the hub reaches 192.168.91.1. Password on the QR sticker.', 1],
  [/^Envoy[_-]?/i, 'Enphase IQ Gateway (setup mode)', 'Turned on with the AP button.', 1],
  [/^SEDG-|^SolarEdge/i, 'SolarEdge inverter (SetApp)', 'Password on the inverter label.', 1],
  [/^SMA\d|^SMA[-_ ]/i, 'SMA inverter', 'Password on the type label.', 1],
  [/^FRONIUS_/i, 'Fronius inverter', 'Join it, then open 192.168.250.181.', 1],
  [/PWRcell|PWRview|Generac/i, 'Generac PWRcell / PWRview', '', 1],
  [/^Franklin|aGate/i, 'FranklinWH aGate', '', 1],
  [/SOLIX|Anker|EcoFlow|Jackery|BLUETTI/i, 'Power station / home battery', '', 1],
  [/^Emporia|^Sense[-_ ]|^SPAN/i, 'Energy monitor / smart panel', '', 1],
  [/Wallbox|JuiceBox|ChargePoint|WallConnector|Grizzl/i, 'EV charger', '', 1],
  [/^DIRECT-/i, 'Printer (Wi-Fi Direct)', '', 0],
  [/xfinity|spectrum|\bATT|NETGEAR|Linksys|TP-Link|\beero|Orbi|ASUS|Verizon|Fios|_EXT$/i, 'Home router / extender', '', 0],
  [/iPhone|Galaxy|Pixel|Android|Hotspot/i, 'Phone hotspot', '', 0],
  [/\b(Roku|Chromecast|FireTV|Sonos|HP-Setup|Ring|ecobee|Nest|Wyze|Blink|Arlo)/i, 'Smart home device', '', 0],
];
const BTS = [
  [/Tesla|Powerwall|TEG/i, 'Tesla energy gear', 1], [/Envoy|Enphase|IQ ?Battery/i, 'Enphase', 1], [/SolarEdge|SEDG/i, 'SolarEdge', 1],
  [/SMA|Sunny/i, 'SMA inverter', 1], [/Fronius/i, 'Fronius', 1], [/Generac|PWRcell/i, 'Generac', 1], [/Franklin|aGate|aPower/i, 'FranklinWH', 1],
  [/Victron|SmartShunt|MPPT/i, 'Victron', 1], [/Renogy|BT-?[12]\b/i, 'Renogy', 1], [/EcoFlow|Jackery|BLUETTI|SOLIX|Anker/i, 'Power station', 1],
  [/ChargePoint|JuiceBox|Wallbox|Grizzl|Emporia|Wall ?Connector/i, 'EV charger', 1], [/Sense|SPAN/i, 'Energy monitor', 1],
  [/Fluke|Klein|UNI-?T|Owon/i, 'Test meter', 1], [/AirPods|Buds|Beats|Bose|JBL|Soundcore/i, 'Earbuds / speaker', 0],
  [/AirTag|Tile|SmartTag|Chipolo/i, 'Tracker tag', 0], [/iPhone|iPad|Galaxy|Pixel|Watch/i, 'Phone / watch', 0],
];
const what = (list, n) => { for (const r of list) if (r[0].test(n || '')) return { what: r[1], tip: r.length > 3 ? r[2] : '', solar: !!r[r.length - 1] }; return { what: 'Unknown', tip: '', solar: false }; };
// Rough distance from Bluetooth signal strength (typical 1 m reference of -59 dBm)
const feet = (rssi) => rssi ? Math.round(3.28 * Math.pow(10, (-59 - rssi) / 20)) : null;

function wifiRows(nets) {
  return nets.map((n) => ({ ...n, ...what(SSIDS, n.ssid) })).sort((a, b) => b.solar - a.solar || (b.level || -200) - (a.level || -200))
    .map((r) => `<div class="item"><span class="tag ${r.solar ? 'solar' : ''}">${r.solar ? 'solar' : 'wi-fi'}</span>
      <div class="name"><b>${esc(r.ssid || '(hidden network)')}</b><span>${esc(r.what)}${r.tip ? ' · ' + esc(r.tip) : ''}</span></div>
      <span class="sig">${r.level != null ? r.level + ' dBm' : ''}</span></div>`).join('');
}

$('#wifiBtn').onclick = async () => {
  if (platform === 'ios') { $('#wifiOut').innerHTML = '<div class="empty">Apple doesn\'t allow any iPhone app to read the Wi-Fi list. Type the names from Settings > Wi-Fi below.</div>'; $('#manual').open = true; return; }
  if (!P.WifiScan) { $('#wifiOut').innerHTML = '<div class="empty">iPhone and web apps can't read the Wi-Fi list (Apple rule). Type the names from Settings > Wi-Fi below.</div>'; $('#manual').open = true; return; }
  $('#wifiOut').innerHTML = '<div class="empty">Scanning Wi-Fi…</div>';
  try {
    const r = await P.WifiScan.scan();
    const best = new Map();
    for (const n of r.networks || []) { const c = best.get(n.ssid); if (!c || n.level > c.level) best.set(n.ssid, n); }
    $('#wifiOut').innerHTML = best.size ? wifiRows([...best.values()]) : '<div class="empty">No networks found. Turn on Wi-Fi and Location.</div>';
  } catch (e) { $('#wifiOut').innerHTML = `<div class="empty">${esc(e.message || e)}</div>`; }
};
$('#ssidBtn').onclick = () => {
  const names = $('#ssidIn').value.split(/\n/).map((x) => x.trim()).filter(Boolean);
  $('#wifiOut').innerHTML = wifiRows(names.map((ssid) => ({ ssid })));
};

const seen = new Map();
let scanning = false;
function drawBt() {
  const rows = [...seen.values()].map((d) => ({ ...d, ...what(BTS, d.name) })).sort((a, b) => b.solar - a.solar || (b.rssi || -200) - (a.rssi || -200));
  $('#btOut').innerHTML = rows.length ? rows.map((r) => `<div class="item"><span class="tag ${r.solar ? 'solar' : ''}">${r.solar ? 'solar' : 'device'}</span>
    <div class="name"><b>${esc(r.name || 'Unnamed device')}</b><span>${esc(r.what)}</span></div>
    <span class="sig">${r.rssi ? '~' + feet(r.rssi) + ' ft' : ''}</span></div>`).join('') : '<div class="empty">Scanning… devices appear as they\'re found.</div>';
}
$('#btBtn').onclick = async () => {
  const B = P.BluetoothLe;
  if (!B) { $('#btOut').innerHTML = '<div class="empty">Bluetooth scanning isn't allowed in iPhone web apps (Apple rule). Use the Opal app on Android or a computer for Bluetooth.</div>'; return; }
  if (scanning) { await B.stopLEScan(); scanning = false; $('#btBtn').textContent = 'Scan'; return; }
  try {
    await B.initialize({ androidNeverForLocation: true });
    const on = await B.isEnabled();
    if (!on.value) { $('#btOut').innerHTML = '<div class="empty">Bluetooth is off. Turn it on in Settings, then scan again.</div>'; return; }
    seen.clear(); drawBt(); scanning = true; $('#btBtn').textContent = 'Stop';
    await B.addListener('onScanResult', (r) => {
      const id = r.device.deviceId;
      seen.set(id, { id, name: r.localName || r.device.name || '', rssi: r.rssi });
      drawBt();
    });
    await B.requestLEScan({ allowDuplicates: true });
    setTimeout(async () => { if (scanning) { await B.stopLEScan(); scanning = false; $('#btBtn').textContent = 'Scan'; } }, 30000);
  } catch (e) { scanning = false; $('#btBtn').textContent = 'Scan'; $('#btOut').innerHTML = `<div class="empty">${esc(e.message || e)}</div>`; }
};

// ---------- House (shared lookup, same as desktop) ----------
if (window.OpalHouse) window.OpalHouse.mount(document.querySelector('#houseWrap'), {
  open: (u) => { if (P.Browser) P.Browser.open({ url: u, toolbarColor: '#111111' }); else window.open(u, '_blank'); },
});

// ---------- Storms (NOAA Storm Prediction Center) ----------
const KIND = { hail: 'Hail', wind: 'Wind', torn: 'Tornado' };
async function loadStorms() {
  $('#stormOut').innerHTML = '<div class="empty">Loading NOAA reports…</div>';
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
  if (!list.length) { $('#stormOut').innerHTML = '<div class="empty">No NC hail, wind or tornado reports today or yesterday.</div>'; return; }
  const sev = (r) => r.kind === 'torn' ? 3 : r.kind === 'hail' ? (+r.size >= 100 ? 2 : 1) : (+r.size >= 58 || r.size === 'UNK' ? 1 : 0);
  list.sort((a, b) => sev(b) - sev(a));
  $('#stormOut').innerHTML = list.map((r, i) => `<div class="item"><span class="tag ${sev(r) ? 'solar' : ''}">${KIND[r.kind]}</span>
    <div class="name"><b>${esc(r.location)}, ${esc(r.county)}</b><span>${r.day} ${esc(r.time)}Z · ${r.kind === 'hail' ? (+r.size / 100).toFixed(2) + '" hail' : r.kind === 'wind' ? (r.size === 'UNK' ? 'wind damage' : esc(r.size) + ' mph') : 'tornado'} · ${esc(r.comments.slice(0, 90))}</span></div>
    <button class="btn ghost" data-map="${i}">Map</button></div>`).join('');
  $('#stormOut').querySelectorAll('[data-map]').forEach((b) => b.onclick = () => { const r = list[b.dataset.map]; const u = `https://maps.apple.com/?ll=${r.lat},${r.lon}&q=${encodeURIComponent(r.location)}`; if (P.Browser) P.Browser.open({ url: u }); else window.open(u); });
}
$('#stormBtn').onclick = loadStorms;
document.querySelector('nav [data-tab="storms"]').addEventListener('click', () => { if (!$('#stormOut .item')) loadStorms(); });
