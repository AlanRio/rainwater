// Rainwater simulator for an off-grid house near Prayssac (Lot, France).
// A day-by-day water balance of the tanks, driven by the measured rainfall in rainfall.js
// (window.RAINFALL, rebuilt weekly by scripts/update_rainfall.py).
(function () {
  'use strict';

  const R = window.RAINFALL;

  // ---- Language --------------------------------------------------------------
  // English or Dutch. Static text in index.html carries both, marked lang="en" and lang="nl", and CSS
  // hides the one not in use; everything this script writes picks its language with tr(english, dutch).
  let LANG = 'en';
  const tr = (en, nl) => (LANG === 'nl' ? nl : en);
  const pick = (o) => (o && typeof o === 'object' ? o[LANG] || o.en : o);
  const MONTH_NAMES = {
    en: ['January', 'February', 'March', 'April', 'May', 'June', 'July',
      'August', 'September', 'October', 'November', 'December'],
    nl: ['januari', 'februari', 'maart', 'april', 'mei', 'juni', 'juli',
      'augustus', 'september', 'oktober', 'november', 'december'],
  };
  const MONTH_SHORT = {
    en: MONTH_NAMES.en.map((m) => m.slice(0, 3)),
    nl: ['jan', 'feb', 'mrt', 'apr', 'mei', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'],
  };
  let MONTHS = MONTH_NAMES.en;
  let MONTHS_SHORT = MONTH_SHORT.en;
  // The default surfaces and tanks keep their English names in the settings; these are shown in Dutch.
  const NAMES_NL = {
    'House': 'Huis', 'Gîte': 'Gîte', 'Yoga building': 'Yogagebouw', 'Terrace': 'Terras', 'Small terrace': 'Klein terras',
    'Ground sheet (EPDM)': 'Opvangfolie (EPDM)', 'Car port roof': 'Dak van de carport', 'House terrace': 'Terras bij het huis',
    'House tank': 'Huistank', 'Solar building tank': 'Tank bij het zonnegebouw', 'Extra tank (sheet only)': 'Extra tank (alleen folie)',
    'New buried tank': 'Nieuwe ondergrondse tank', 'Other surface': 'Ander oppervlak',
  };
  const showName = (n) => (LANG === 'nl' && NAMES_NL[n]) || n;
  // Dual flush is the house's 6/2 L: one full flush for every two short ones, as in the UK water efficiency
  // calculator (Approved Document G), averages (6 + 2 × 2) / 3 = 3.3 L.
  const TOILET_LITRES = { std: 9, low: 6, dual: 10 / 3, dry: 0, grey: 9 };
  const STRING_KEYS = new Set(['src', 'mode', 'toilet', 'supplier', 'truck']);

  // Hauliers near the house that run tankers (researched October 2026), with the road
  // distance from their base to Prayssac. Picking one sets the distance; 'custom' keeps yours.
  const SUPPLIERS = [
    { id: 'delrieu', name: 'Transports Delrieu, Parnac', km: 15.6,
      note: { en: 'Runs food-grade tanker semi-trailers (bulk wine) and two 28 m³ water tankers. The nearest firm with food-grade tanks; ask whether they can send a smaller lorry.',
        nl: 'Heeft voedselveilige tankopleggers (wijn in bulk) en twee tankwagens van 28 m³ voor water. Het dichtstbijzijnde bedrijf met voedselveilige tanks; vraag of ze een kleinere wagen kunnen sturen.' } },
    { id: 'cassan', name: 'SARL Cassan, Prayssac', km: 1.6,
      note: { en: 'Runs fuel and liquids tankers. Only suitable if they have a separate food-grade tank.',
        nl: 'Heeft tankwagens voor brandstof en vloeistoffen. Alleen geschikt als ze een aparte voedselveilige tank hebben.' } },
    { id: 'imbert', name: 'Établissements Imbert, Fontanes', km: 42.7,
      note: { en: 'Haulier listed for bulk tanker work; tank type not confirmed.',
        nl: 'Vervoerder die vermeld staat voor bulktransport per tankwagen; type tank niet bevestigd.' } },
    { id: 'amichauf', name: 'Amichauf, Souillac', km: 86.7,
      note: { en: 'Listed for water transport and distribution; no tanker details found.',
        nl: 'Vermeld voor watertransport en -distributie; geen gegevens over tankwagens gevonden.' } },
    { id: 'veynat', name: 'Transports Veynat, Tresses (Gironde)', km: 196.5,
      note: { en: 'Drinking-water tanker specialist, but nearly 200 km away.',
        nl: 'Gespecialiseerd in drinkwatertransport, maar bijna 200 km verderop.' } },
    { id: 'custom', name: { en: 'Other (enter the distance)', nl: 'Anders (vul de afstand in)' }, km: null, note: '' },
  ];
  // Tanker sizes: water weighs a tonne per m³, so the legal weight limit sets the load.
  const TRUCKS = [
    { id: 'rigid2', name: { en: 'Small rigid lorry, 2 axles (19 t)', nl: 'Kleine vrachtwagen, 2 assen (19 t)' }, load: 12 },
    { id: 'rigid3', name: { en: 'Rigid lorry, 3 axles (26 t)', nl: 'Vrachtwagen, 3 assen (26 t)' }, load: 16 },
    { id: 'rigid4', name: { en: 'Large rigid lorry, 4 axles (32 t)', nl: 'Grote vrachtwagen, 4 assen (32 t)' }, load: 20 },
    { id: 'semi', name: { en: 'Articulated tanker (44 t)', nl: 'Tankoplegger (44 t)' }, load: 28 },
    { id: 'custom', name: { en: 'Other (enter the load)', nl: 'Anders (vul de lading in)' }, load: null },
  ];
  // Names of the rainfall sources, by their key in rainfall.js.
  const SOURCE_NAMES = {
    anglars: { en: 'Météo-France rain gauge, Anglars-Juillac (station 46005001)', nl: 'Regenmeter Météo-France, Anglars-Juillac (station 46005001)',
      short: { en: 'Anglars rain gauge', nl: 'de regenmeter in Anglars' } },
    era5: { en: 'ERA5 weather model via Open-Meteo, 44.5N 1.2E', nl: 'Weermodel ERA5 via Open-Meteo, 44,5N 1,2E',
      short: { en: 'ERA5 weather model', nl: 'het weermodel ERA5' } },
  };
  const sourceName = (k) => (SOURCE_NAMES[k] ? pick(SOURCE_NAMES[k]) : R.sources[k].name);
  const sourceShort = (k) => (SOURCE_NAMES[k] ? pick(SOURCE_NAMES[k].short) : R.sources[k].short);
  // The comparison setup always sees the same weather as the current settings.
  const WEATHER_KEYS = ['src', 'from', 'sumAdj', 'winAdj'];

  // A surface with its own share (e, in %) uses that instead of the general collection setting.
  // The ground sheet (g) is the proposed EPDM rain sheet on the slope south of the buildings.
  const DEFAULT_SURFACES = [
    { n: 'House', l: 15, w: 5, on: 1 },
    { n: 'Gîte', l: 14, w: 7, on: 1 },
    { n: 'Yoga building', l: 5, w: 7, on: 0 },
    { n: 'Terrace', l: 10, w: 4, on: 0 },
    { n: 'Small terrace', l: 5, w: 3, on: 0 },
    { n: 'Ground sheet (EPDM)', l: 20, w: 4.5, on: 0, e: 85, g: 1 },
    { n: 'Car port roof', l: 12, w: 4.5, on: 0 },
    { n: 'House terrace', l: 5, w: 5, on: 0 },
  ];
  const SHEET_ROW = DEFAULT_SURFACES.findIndex((x) => x.g); // where the sheet sits in the default list
  const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  // Box tanks use length × width × depth; round tanks use l as the diameter and ignore w.
  // The extra tank for the sheet (g) only takes the sheet's water, and empties into the other tanks
  // whenever they have room.
  const DEFAULT_TANKS = [
    { n: 'House tank', shape: 'box', l: 2, w: 2, d: 2.5, on: 1 },
    { n: 'Solar building tank', shape: 'box', l: 4.5, w: 4.45, d: 2.5, on: 1 },
    { n: 'Extra tank (sheet only)', shape: 'box', l: 4, w: 2.5, d: 1, on: 0, g: 1 },
    { n: 'New buried tank', shape: 'box', l: 4, w: 2.5, d: 2.5, on: 0 },
  ];
  const NEW_TANK = 'New buried tank';
  const SHEET_TANK_ROW = DEFAULT_TANKS.findIndex((t) => t.g);
  const MAX_GUESTS = 8; // the house sleeps 8
  const DEFAULTS = {
    // guests and season
    guests: 8, occ: 100, s0: 5, s1: 10, offPeople: 0,
    // water use: built up from parts, or one figure per guest
    mode: 'build', direct: 82,
    shN: 1, shL: 50, toilet: 'dual', flush: 5, taps: 15, wmLoads: 8, wmL: 55, dwRuns: 1.5, dwL: 12, otherL: 0,
    // collection
    eff: 75, loss: 0, cap: 0,
    // tanks (their sizes are in the tank list)
    usable: 90, fill: 100,
    // tanker
    tanker: 1, trig: 5, lead: 2,
    supplier: 'delrieu', km: 15.6, truck: 'rigid2', load: 12,
    fixed: 150, perKm: 3, price: 2.8,
    // weather
    src: 'anglars', from: 1994, sumAdj: 0, winAdj: 0,
    // payback
    upCost: 0,
  };

  // ---- Calendar ------------------------------------------------------------

  const DAY = 86400000;
  const T0 = Date.parse(R.start + 'T00:00:00Z');
  const N = R.sources.anglars.mm.length;
  const YEAR = new Int16Array(N);
  const MONTH = new Int8Array(N);
  const DOM = new Int8Array(N); // day of the month
  for (let i = 0; i < N; i++) {
    const d = new Date(T0 + i * DAY);
    YEAR[i] = d.getUTCFullYear();
    MONTH[i] = d.getUTCMonth() + 1;
    DOM[i] = d.getUTCDate();
  }
  const FIRST_YEAR = YEAR[0];
  const LAST_YEAR = YEAR[N - 1];
  const LAST_FULL_YEAR = R.end.slice(5) === '12-31' ? LAST_YEAR : LAST_YEAR - 1;
  const indexOf = (iso) => Math.round((Date.parse(iso + 'T00:00:00Z') - T0) / DAY);
  const isoAt = (i) => new Date(T0 + i * DAY).toISOString().slice(0, 10);
  const yearStart = (y) => Math.min(N - 1, Math.max(0, indexOf(y + '-01-01')));

  // Annual totals per source, for the explanations.
  const YEAR_TOTALS = {};
  for (const key of Object.keys(R.sources)) {
    const t = {};
    R.sources[key].mm.forEach((mm, i) => { t[YEAR[i]] = (t[YEAR[i]] || 0) + mm; });
    YEAR_TOTALS[key] = t;
  }

  // ---- Formatting ----------------------------------------------------------

  const locale = () => (LANG === 'nl' ? 'nl-NL' : 'en-GB');
  const fmt = (x, d = 0) => Number(x).toLocaleString(locale(), { minimumFractionDigits: d, maximumFractionDigits: d });
  const eur = (x, d = 0) => tr('€', '€ ') + fmt(x, d);
  const m3 = (x) => fmt(x, Math.abs(x) < 10 && x !== 0 ? 1 : 0) + ' m³';
  const longDate = (iso) => new Date(iso + 'T00:00:00Z')
    .toLocaleDateString(locale(), { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
  const plural = (n, one, many) => (n === 1 ? one : many);
  const signed = (x) => (x > 0 ? '+' : '') + x;
  const oneDp = (x) => fmt(x, x > 0 && x < 10 ? 1 : 0);
  const $ = (id) => document.getElementById(id);
  const setHTML = (id, html) => { const el = $(id); if (el) el.innerHTML = html; };
  const setAll = (cls, text) => document.querySelectorAll('.' + cls).forEach((el) => { el.textContent = text; });
  const setAllHTML = (cls, html) => document.querySelectorAll('.' + cls).forEach((el) => { el.innerHTML = html; });
  const clone = (o) => JSON.parse(JSON.stringify(o));

  // ---- Settings ------------------------------------------------------------

  const freshDefaults = () => Object.assign(clone(DEFAULTS), { surfaces: clone(DEFAULT_SURFACES), tanklist: clone(DEFAULT_TANKS) });
  let state = freshDefaults();
  let pinned = null; // settings pinned for comparison; null means the default setup

  const catchment = (s) => s.surfaces.reduce((a, x) => a + (x.on ? x.l * x.w : 0), 0);
  const ownShare = (x) => x.e > 0;
  // Area that effectively delivers water: each surface times the share of its rain that reaches the tanks.
  const wetArea = (s) => s.surfaces.reduce((a, x) => a + (x.on ? x.l * x.w * (ownShare(x) ? x.e : s.eff) / 100 : 0), 0);
  const avgShare = (s) => (catchment(s) > 0 ? wetArea(s) / catchment(s) * 100 : s.eff);
  const sheetIndex = (s) => s.surfaces.findIndex((x) => x.g);
  const tankFootprint = (t) => (t.shape === 'round' ? Math.PI * t.l * t.l / 4 : t.l * t.w);
  const tankVolume = (s) => s.tanklist.reduce((a, t) => a + (t.on ? tankFootprint(t) * t.d : 0), 0);
  const usableVolume = (s) => tankVolume(s) * s.usable / 100;
  // Water surface area of the linked tanks: 1 cm of depth is this many m² × 0.01 m³.
  const planArea = (s) => s.tanklist.reduce((a, t) => a + (t.on && !t.g ? tankFootprint(t) : 0), 0);
  const sheetTankVolume = (s) => s.tanklist.reduce((a, t) => a + (t.on && t.g ? tankFootprint(t) * t.d : 0), 0) * s.usable / 100;
  // A delivery costs the fixed charge and the round trip whatever the load, plus the water.
  const tripCost = (s) => s.fixed + s.perKm * 2 * s.km;
  const deliveryCost = (s) => tripCost(s) + s.load * s.price;
  const supplierName = (s) => {
    const p = SUPPLIERS.find((x) => x.id === s.supplier);
    return p && p.id !== 'custom' ? pick(p.name).split(',')[0] : tr(`a supplier ${fmt(s.km, 1)} km away`, `een leverancier op ${fmt(s.km, 1)} km`);
  };
  const inSeason = (m, a, b) => (a <= b ? m >= a && m <= b : m >= a || m <= b);

  function usage(s) {
    if (s.mode === 'direct') return { perGuest: s.direct, house: 0, parts: null };
    const shower = s.shN * s.shL;
    // Flushing with used shower water only draws on the tank for whatever the showers can't cover.
    const toilet = s.toilet === 'grey'
      ? Math.max(0, s.flush * TOILET_LITRES.grey - shower)
      : s.flush * TOILET_LITRES[s.toilet];
    const laundry = s.wmLoads * s.wmL / 7;
    const dish = s.dwRuns * s.dwL;
    return {
      perGuest: shower + toilet + s.taps,
      house: laundry + dish + s.otherL,
      parts: { shower, toilet, taps: s.taps, laundry, dish, other: s.otherL },
    };
  }

  // Litres a day: with every guest in, averaged over the season, and outside the season.
  function demand(s) {
    const u = usage(s);
    const fullHouse = s.guests > 0 ? s.guests * u.perGuest + u.house : 0;
    return {
      u,
      fullHouse,
      perGuest: s.guests > 0 ? fullHouse / s.guests : u.perGuest,
      season: fullHouse * s.occ / 100,
      off: s.offPeople * u.perGuest,
    };
  }

  // Millimetres of a day's rain that make it into the gutters.
  function harvestMm(mm, s) {
    const m = s.cap > 0 ? Math.min(mm, s.cap) : mm;
    return Math.max(0, m - s.loss);
  }

  function climateFactor(month, s) {
    if (month >= 6 && month <= 8) return 1 + s.sumAdj / 100;
    if (month === 12 || month <= 2) return 1 + s.winAdj / 100;
    return 1;
  }

  // ---- Simulation ----------------------------------------------------------

  function simulate(s) {
    const rain = R.sources[s.src].mm;
    const i0 = yearStart(s.from);
    const L = N - i0;
    const area = catchment(s);
    const cap = usableVolume(s);
    const trigger = cap * s.trig / 100;
    // With an extra tank for the sheet, the sheet fills that tank, which tops up the main tanks when they
    // have room; otherwise everything goes straight to the main tanks. 1 mm on 1 m² is 1 litre.
    const capS = sheetTankVolume(s);
    const capM = cap - capS;
    const sheetWet = s.surfaces.reduce((a, x) => a + (x.on && x.g ? x.l * x.w * (ownShare(x) ? x.e : s.eff) / 100 : 0), 0);
    const perMmS = capS > 0 ? sheetWet / 1000 : 0;
    const perMm = wetArea(s) / 1000 - perMmS;
    const d = demand(s);
    const useSeason = d.season / 1000;
    const useOff = d.off / 1000;

    const vol = new Float32Array(L);
    const dry = new Uint8Array(L); // 1 on a day the house ran short
    const deliveryDays = [];
    const years = [];
    let v = capM * s.fill / 100; // main tanks
    let sv = capS * s.fill / 100; // extra tank for the sheet
    let arrival = -1; // day a tanker that's been ordered will arrive
    let Y = null;
    let minLevel = Infinity;
    let minDay = -1;

    const deliver = (j) => {
      const add = Math.min(s.load, capM - v);
      if (add <= 0.001) return false;
      v += add;
      Y.deliveries++;
      Y.delivered += add;
      Y.cost += add * s.price + tripCost(s);
      deliveryDays.push(j);
      return true;
    };

    for (let j = 0; j < L; j++) {
      const i = i0 + j;
      const m = MONTH[i];
      if (!Y || Y.year !== YEAR[i]) {
        Y = { year: YEAR[i], days: 0, seasonDays: 0, rain: 0, collected: 0, overflow: 0, used: 0,
          deliveries: 0, delivered: 0, cost: 0, dryDays: 0, firstDry: -1, min: Infinity };
        years.push(Y);
      }
      Y.days++;
      const mm = rain[i] * climateFactor(m, s);
      const occupied = inSeason(m, s.s0, s.s1);
      if (occupied) { Y.seasonDays++; Y.rain += mm; }

      // Rain in; anything above capacity overflows.
      const h = harvestMm(mm, s);
      const inflow = h * perMm;
      const inflowS = h * perMmS;
      v += inflow;
      sv += inflowS;
      Y.collected += inflow + inflowS;
      if (v > capM) { Y.overflow += v - capM; v = capM; }
      if (sv > capS) { Y.overflow += sv - capS; sv = capS; }
      // The extra tank tops up the main tanks.
      const move = Math.min(sv, capM - v);
      if (move > 0) { v += move; sv -= move; }

      // A tanker ordered earlier arrives.
      if (arrival >= 0 && j >= arrival) { deliver(j); arrival = -1; }

      // The house uses water; if the tanks are empty, it goes without.
      const use = occupied ? useSeason : useOff;
      v -= use;
      Y.used += use;
      if (v < 0) {
        Y.used += v;
        v = 0;
        if (use > 0) { Y.dryDays++; dry[j] = 1; if (Y.firstDry < 0) Y.firstDry = i; }
      }

      // Order a tanker when the level falls to the trigger.
      if (s.tanker && use > 0 && arrival < 0 && v + sv <= trigger) {
        if (s.lead > 0) arrival = j + s.lead;
        else for (let g = 0; g < 50 && v + sv <= trigger && deliver(j); g++);
      }

      const total = v + sv;
      if (use > 0) {
        if (total < Y.min) Y.min = total;
        if (total < minLevel) { minLevel = total; minDay = j; }
      }
      vol[j] = total;
    }

    const T = { collected: 0, overflow: 0, used: 0, deliveries: 0, delivered: 0, cost: 0, dryDays: 0 };
    for (const y of years) for (const k of Object.keys(T)) T[k] += y[k];
    const summers = years.filter((y) => y.seasonDays > 0).length || 1;
    return {
      s, i0, L, span: L / 365.25, area, cap, trigger, d, vol, dry, deliveryDays, years, T, summers,
      minLevel: isFinite(minLevel) ? minLevel : cap,
      minYear: minDay >= 0 ? YEAR[i0 + minDay] : null,
      yearsDry: years.filter((y) => y.dryDays > 0).length,
      yearsTanker: years.filter((y) => y.deliveries > 0).length,
    };
  }

  function worstYear(r) {
    const ys = r.years.filter((y) => y.seasonDays > 0 || isFinite(y.min));
    if (!ys.length) return null;
    const score = r.s.tanker ? (y) => y.cost * 1000 + y.dryDays : (y) => y.dryDays;
    let w = ys[0];
    for (const y of ys) if (score(y) > score(w)) w = y;
    if (score(w) > 0) return w;
    // Nothing went wrong in any year: report the year the tanks got lowest instead.
    const low = ys.reduce((a, b) => (b.min < a.min ? b : a));
    return Object.assign({}, low, { calm: true });
  }

  function baselineSettings() {
    const b = clone(pinned || freshDefaults());
    for (const k of WEATHER_KEYS) b[k] = state[k];
    return b;
  }
  function comparable(s) {
    const c = clone(s);
    for (const k of [...WEATHER_KEYS, 'upCost']) delete c[k];
    return JSON.stringify(c);
  }
  function describe(s) {
    const d = demand(s);
    const g = s.guests;
    return tr(
      `${fmt(catchment(s))} m² collecting, ${m3(usableVolume(s))} of usable tank, ` +
        `${g} ${plural(g, 'guest', 'guests')} at ${fmt(d.perGuest)} litres a day, ` +
        `${s.occ === 100 ? 'house full all season' : 'house full ' + s.occ + '% of the season'}${s.tanker ? '' : ', no tanker'}`,
      `${fmt(catchment(s))} m² opvang, ${m3(usableVolume(s))} bruikbare tankinhoud, ` +
        `${g} ${plural(g, 'gast', 'gasten')} met ${fmt(d.perGuest)} liter per dag, ` +
        `${s.occ === 100 ? 'huis het hele seizoen vol' : 'huis ' + s.occ + '% van het seizoen vol'}${s.tanker ? '' : ', geen tankwagen'}`);
  }

  // ---- The answer ----------------------------------------------------------

  function headline(r) {
    const s = r.s;
    const { T } = r;
    if (r.d.season <= 0 && r.d.off <= 0) {
      return tr('Nobody is using water in these settings, so the tanks simply stay full. Add guests under <i>Settings</i>.',
        'In deze instellingen gebruikt niemand water, dus de tanks blijven gewoon vol. Voeg gasten toe onder <i>Instellingen</i>.');
    }
    const w = worstYear(r);
    const inYear = r.minYear ? ' in ' + r.minYear : '';
    const lowest = tr(`The lowest the tanks got was ${m3(r.minLevel)}${inYear}.`, `Het laagste peil was ${m3(r.minLevel)}${inYear}.`);
    if (T.dryDays === 0 && T.deliveries === 0) {
      return tr(`<b>The rain alone would have been enough every year since ${s.from}</b>, with no tanker needed. ${lowest}`,
        `<b>Alleen de regen zou sinds ${s.from} elk jaar genoeg zijn geweest</b>, zonder tankwagen. ${lowest}`);
    }
    if (s.tanker) {
      const per = T.deliveries / r.span;
      const one = Math.round(per * 10) / 10;
      let t = tr(`You'd need about <b>${oneDp(per)} tanker ${plural(one, 'delivery', 'deliveries')} a summer</b>, ` +
        `costing about <b>${eur(T.cost / r.span)} a year</b> on average since ${s.from}.`,
      `Je hebt gemiddeld ongeveer <b>${oneDp(per)} ${plural(one, 'tankwagen', 'tankwagens')} per zomer</b> nodig, ` +
        `zo'n <b>${eur(T.cost / r.span)} per jaar</b> sinds ${s.from}.`);
      if (w && !w.calm && w.deliveries) {
        t += tr(` The worst year was ${w.year}: ${w.deliveries} ${plural(w.deliveries, 'delivery', 'deliveries')}, ${eur(w.cost)}.`,
          ` Het slechtste jaar was ${w.year}: ${w.deliveries} ${plural(w.deliveries, 'tankwagen', 'tankwagens')}, ${eur(w.cost)}.`);
      }
      if (T.dryDays > 0) {
        t += tr(` <span class="bad">Even with the tanker, the house would have been without water on ${fmt(T.dryDays)} ` +
          `${plural(T.dryDays, 'day', 'days')}. Order earlier or allow for a slower delivery under <i>Tanker in detail</i>.</span>`,
        ` <span class="bad">Zelfs met de tankwagen zou het huis op ${fmt(T.dryDays)} ${plural(T.dryDays, 'dag', 'dagen')} ` +
          'zonder water hebben gezeten. Bestel eerder of reken op een langzamere levering onder <i>Tankwagen in detail</i>.</span>');
      }
      return t;
    }
    const per = T.dryDays / r.span;
    let t = tr(`Without a tanker, the house would run out of water on about <b>${oneDp(per)} days a summer</b> on average since ${s.from}, ` +
      `in ${r.yearsDry} of ${r.summers} ${plural(r.summers, 'summer', 'summers')}.`,
    `Zonder tankwagen zou het huis sinds ${s.from} gemiddeld op ongeveer <b>${oneDp(per)} dagen per zomer</b> zonder water zitten, ` +
      `in ${r.yearsDry} van de ${r.summers} ${plural(r.summers, 'zomer', 'zomers')}.`);
    if (w && !w.calm) {
      t += tr(` The worst year was ${w.year}, with ${w.dryDays} ${plural(w.dryDays, 'day', 'days')} without water.`,
        ` Het slechtste jaar was ${w.year}, met ${w.dryDays} ${plural(w.dryDays, 'dag', 'dagen')} zonder water.`);
    }
    return t;
  }

  function comparison(r, rb, bs, same) {
    const who = pinned ? tr('the settings you pinned', 'de instellingen die je hebt vastgezet') : tr('the default setup', 'de standaardopzet');
    if (same) {
      return pinned
        ? tr('These are the settings you pinned for comparison. Change something to see the difference it makes.',
          'Dit zijn de instellingen die je hebt vastgezet om mee te vergelijken. Verander iets om het verschil te zien.')
        : tr('These are the default settings for the house as it is now. Try the buttons below: step 1, step 2 and plan B.',
          'Dit zijn de standaardinstellingen voor het huis zoals het nu is. Probeer de knoppen hieronder: stap 1, stap 2 en plan B.');
    }
    const intro = tr(`Compared with ${who} (${describe(bs)}): `, `Vergeleken met ${who} (${describe(bs)}): `);
    if (r.s.tanker && bs.tanker) {
      const dDel = (rb.T.deliveries - r.T.deliveries) / r.span;
      const dCost = (rb.T.cost - r.T.cost) / r.span;
      if (Math.abs(dCost) < 1 && Math.abs(dDel) < 0.05) return intro + tr('no real difference in tanker use.', 'geen echt verschil in gebruik van tankwagens.');
      if (dCost > 0) {
        const n = Math.round(dDel * 10) / 10;
        let t = intro + tr(`<b>${oneDp(dDel)} fewer ${plural(n, 'delivery', 'deliveries')} a summer, saving ${eur(dCost)} a year.</b>`,
          `<b>${oneDp(dDel)} ${plural(n, 'tankwagen', 'tankwagens')} minder per zomer, een besparing van ${eur(dCost)} per jaar.</b>`);
        if (r.s.upCost > 0) {
          t += tr(` Changes costing ${eur(r.s.upCost)} would pay for themselves in about ${fmt(r.s.upCost / dCost, 1)} years.`,
            ` Veranderingen van ${eur(r.s.upCost)} verdienen zichzelf terug in ongeveer ${fmt(r.s.upCost / dCost, 1)} jaar.`);
        }
        return t;
      }
      const n = Math.round(-dDel * 10) / 10;
      return intro + tr(`<b>${oneDp(-dDel)} more ${plural(n, 'delivery', 'deliveries')} a summer, costing ${eur(-dCost)} a year more.</b>`,
        `<b>${oneDp(-dDel)} ${plural(n, 'tankwagen', 'tankwagens')} meer per zomer, ${eur(-dCost)} per jaar duurder.</b>`);
    }
    const dDry = (rb.T.dryDays - r.T.dryDays) / r.span;
    if (Math.abs(dDry) < 0.05) return intro + tr('no real difference in days without water.', 'geen echt verschil in dagen zonder water.');
    return intro + (dDry > 0
      ? tr(`<b>${oneDp(dDry)} fewer days without water a summer.</b>`, `<b>${oneDp(dDry)} dagen minder zonder water per zomer.</b>`)
      : tr(`<b>${oneDp(-dDry)} more days without water a summer.</b>`, `<b>${oneDp(-dDry)} dagen meer zonder water per zomer.</b>`));
  }

  // ---- Rendering -----------------------------------------------------------

  function renderOutputs(s, r) {
    const d = r.d;
    setHTML('o_guests', String(s.guests));
    setHTML('o_occ', s.occ + '%');
    setHTML('o_water', tr(`Water use: <b>${fmt(d.perGuest)}</b> litres per guest per day, <b>${fmt(d.fullHouse)}</b> litres a day for the house.`,
      `Waterverbruik: <b>${fmt(d.perGuest)}</b> liter per gast per dag, <b>${fmt(d.fullHouse)}</b> liter per dag voor het huis.`));
    setHTML('o_area', fmt(r.area) + ' m²');
    setHTML('o_tanktot', tr(`Total <b>${m3(tankVolume(s))}</b>, of which <b>${m3(r.cap)}</b> usable.`,
      `Totaal <b>${m3(tankVolume(s))}</b>, waarvan <b>${m3(r.cap)}</b> bruikbaar.`));
    setHTML('o_tanker', s.tanker
      ? tr(`Each delivery brings ${fmt(s.load)} m³ from ${supplierName(s)} and costs about <b>${eur(deliveryCost(s))}</b> ` +
        `(${eur(deliveryCost(s) / s.load, 1)} per m³). ` +
        `It's ordered when the tanks fall to ${s.trig}% and arrives ${s.lead} ${plural(s.lead, 'day', 'days')} later.`,
      `Elke levering brengt ${fmt(s.load)} m³ van ${supplierName(s)} en kost ongeveer <b>${eur(deliveryCost(s))}</b> ` +
        `(${eur(deliveryCost(s) / s.load, 1)} per m³). ` +
        `Hij wordt besteld als de tanks dalen tot ${s.trig}% en komt ${s.lead} ${plural(s.lead, 'dag', 'dagen')} later.`)
      : tr('With no tanker, the results show how often the house would run dry.',
        'Zonder tankwagen laten de resultaten zien hoe vaak het huis zonder water zou zitten.'));
    const sup = SUPPLIERS.find((x) => x.id === s.supplier);
    setHTML('o_supplier', sup && sup.note ? pick(sup.note) : '');
    setHTML('o_cost_breakdown', tr(`Each delivery: ${eur(s.fixed)} fixed + ${eur(s.perKm * 2 * s.km)} for ` +
      `${fmt(2 * s.km, 1)} km there and back + ${eur(s.load * s.price)} for ${fmt(s.load)} m³ of water ` +
      `= <b>${eur(deliveryCost(s))}</b>, or ${eur(deliveryCost(s) / s.load, 1)} per m³.`,
    `Elke levering: ${eur(s.fixed)} vast + ${eur(s.perKm * 2 * s.km)} voor ` +
      `${fmt(2 * s.km, 1)} km heen en terug + ${eur(s.load * s.price)} voor ${fmt(s.load)} m³ water ` +
      `= <b>${eur(deliveryCost(s))}</b>, of ${eur(deliveryCost(s) / s.load, 1)} per m³.`));
    setHTML('o_off', fmt(s.offPeople, s.offPeople % 1 ? 1 : 0));
    setHTML('o_eff', s.eff + '%');
    setHTML('o_loss', s.loss > 0 ? fmt(s.loss, 1) + ' mm' : tr('none', 'geen'));
    setHTML('o_cap', s.cap > 0 ? s.cap + tr(' mm a day', ' mm per dag') : tr('no limit', 'geen grens'));
    setHTML('o_usable_pct', s.usable + '%');
    setHTML('o_fill', s.fill + '%');
    setHTML('o_trig', `${s.trig}% (${m3(r.trigger)})`);
    setHTML('o_lead', `${s.lead} ${tr(plural(s.lead, 'day', 'days'), plural(s.lead, 'dag', 'dagen'))}`);
    setHTML('o_sum', signed(s.sumAdj) + '%');
    setHTML('o_win', signed(s.winAdj) + '%');

    $('direct_box').style.display = s.mode === 'direct' ? '' : 'none';
    $('build_box').style.display = s.mode === 'direct' ? 'none' : '';
    const p = d.u.parts;
    if (p) {
      const g = s.guests;
      setHTML('b_shower', fmt(g * p.shower));
      setHTML('b_toilet', fmt(g * p.toilet));
      setHTML('b_taps', fmt(g * p.taps));
      setHTML('b_wm', fmt(p.laundry));
      setHTML('b_dw', fmt(p.dish));
      setHTML('b_other', fmt(p.other));
      setHTML('b_pp', tr(`${fmt(d.perGuest)} litres per guest per day`, `${fmt(d.perGuest)} liter per gast per dag`));
      setHTML('b_total', fmt(d.fullHouse));
    }
    surfRows.forEach((row, k) => {
      const x = state.surfaces[k];
      row.area.textContent = x ? fmt(x.l * x.w) + ' m²' : '';
      row.el.style.opacity = x && x.on ? '1' : '0.55';
      row.share.placeholder = String(s.eff);
    });
    tankRows.forEach((row, k) => {
      const t = state.tanklist[k];
      if (!t) return;
      const round = t.shape === 'round';
      row.lbl.textContent = round ? 'Ø ' : '';
      row.wpart.style.display = round ? 'none' : '';
      row.area.textContent = m3(tankFootprint(t) * t.d);
      row.el.style.opacity = t.on ? '1' : '0.55';
    });
  }

  function renderExplain(s, r) {
    const fullYears = [];
    for (let y = s.from; y <= LAST_FULL_YEAR; y++) fullYears.push(y);
    const avg = (src) => fullYears.reduce((a, y) => a + (YEAR_TOTALS[src][y] || 0), 0) / Math.max(1, fullYears.length);
    const rainAvg = avg(s.src);
    const climate = s.sumAdj || s.winAdj ? tr(' (before the climate adjustment)', ' (vóór de klimaataanpassing)') : '';

    setAll('ex_from', String(s.from));
    setAll('ex_range', tr(`${longDate(R.start)} to ${longDate(R.end)}`, `${longDate(R.start)} tot ${longDate(R.end)}`));
    setAll('updated_o', longDate(R.updated));
    const share = avgShare(s);
    const mixed = s.surfaces.some((x) => x.on && ownShare(x) && x.e !== s.eff);
    const season = tr(`${MONTHS[s.s0 - 1]} to ${MONTHS[s.s1 - 1]}`, `${MONTHS[s.s0 - 1]} tot ${MONTHS[s.s1 - 1]}`);
    const g = s.guests;
    const use = tr(`From ${season} the house uses <b>${fmt(r.d.season)} litres a day</b> on average ` +
      `(${g} ${plural(g, 'guest', 'guests')} at about ${fmt(r.d.perGuest)} litres each` +
      `${s.occ < 100 ? `, the house full ${s.occ}% of the season` : ''})` +
      `${s.offPeople > 0 ? `, and ${fmt(r.d.off)} litres a day the rest of the year` : ''}.`,
    `Van ${season} verbruikt het huis gemiddeld <b>${fmt(r.d.season)} liter per dag</b> ` +
      `(${g} ${plural(g, 'gast', 'gasten')} met elk ongeveer ${fmt(r.d.perGuest)} liter` +
      `${s.occ < 100 ? `, het huis ${s.occ}% van het seizoen vol` : ''})` +
      `${s.offPeople > 0 ? `, en ${fmt(r.d.off)} liter per dag de rest van het jaar` : ''}.`);
    const tanker = s.tanker
      ? tr(`When the tanks fall to ${s.trig}%, a tanker is ordered and brings ${fmt(s.load)} m³ ${s.lead} ${plural(s.lead, 'day', 'days')} later.`,
        `Als de tanks dalen tot ${s.trig}%, wordt er een tankwagen besteld die ${s.lead} ${plural(s.lead, 'dag', 'dagen')} later ${fmt(s.load)} m³ brengt.`)
      : tr('There\'s no tanker in these settings, so when the tanks are empty the house has no water until it rains.',
        'Er is in deze instellingen geen tankwagen, dus als de tanks leeg zijn heeft het huis geen water tot het regent.');
    const areaB = `<b>${fmt(r.area)} m²</b>`;
    const effB = `<b>${mixed ? tr('on average ', 'gemiddeld ') : ''}${fmt(share)}%</b>`;
    setHTML('ex_steps', tr(
      `<li><b>Rain falls on the roofs.</b> The page uses the rain actually measured each day by Météo-France's rain gauge at Anglars-Juillac, 3 km from the house: <b>${fmt(rainAvg)} mm</b>${climate} a year on average since ${s.from}. One millimetre of rain on one square metre of roof is one litre of water.</li>` +
      `<li><b>Most of it reaches the tanks.</b> Of the rain landing on ${areaB} of collecting surface, ${effB} is counted as reaching the tanks. The rest is lost wetting the tiles, in the first rinse that washes dirt off the roof, and when gutters and filters spill in heavy downpours.</li>` +
      `<li><b>The tanks store it, up to a limit.</b> They hold <b>${m3(r.cap)}</b> of usable water. Rain that arrives when they're already full overflows and is lost, which is why a wet winter can't be saved up for a dry summer.</li>` +
      `<li><b>Guests use it.</b> ${use} ${tanker}</li>`,
      `<li><b>Regen valt op de daken.</b> De pagina gebruikt de regen die Météo-France elke dag echt heeft gemeten met de regenmeter in Anglars-Juillac, 3 km van het huis: gemiddeld <b>${fmt(rainAvg)} mm</b>${climate} per jaar sinds ${s.from}. Eén millimeter regen op één vierkante meter dak is één liter water.</li>` +
      `<li><b>Het meeste komt in de tanks.</b> Van de regen die op ${areaB} opvangoppervlak valt, telt ${effB} als water dat de tanks bereikt. De rest gaat verloren aan het nat worden van de pannen, aan de eerste spoeling die het vuil van het dak spoelt, en aan dakgoten en filters die overlopen bij stortbuien.</li>` +
      `<li><b>De tanks slaan het op, tot een grens.</b> Ze bevatten <b>${m3(r.cap)}</b> bruikbaar water. Regen die valt als ze al vol zijn, loopt over en gaat verloren; daarom kan een natte winter niet worden bewaard voor een droge zomer.</li>` +
      `<li><b>Gasten gebruiken het.</b> ${use} ${tanker}</li>`));

    setHTML('fl_rain', tr(`${fmt(rainAvg)} mm a year`, `${fmt(rainAvg)} mm per jaar`));
    setHTML('fl_area', tr(`${fmt(r.area)} m² collecting, ${mixed ? 'about ' : ''}${fmt(share)}% reaches the tanks`,
      `${fmt(r.area)} m² opvang, ${mixed ? 'ongeveer ' : ''}${fmt(share)}% komt in de tanks`));
    setHTML('fl_collect', tr(`${fmt(r.T.collected / r.span)} m³ a year`, `${fmt(r.T.collected / r.span)} m³ per jaar`));
    setHTML('fl_tank', tr(`${m3(r.cap)} usable`, `${m3(r.cap)} bruikbaar`));
    setHTML('fl_season', tr(`${season}, ${g} ${plural(g, 'guest', 'guests')}${s.occ < 100 ? `, ${s.occ}% full` : ''}`,
      `${season}, ${g} ${plural(g, 'gast', 'gasten')}${s.occ < 100 ? `, ${s.occ}% vol` : ''}`));
    setHTML('fl_use', tr(`${fmt(r.d.season)} litres a day`, `${fmt(r.d.season)} liter per dag`));
    setHTML('fl_tanker', s.tanker
      ? tr(`Backup: a tanker brings ${fmt(s.load)} m³ when the tanks fall to ${s.trig}% (${m3(r.trigger)}).`,
        `Achtervang: een tankwagen brengt ${fmt(s.load)} m³ als de tanks dalen tot ${s.trig}% (${m3(r.trigger)}).`)
      : tr('No tanker backup in these settings.', 'Geen tankwagen als achtervang in deze instellingen.'));

    // Cross-check against the other rainfall source with the same settings.
    const otherKey = Object.keys(R.sources).find((k) => k !== s.src);
    const years = fullYears.length > 1 ? tr(`${s.from} to ${LAST_FULL_YEAR}`, `${s.from} tot ${LAST_FULL_YEAR}`) : String(s.from);
    let alt = '';
    if (otherKey) {
      const a = simulate(Object.assign({}, s, { src: otherKey }));
      const [what, x, y] = s.tanker
        ? [tr('tanker deliveries a summer', 'tankwagens per zomer'), a.T.deliveries / a.span, r.T.deliveries / r.span]
        : [tr('days without water a summer', 'dagen zonder water per zomer'), a.T.dryDays / a.span, r.T.dryDays / r.span];
      alt = x === 0 && y === 0
        ? tr('none with either source', 'met geen van beide bronnen iets')
        : tr(`about <b>${oneDp(x)} ${what}</b> with the ${sourceShort(otherKey)}, against <b>${oneDp(y)}</b> with the ${sourceShort(s.src)}`,
          `ongeveer <b>${oneDp(x)} ${what}</b> met ${sourceShort(otherKey)}, tegen <b>${oneDp(y)}</b> met ${sourceShort(s.src)}`);
    }
    setAllHTML('chk_li', tr(
      `<b>An independent source tells the same story.</b> ERA5, a completely separate reconstruction of the weather from satellites and weather models, averages ${fmt(avg('era5'))} mm a year here, against the gauge's ${fmt(avg('anglars'))} mm (${years}). With the settings on this page it gives ${alt}. It reads wetter than the gauge in several recent summers, so the gauge is the cautious choice. You can switch to it under <i>Rainfall data and climate</i>.`,
      `<b>Een onafhankelijke bron vertelt hetzelfde verhaal.</b> ERA5, een volledig losse reconstructie van het weer uit satellieten en weermodellen, komt hier gemiddeld op ${fmt(avg('era5'))} mm per jaar, tegen ${fmt(avg('anglars'))} mm bij de regenmeter (${years}). Met de instellingen op deze pagina geeft het ${alt}. In een aantal recente zomers is het natter dan de regenmeter, dus de regenmeter is de voorzichtige keuze. Je kunt het kiezen onder <i>Neerslaggegevens en klimaat</i>.`));
  }

  function renderCards(r) {
    const s = r.s;
    const { T } = r;
    const w = worstYear(r);
    const card = (id, v, sub, cls) => {
      const el = $(id);
      el.innerHTML = v;
      el.className = 'v' + (cls ? ' ' + cls : '');
      setHTML(id + '_s', sub);
    };
    if (s.tanker) {
      card('c_del', tr(`${oneDp(T.deliveries / r.span)} a summer`, `${oneDp(T.deliveries / r.span)} per zomer`),
        tr(`${fmt(T.deliveries)} in total since ${s.from}`, `${fmt(T.deliveries)} in totaal sinds ${s.from}`), T.deliveries ? '' : 'good');
      card('c_cost', tr(`${eur(T.cost / r.span)} a year`, `${eur(T.cost / r.span)} per jaar`),
        tr(`${eur(T.cost)} in total`, `${eur(T.cost)} in totaal`), T.cost ? 'bad' : 'good');
    } else {
      card('c_del', tr('Off', 'Uit'), tr('Tanker switched off', 'Tankwagen uitgezet'), '');
      card('c_cost', '–', tr('Tanker switched off', 'Tankwagen uitgezet'), '');
    }
    if (w && !w.calm) {
      const parts = [];
      if (s.tanker && w.deliveries) {
        parts.push(tr(`${w.deliveries} ${plural(w.deliveries, 'delivery', 'deliveries')}, ${eur(w.cost)}`,
          `${w.deliveries} ${plural(w.deliveries, 'levering', 'leveringen')}, ${eur(w.cost)}`));
      }
      if (w.dryDays) parts.push(tr(`${w.dryDays} ${plural(w.dryDays, 'day', 'days')} without water`, `${w.dryDays} ${plural(w.dryDays, 'dag', 'dagen')} zonder water`));
      card('c_worst', String(w.year), parts.join('; '), '');
    } else if (w) {
      card('c_worst', tr('None', 'Geen'), tr(`Closest call: ${w.year}, down to ${m3(w.min)}`, `Het krapst: ${w.year}, tot ${m3(w.min)}`), 'good');
    } else {
      card('c_worst', '–', '', '');
    }
    card('c_dry', fmt(T.dryDays), T.dryDays
      ? tr(`in ${r.yearsDry} of ${r.summers} ${plural(r.summers, 'summer', 'summers')}`, `in ${r.yearsDry} van de ${r.summers} ${plural(r.summers, 'zomer', 'zomers')}`)
      : tr('Never ran dry', 'Nooit droog'), T.dryDays ? 'bad' : 'good');
    const pct = r.cap > 0 ? Math.round(r.minLevel / r.cap * 100) : 0;
    card('c_min', m3(r.minLevel), tr(`${pct}% full`, `${pct}% vol`) + (r.minYear ? ', in ' + r.minYear : ''), pct <= 5 ? 'warn' : '');
    card('c_bal', `${fmt(T.collected / r.span)} / ${fmt(T.used / r.span)} m³`,
      tr(`collected / used a year; ${fmt(T.overflow / r.span)} m³ a year overflowed`,
        `opgevangen / verbruikt per jaar; ${fmt(T.overflow / r.span)} m³ per jaar liep over`), '');
  }

  function renderYears(r) {
    const s = r.s;
    const w = worstYear(r);
    let h = `<thead><tr><th>${tr('Year', 'Jaar')}</th><th class="num">${tr('Rain in season', 'Regen in het seizoen')}</th>` +
      `<th class="num">${tr('Collected', 'Opgevangen')}</th><th class="num">${tr('Overflowed', 'Overgelopen')}</th><th class="num">${tr('Used', 'Verbruikt')}</th>` +
      (s.tanker ? `<th class="num">${tr('Deliveries', 'Leveringen')}</th><th class="num">${tr('Tanker cost', 'Kosten tankwagens')}</th>` : '') +
      `<th class="num">${tr('Lowest level', 'Laagste peil')}</th><th class="num">${tr('Days without water', 'Dagen zonder water')}</th></tr></thead><tbody>`;
    for (const y of r.years.slice().reverse()) {
      const partial = y.days < 365;
      const worst = w && !w.calm && y.year === w.year;
      h += `<tr${worst ? ' class="worst"' : ''}><td>${y.year}${partial ? '*' : ''}</td>` +
        `<td class="num">${y.seasonDays ? fmt(y.rain) + ' mm' : '–'}</td>` +
        `<td class="num">${fmt(y.collected)} m³</td><td class="num">${fmt(y.overflow)} m³</td><td class="num">${fmt(y.used)} m³</td>` +
        (s.tanker ? `<td class="num">${y.deliveries || '–'}</td><td class="num">${y.cost ? eur(y.cost) : '–'}</td>` : '') +
        `<td class="num">${isFinite(y.min) ? m3(y.min) : '–'}</td>` +
        `<td class="num${y.dryDays ? ' bad' : ''}">${y.dryDays || '–'}</td></tr>`;
    }
    setHTML('years', h + '</tbody>');
    const notes = [];
    if (r.years.length && r.years[r.years.length - 1].days < 365) notes.push(tr(`* ${LAST_YEAR} runs to ${longDate(R.end)}.`, `* ${LAST_YEAR} loopt tot ${longDate(R.end)}.`));
    if (w && !w.calm) notes.push(tr('The highlighted row is the worst year.', 'De gemarkeerde rij is het slechtste jaar.'));
    notes.push(tr('Rain in season is the rain that fell during the guest season.', 'Regen in het seizoen is de regen die tijdens het gastenseizoen viel.'));
    setHTML('years_note', notes.join(' '));
  }

  function renderCompare(r, rb, bs, same) {
    const who = pinned ? tr('the settings you pinned', 'de instellingen die je hebt vastgezet') : tr('the default setup', 'de standaardopzet');
    setHTML('base_o', who + ` (${describe(bs)})` + (same ? tr(', which matches the current settings.', ', gelijk aan de huidige instellingen.') : '.'));
    $('lg_base').style.display = rb ? '' : 'none';
    $('lg_tanker').style.display = r.s.tanker ? '' : 'none';
    let pay;
    if (same) pay = tr('Change a setting first, then enter what that change would cost.', 'Verander eerst een instelling en vul dan in wat die verandering zou kosten.');
    else if (!(r.s.upCost > 0)) pay = tr('Enter what the changes would cost to see how long they take to pay back.', 'Vul in wat de veranderingen kosten om te zien hoe snel ze zich terugverdienen.');
    else if (r.s.tanker && bs.tanker) {
      const save = (rb.T.cost - r.T.cost) / r.span;
      pay = save > 0
        ? tr(`<b>Pays for itself in about ${fmt(r.s.upCost / save, 1)} years</b> (${eur(save)} of tanker costs saved a year).`,
          `<b>Verdient zichzelf terug in ongeveer ${fmt(r.s.upCost / save, 1)} jaar</b> (${eur(save)} per jaar minder aan tankwagens).`)
        : tr('These changes don\'t reduce tanker costs, so they wouldn\'t pay back.', 'Deze veranderingen verlagen de kosten van tankwagens niet, dus ze verdienen zich niet terug.');
    } else {
      pay = tr('Payback needs the tanker switched on in both setups, so there\'s a cost to compare.',
        'Voor de terugverdientijd moet de tankwagen in beide opzetten aanstaan, zodat er kosten zijn om te vergelijken.');
    }
    setHTML('payback_o', pay);
  }

  // ---- The fixes -------------------------------------------------------------
  // Step 1 gutters the roofs that are built but not connected; step 2 is the new buried tank;
  // plan B is the rain sheet on the slope, made as big as it takes.
  const STEP1 = ['Yoga building', 'Car port roof', 'House terrace'];
  const step1Rows = (s) => s.surfaces.map((x, k) => (!x.g && STEP1.includes(x.n) ? k : -1)).filter((k) => k >= 0);
  const newTankRow = (s) => s.tanklist.findIndex((t) => !t.g && t.n === NEW_TANK);
  const SHEET_DEFAULT = DEFAULT_SURFACES[SHEET_ROW].l * DEFAULT_SURFACES[SHEET_ROW].w;

  // A copy of the settings with the steps switched on or off; sheet is the rain sheet's area in m²
  // (0 for none), laid as the default sheet's length along the contour and as deep as it needs.
  function withSteps(base, { roofs = 0, tank = 0, sheet = 0 } = {}) {
    const s = clone(base);
    step1Rows(s).forEach((i) => { s.surfaces[i].on = roofs ? 1 : 0; });
    const kt = newTankRow(s);
    if (kt >= 0) s.tanklist[kt].on = tank ? 1 : 0;
    const ks = sheetIndex(s);
    if (ks >= 0) {
      s.surfaces[ks].on = sheet > 0 ? 1 : 0;
      if (sheet > 0 && s.surfaces[ks].l > 0) s.surfaces[ks].w = Math.round(sheet / s.surfaces[ks].l * 100) / 100;
    }
    return s;
  }

  function renderFixButtons(s) {
    const roofs = step1Rows(s);
    const kt = newTankRow(s);
    const ks = sheetIndex(s);
    $('fix_btn').textContent = roofs.length && roofs.every((i) => s.surfaces[i].on)
      ? tr('Undo step 1', 'Stap 1 terugdraaien') : tr('Step 1: gutter the three roofs', 'Stap 1: dakgoten op de drie daken');
    $('fix_btn2').textContent = kt >= 0 && s.tanklist[kt].on
      ? tr('Undo step 2', 'Stap 2 terugdraaien') : tr('Step 2: add the new tank', 'Stap 2: de nieuwe tank erbij');
    $('fix_btn3').textContent = ks >= 0 && s.surfaces[ks].on
      ? tr('Take the rain sheet off', 'Opvangfolie weghalen') : tr('Plan B: add the rain sheet', 'Plan B: opvangfolie erbij');
  }

  // ---- The story at the top --------------------------------------------------
  // The top half of the page is worked out here from the default settings, not the simulator's, with
  // nothing trucked in. So it can't go out of date when a default changes or a new summer comes in.

  const seasonEndIso = (y, s) => new Date(Date.UTC(y, s.s1, 0)).toISOString().slice(0, 10);
  // Only guest seasons that are over count.
  const fullSummers = (r) => r.years.filter((y) => y.seasonDays > 0 && seasonEndIso(y.year, r.s) <= R.end);
  const median = (xs) => {
    const a = xs.slice().sort((p, q) => p - q);
    const m = a.length >> 1;
    if (!a.length) return 0;
    return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
  };
  const dayOfYear = (i) => i - yearStart(YEAR[i]);
  const dayMonth = (i) => `${DOM[i]} ${MONTHS[MONTH[i] - 1]}`;
  // A day of the year as "early August", "mid-August" or "late August".
  function roughDate(doy) {
    const d = new Date(Date.UTC(2001, 0, 1 + Math.round(doy)));
    const day = d.getUTCDate();
    const m = MONTHS[d.getUTCMonth()];
    if (LANG === 'nl') return (day <= 10 ? 'begin ' : day <= 20 ? 'half ' : 'eind ') + m;
    return day <= 10 ? 'early ' + m : day <= 20 ? 'mid-' + m : 'late ' + m;
  }
  function weeksText(days) {
    const w = Math.round(days / 7);
    if (days < 7) return `${fmt(days)} ${tr(plural(days, 'day', 'days'), plural(days, 'dag', 'dagen'))}`;
    return `${fmt(w)} ${tr(plural(w, 'week', 'weeks'), plural(w, 'week', 'weken'))}`;
  }
  const halves = (x) => {
    const h = Math.round(x * 2) / 2;
    const whole = Math.floor(h);
    return (whole || h % 1 === 0 ? fmt(whole) : '') + (h % 1 ? '½' : '');
  };
  function sizeWords(x) {
    if (x > 1.2) return tr(`about ${fmt(x, 1)} times the size of`, `ongeveer ${fmt(x, 1)} keer zo groot als`);
    const opts = [[0.25, 'a quarter', 'een kwart'], [1 / 3, 'a third', 'een derde'], [0.5, 'half', 'half'],
      [2 / 3, 'two-thirds', 'twee derde'], [0.75, 'three-quarters', 'driekwart'], [1, '', '']];
    const [v, en, nl] = opts.reduce((a, b) => (Math.abs(b[0] - x) < Math.abs(a[0] - x) ? b : a));
    if (v === 1) return tr('about the same size as', 'ongeveer even groot als');
    return tr(`about ${en} the size of`, `ongeveer ${nl} zo groot als`);
  }

  function summaryOf(r) {
    const ys = fullSummers(r);
    const dryYs = ys.filter((y) => y.dryDays > 0);
    const byYear = {};
    ys.forEach((y) => { byYear[y.year] = y; });
    return {
      r, ys, n: ys.length, byYear,
      ranDry: dryYs.length,
      medianDry: median(ys.map((y) => y.dryDays)),
      runOut: dryYs.length ? median(dryYs.map((y) => dayOfYear(y.firstDry))) : null,
      worstDel: ys.reduce((a, y) => Math.max(a, y.deliveries), 0),
      withDel: ys.filter((y) => y.deliveries > 0).length,
      meanDel: ys.length ? ys.reduce((a, y) => a + y.deliveries, 0) / ys.length : 0,
    };
  }

  const STORY_RUNS = [
    { key: 'now', name: { en: 'Today', nl: 'Nu' }, short: { en: 'Today', nl: 'Nu' } },
    { key: 's1', name: { en: 'With step 1', nl: 'Met stap 1' }, short: { en: 'Step 1', nl: 'Stap 1' }, roofs: 1 },
    { key: 's12', name: { en: 'With steps 1 and 2', nl: 'Met stap 1 en 2' }, short: { en: 'Steps 1 + 2', nl: 'Stap 1 + 2' }, roofs: 1, tank: 1 },
  ];
  let story = null;

  function buildStory() {
    const base = freshDefaults();
    const off = Object.assign(clone(base), { tanker: 0 });
    const runs = {};
    for (const o of STORY_RUNS) runs[o.key] = Object.assign({}, o, { st: summaryOf(simulate(withSteps(off, o))) });
    runs.s2only = { st: summaryOf(simulate(withSteps(off, { tank: 1 }))) };
    const now = runs.now.st;
    const years = now.ys.map((y) => y.year);
    const byRain = now.ys.slice().sort((a, b) => a.rain - b.rain);
    story = {
      base, off, runs, years,
      last: years[years.length - 1],
      driest: byRain.length ? byRain[0].year : null,
      wettest: byRain.length ? byRain[byRain.length - 1].year : null,
    };
    story.example = story.last;
  }

  function renderStoryText() {
    const { base, runs } = story;
    const now = runs.now.st;
    const s1 = runs.s1.st;
    const s12 = runs.s12.st;
    const d = demand(base);
    const from = base.from;
    const season = tr(`${MONTHS[base.s0 - 1]} to ${MONTHS[base.s1 - 1]}`, `${MONTHS[base.s0 - 1]} tot ${MONTHS[base.s1 - 1]}`);
    const g = base.guests;

    let h1;
    if (now.ranDry === now.n) h1 = tr('The rainwater runs out every summer.', 'Het regenwater raakt elke zomer op.');
    else if (now.ranDry > now.n / 2) h1 = tr('The rainwater runs out most summers.', 'Het regenwater raakt de meeste zomers op.');
    else if (now.ranDry > 0) h1 = tr(`The rainwater runs out in ${now.ranDry} of ${now.n} summers.`, `Het regenwater raakt op in ${now.ranDry} van de ${now.n} zomers.`);
    else h1 = tr('The rainwater lasts the summer.', 'Het regenwater houdt de zomer vol.');
    setHTML('st_h1', h1);

    let t;
    if (now.ranDry) {
      const wet = now.byYear[story.wettest];
      const wetDry = wet && wet.dryDays >= 7;
      t = tr(`With a full house (${g} guests, ${season}), the tanks run dry around <b>${roughDate(now.runOut)}</b> and the house is ` +
        `<b>without water for about ${weeksText(Math.round(now.medianDry))}</b>, unless water is trucked in. ` +
        (now.ranDry === now.n ? `That's <b>every summer since ${from}</b>` : `That's <b>${now.ranDry} of the ${now.n} summers since ${from}</b>`) +
        (wetDry ? `; even the wettest (${story.wettest}) left ${weeksText(wet.dryDays)} without water.` : '.'),
      `Met een vol huis (${g} gasten, ${season}) staan de tanks rond <b>${roughDate(now.runOut)}</b> droog en zit het huis ` +
        `<b>ongeveer ${weeksText(Math.round(now.medianDry))} zonder water</b>, tenzij er water wordt aangevoerd. ` +
        (now.ranDry === now.n ? `Dat geldt voor <b>elke zomer sinds ${from}</b>` : `Dat geldt voor <b>${now.ranDry} van de ${now.n} zomers sinds ${from}</b>`) +
        (wetDry ? `; zelfs de natste (${story.wettest}) gaf ${weeksText(wet.dryDays)} zonder water.` : '.'));
    } else {
      t = tr(`With a full house (${g} guests, ${season}), the tanks would have lasted every summer since ${from}.`,
        `Met een vol huis (${g} gasten, ${season}) zouden de tanks het elke zomer sinds ${from} hebben volgehouden.`);
    }
    setHTML('st_today', t);

    // Step 1 on its own.
    const lastS1 = s1.byYear[story.last];
    setHTML('st_s1', !s1.ranDry
      ? tr('On its own, that would already be enough.', 'Dat alleen zou al genoeg zijn.')
      : lastS1 && lastS1.dryDays
        ? tr(`Not enough on its own: last summer would still have run dry on ${dayMonth(lastS1.firstDry)}.`,
          `Alleen dit is niet genoeg: vorige zomer zou het huis dan nog steeds op ${dayMonth(lastS1.firstDry)} droog hebben gestaan.`)
        : tr(`Not enough on its own: ${s1.ranDry} of ${s1.n} summers would still run dry.`,
          `Alleen dit is niet genoeg: ${s1.ranDry} van de ${s1.n} zomers zouden nog steeds droogvallen.`));

    // Step 2: the new tank, against the biggest tank there now.
    const kt = newTankRow(base);
    const tanks = base.tanklist.filter((x, k) => k !== kt && !x.g && x.on);
    const big = tanks.reduce((a, b) => (tankFootprint(b) * b.d > tankFootprint(a) * a.d ? b : a), tanks[0]);
    const newVol = kt >= 0 ? tankFootprint(base.tanklist[kt]) * base.tanklist[kt].d : 0;
    const size = big && newVol ? sizeWords(newVol / (tankFootprint(big) * big.d)) : '';
    setHTML('st_s2', big && newVol
      ? tr(`2. Add a buried tank ${size} the ${big.n.toLowerCase()}.`, `2. Plaats een ondergrondse tank, ${size} de ${showName(big.n).toLowerCase()}.`)
      : tr('2. Add a buried tank.', '2. Plaats een ondergrondse tank.'));

    // Both together.
    const dryNow = now.byYear[story.driest];
    const dry12 = s12.byYear[story.driest];
    let both = s12.ranDry
      ? tr(`<b>Together:</b> the water lasts the whole season in <b>${s12.n - s12.ranDry} of the ${s12.n} summers since ${from}</b>.`,
        `<b>Samen:</b> het water houdt het hele seizoen vol in <b>${s12.n - s12.ranDry} van de ${s12.n} zomers sinds ${from}</b>.`)
      : tr(`<b>Together:</b> the water lasts the whole season <b>every summer since ${from}</b>.`,
        `<b>Samen:</b> het water houdt het hele seizoen vol, <b>elke zomer sinds ${from}</b>.`);
    if (dry12 && dry12.dryDays && dryNow && dryNow.dryDays) {
      both += tr(` In the driest summer on record (${story.driest}) it runs out on ${dayMonth(dry12.firstDry)} instead of ${dayMonth(dryNow.firstDry)}.`,
        ` In de droogste zomer ooit gemeten (${story.driest}) raakt het water pas op ${dayMonth(dry12.firstDry)} op, in plaats van op ${dayMonth(dryNow.firstDry)}.`);
    } else if (dry12 && !dry12.dryDays) {
      both += tr(` Even the driest summer on record (${story.driest}) gets through.`, ` Zelfs de droogste zomer ooit gemeten (${story.driest}) komt erdoor.`);
    }
    setHTML('st_both', both);

    // Why it runs out.
    const perDay = d.season / 1000;
    const seasonLen = now.ys.length ? median(now.ys.map((y) => y.seasonDays)) : 184;
    const capNow = usableVolume(base);
    const cap12 = usableVolume(withSteps(base, { roofs: 1, tank: 1 }));
    const tankw = halves(capNow / perDay / 7);
    const tankw12 = halves(cap12 / perDay / 7);
    const seasonw = fmt(Math.round(seasonLen / 7));
    const need = fmt(Math.round(seasonLen / 7 - capNow / perDay / 7));
    const litres = fmt(Math.round(d.season / 10) * 10);
    setAll('why_from', String(from));

    // How summer rain arrives, from the gauge over the same summers.
    const mm = R.sources[base.src].mm;
    let tot = 0;
    let heavy = 0;
    const spells = [];
    for (const y of story.years) {
      let run = 0;
      let longest = 0;
      for (let i = yearStart(y); i < N && YEAR[i] === y; i++) {
        if (!inSeason(MONTH[i], base.s0, base.s1)) continue;
        tot += mm[i];
        if (mm[i] >= 10) heavy += mm[i];
        run = mm[i] < 2 ? run + 1 : 0;
        longest = Math.max(longest, run);
      }
      spells.push(longest);
    }
    const rain = `${fmt(tot / Math.max(1, story.years.length))} mm`;
    const heavyPct = `${fmt(heavy / Math.max(1, tot) * 100)}%`;
    const gap = weeksText(Math.round(median(spells)));
    const gapMax = weeksText(Math.max(...spells));
    setHTML('why_text', tr(
      `<p><b>The house uses water every day, but rain doesn't fall every day.</b> A full house uses about ${litres} litres a day ` +
        `(${fmt(d.perGuest)} litres a guest including the dual-flush toilets, laundry and dishwasher). Full tanks hold enough for about <b>${tankw} weeks</b>. ` +
        `The season is <b>${seasonw} weeks</b> long, so the other ${need} weeks' worth has to come from rain that falls during the summer itself.</p>` +
        `<p><b>Summer rain comes in bursts, with long gaps.</b> From ${season}, an average year brings ${rain} of rain, but ${heavyPct} of it falls ` +
        `on a few stormy days of 10 mm or more. A dry spell of ${gap} is normal, and the longest since ${from} lasted ${gapMax}.</p>`,
      `<p><b>Het huis verbruikt elke dag water, maar het regent niet elke dag.</b> Een vol huis verbruikt ongeveer ${litres} liter per dag ` +
        `(${fmt(d.perGuest)} liter per gast, inclusief de toiletten met spaarknop, de was en de vaatwasser). Volle tanks hebben genoeg voor ongeveer <b>${tankw} weken</b>. ` +
        `Het seizoen duurt <b>${seasonw} weken</b>, dus de overige ${need} weken moeten komen van regen die tijdens de zomer zelf valt.</p>` +
        `<p><b>Zomerregen komt in buien, met lange droge periodes ertussen.</b> Van ${season} valt er in een gemiddeld jaar ${rain} regen, maar ${heavyPct} daarvan ` +
        `valt op een paar stormachtige dagen met 10 mm of meer. Een droge periode van ${gap} is normaal, en de langste sinds ${from} duurde ${gapMax}.</p>`));

    const storm = (s) => halves(20 * wetArea(s) / 1000 / perDay);
    const days = (x) => `${x} ${tr('days', 'dagen')}`;
    const stormNow = days(storm(base));
    const storm1 = days(storm(withSteps(base, { roofs: 1 })));
    const ofN = (st) => tr(`${st.ranDry} of ${st.n}`, `${st.ranDry} van de ${st.n}`);
    setHTML('why_two', tr(
      `<ol class="steps"><li><b>More roof, so each storm brings in more.</b> A 20 mm downpour gives today's roofs ${stormNow} of water. ` +
        `With step 1, the same downpour gives ${storm1}.</li>` +
        `<li><b>More tank, to get through the gaps.</b> A bigger tank starts the summer with more weeks of water (${tankw12} instead of ${tankw}), ` +
        `and keeps more of the big storms instead of letting them overflow.</li></ol>` +
        `<p><b>Neither is enough alone.</b> Since ${from}, step 1 alone would still run dry in ${ofN(s1)} summers, ` +
        `and the new tank alone in ${ofN(runs.s2only.st)}. Both together: ${ofN(s12)}.</p>`,
      `<ol class="steps"><li><b>Meer dak, zodat elke bui meer oplevert.</b> Een stortbui van 20 mm levert de huidige daken ${stormNow} water op. ` +
        `Met stap 1 levert dezelfde bui ${storm1} op.</li>` +
        `<li><b>Meer tank, om de droge periodes te overbruggen.</b> Een grotere tank begint de zomer met meer weken water (${tankw12} in plaats van ${tankw}), ` +
        `en houdt meer van de grote buien vast in plaats van ze te laten overlopen.</li></ol>` +
        `<p><b>Geen van beide is in zijn eentje genoeg.</b> Sinds ${from} zou het huis met alleen stap 1 nog steeds droogvallen in ${ofN(s1)} zomers, ` +
        `en met alleen de nieuwe tank in ${ofN(runs.s2only.st)}. Met allebei: ${ofN(s12)}.</p>`));
  }

  // ---- The example summer: calendar strips and the tank level ---------------

  function exampleButtons() {
    const seen = new Set();
    const opts = [];
    const add = (y, label) => { if (y && !seen.has(y)) { seen.add(y); opts.push({ y, label }); } };
    add(story.last, tr(`Last summer (${story.last})`, `Vorige zomer (${story.last})`));
    add(story.driest, tr(`Driest summer (${story.driest})`, `Droogste zomer (${story.driest})`));
    add(story.wettest, tr(`Wettest summer (${story.wettest})`, `Natste zomer (${story.wettest})`));
    return opts;
  }

  function renderExampleSwitches() {
    const html = exampleButtons()
      .map((o) => `<button type="button" data-example="${o.y}" aria-pressed="${o.y === story.example}">${o.label}</button>`).join('');
    document.querySelectorAll('.ex-switch').forEach((el) => { el.innerHTML = html; });
  }

  // Days of the example summer's guest season, as indexes into a run.
  function seasonDays(r, year) {
    const out = [];
    for (let i = yearStart(year); i < N && YEAR[i] === year; i++) {
      if (inSeason(MONTH[i], r.s.s0, r.s.s1) && i >= r.i0) out.push(i - r.i0);
    }
    return out;
  }

  function renderStrips() {
    const y = story.example;
    let html = '';
    let days = [];
    for (const o of STORY_RUNS) {
      const st = story.runs[o.key].st;
      const r = st.r;
      days = seasonDays(r, y);
      // Runs of wet and dry days, as stretches of the strip.
      let segs = '';
      let k = 0;
      while (k < days.length) {
        const isDry = r.dry[days[k]];
        let e = k;
        while (e < days.length && r.dry[days[e]] === isDry) e++;
        segs += `<i class="${isDry ? 'dry' : 'wet'}" style="width:${(e - k) / days.length * 100}%"></i>`;
        k = e;
      }
      const Y = st.byYear[y];
      const out = Y && Y.dryDays
        ? tr(`Runs dry on ${dayMonth(Y.firstDry)}: <b class="bad">${weeksText(Y.dryDays)} without water</b>`,
          `Droog vanaf ${dayMonth(Y.firstDry)}: <b class="bad">${weeksText(Y.dryDays)} zonder water</b>`)
        : `<b class="good">${tr('Water all season', 'Het hele seizoen water')}</b>`;
      html += `<div class="strip-row"><div class="strip-name">${pick(o.name)}</div><div class="strip">${segs}</div><div class="strip-out">${out}</div></div>`;
    }
    // Month marks under the strips.
    const r0 = story.runs.now.st.r;
    let axis = '';
    days.forEach((j, k) => {
      const i = r0.i0 + j;
      if (DOM[i] === 1) axis += `<span style="left:${k / days.length * 100}%">${MONTHS_SHORT[MONTH[i] - 1]}</span>`;
    });
    html += `<div class="strip-axis"><div>${axis}</div></div>`;
    setHTML('strips', html);
    $('strips').setAttribute('aria-label', tr(`Each day of the ${y} season, with and without water, for the house today, with step 1, and with steps 1 and 2.`,
      `Elke dag van het seizoen ${y}, met en zonder water, voor het huis nu, met stap 1, en met stap 1 en 2.`));
    const g = story.base.guests;
    setHTML('strip_note', (y === story.last
      ? tr(`Last summer the house wasn't full; this shows what ${g} guests all season would have faced. `,
        `Vorige zomer was het huis niet vol; dit laat zien wat ${g} gasten het hele seizoen zouden hebben meegemaakt. `)
      : '') + tr('Blue: water in the tanks. Red: tanks empty. Nothing trucked in.', 'Blauw: water in de tanks. Rood: tanks leeg. Niets aangevoerd.'));
  }

  // The level in the tanks through the example summer, in weeks of water for a full house.
  function drawWhyChart() {
    const canvas = $('why_chart');
    if (!canvas || !story) return;
    const y = story.example;
    const w = canvas.clientWidth || 700;
    const h = canvas.clientHeight || 280;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const perDay = demand(story.base).season / 1000;
    const r0 = story.runs.now.st.r;
    const days = seasonDays(r0, y);
    if (!days.length || !(perDay > 0)) return;
    const pad = { l: 30, r: 78, t: 8, b: 22 };
    const pw = w - pad.l - pad.r;
    const ph = h - pad.t - pad.b;
    const top = Math.max(...STORY_RUNS.map((o) => story.runs[o.key].st.r.cap)) / perDay / 7;
    const ymax = Math.ceil(top / 2) * 2 || 2;
    const X = (k) => pad.l + k / (days.length - 1) * pw;
    const Yw = (wk) => pad.t + (1 - wk / ymax) * ph;

    // Grid in weeks.
    ctx.strokeStyle = 'rgba(130, 130, 130, 0.2)';
    ctx.lineWidth = 1;
    ctx.fillStyle = '#5f5e5a';
    ctx.font = '11px system-ui, sans-serif';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (let g = 0; g <= ymax; g += 2) {
      ctx.beginPath(); ctx.moveTo(pad.l, Yw(g)); ctx.lineTo(pad.l + pw, Yw(g)); ctx.stroke();
      ctx.fillText(String(g), pad.l - 6, Yw(g));
    }

    // Daily rain hanging from the top, up to 60 mm across the top third.
    const mm = R.sources[story.base.src].mm;
    ctx.fillStyle = 'rgba(61, 127, 196, 0.45)';
    const bw = Math.max(1.5, pw / days.length * 0.8);
    days.forEach((j, k) => {
      const v = mm[r0.i0 + j];
      if (v >= 1) ctx.fillRect(X(k) - bw / 2, pad.t, bw, Math.min(1, v / 60) * ph / 3);
    });

    // One line per option.
    const styles = { now: ['#a32d2d', []], s1: ['#c46a1c', [5, 4]], s12: ['#0f6e56', []] };
    const ends = [];
    for (const o of STORY_RUNS) {
      const r = story.runs[o.key].st.r;
      const [col, dash] = styles[o.key];
      ctx.strokeStyle = col;
      ctx.setLineDash(dash);
      ctx.lineWidth = o.key === 's12' ? 2.4 : 1.8;
      ctx.beginPath();
      days.forEach((j, k) => { const v = r.vol[j] / perDay / 7; if (k) ctx.lineTo(X(k), Yw(v)); else ctx.moveTo(X(k), Yw(v)); });
      ctx.stroke();
      ctx.setLineDash([]);
      ends.push({ y: Yw(r.vol[days[days.length - 1]] / perDay / 7), col, name: pick(o.short) });
    }
    // Names at the right-hand end, nudged apart so they don't overlap.
    ends.sort((a, b) => a.y - b.y);
    for (let k = 1; k < ends.length; k++) ends[k].y = Math.max(ends[k].y, ends[k - 1].y + 13);
    const over = ends.length ? ends[ends.length - 1].y - (pad.t + ph) : 0;
    if (over > 0) ends.forEach((e) => { e.y -= over; });
    ctx.textAlign = 'left';
    ctx.font = '600 11px system-ui, sans-serif';
    for (const e of ends) { ctx.fillStyle = e.col; ctx.fillText(e.name, pad.l + pw + 6, e.y); }

    // Months along the bottom.
    ctx.fillStyle = '#5f5e5a';
    ctx.font = '11px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    days.forEach((j, k) => {
      const i = r0.i0 + j;
      if (DOM[i] === 15) ctx.fillText(MONTHS_SHORT[MONTH[i] - 1], X(k), pad.t + ph + 5);
    });
    $('why_chart').setAttribute('aria-label', tr(`Weeks of water left in the tanks through the ${y} season, for the house today, with step 1, and with steps 1 and 2, with the daily rain.`,
      `Weken water in de tanks door het seizoen ${y} heen, voor het huis nu, met stap 1, en met stap 1 en 2, met de regen per dag.`));
    setHTML('why_chart_title', tr(`Water left in the tanks through the ${y} season, in weeks for a full house`,
      `Water in de tanks door het seizoen ${y} heen, in weken voor een vol huis`));
  }

  function setExample(y) {
    story.example = y;
    renderExampleSwitches();
    renderStrips();
    drawWhyChart();
  }

  // ---- Plan B: the rain sheet ------------------------------------------------

  let planBArea = SHEET_DEFAULT;
  function renderPlanB() {
    if (!story) return;
    const a = planBArea;
    setHTML('pb_area', `${fmt(a)} m²`);
    const sheetL = DEFAULT_SURFACES[SHEET_ROW].l;
    setHTML('pb_dims', `${fmt(sheetL)} × ${fmt(a / sheetL, 1)} m`);
    const st = (o) => summaryOf(simulate(withSteps(story.off, o)));
    const wt = (o) => summaryOf(simulate(withSteps(story.base, o)));
    const both = st({ roofs: 1, tank: 1, sheet: a });
    const instead = st({ roofs: 1, sheet: a });
    const both0 = story.runs.s12.st;
    const driest = story.driest;
    const dryLine = (x) => {
      const Y = x.byYear[driest];
      return Y && Y.dryDays
        ? tr(`${weeksText(Y.dryDays)} without water in ${driest}`, `${weeksText(Y.dryDays)} zonder water in ${driest}`)
        : tr(`water all through ${driest}`, `in ${driest} het hele seizoen water`);
    };
    const runs = (x) => (x.ranDry
      ? tr(`runs dry in <b>${x.ranDry} of ${x.n} summers</b>`, `valt droog in <b>${x.ranDry} van de ${x.n} zomers</b>`)
      : tr('<b>never runs dry</b>', '<b>valt nooit droog</b>'));
    setHTML('pb_both', a > 0
      ? tr(`<b>On top of steps 1 and 2:</b> ${runs(both)} (${both0.ranDry} without the sheet); ${dryLine(both)}.`,
        `<b>Bovenop stap 1 en 2:</b> ${runs(both)} (${both0.ranDry} zonder folie); ${dryLine(both)}.`)
      : tr(`<b>Steps 1 and 2 without a sheet:</b> ${runs(both0)}; ${dryLine(both0)}.`,
        `<b>Stap 1 en 2 zonder folie:</b> ${runs(both0)}; ${dryLine(both0)}.`));
    const typical = instead.medianDry
      ? tr(`a typical summer has ${weeksText(Math.round(instead.medianDry))} without water`, `een gewone zomer heeft ${weeksText(Math.round(instead.medianDry))} zonder water`)
      : tr('a typical summer has water all season', 'een gewone zomer heeft het hele seizoen water');
    setHTML('pb_instead', a > 0
      ? tr(`<b>Instead of the new tank (step 1 and the sheet):</b> ${runs(instead)}; ${typical}; ${dryLine(instead)}.`,
        `<b>In plaats van de nieuwe tank (stap 1 en de folie):</b> ${runs(instead)}; ${typical}; ${dryLine(instead)}.`)
      : '');
    const tb = wt({ roofs: 1, tank: 1, sheet: a });
    const ti = wt({ roofs: 1, sheet: a });
    setHTML('pb_tankers', a > 0
      ? tr(`If tankers are called: worst summer ${tb.worstDel} ${plural(tb.worstDel, 'delivery', 'deliveries')} with steps 1 and 2 and the sheet, ${ti.worstDel} with step 1 and the sheet.`,
        `Als er tankwagens komen: in de slechtste zomer ${tb.worstDel} ${plural(tb.worstDel, 'levering', 'leveringen')} met stap 1 en 2 en de folie, ${ti.worstDel} met stap 1 en de folie.`)
      : tr(`If tankers are called: worst summer ${tb.worstDel} ${plural(tb.worstDel, 'delivery', 'deliveries')} with steps 1 and 2.`,
        `Als er tankwagens komen: in de slechtste zomer ${tb.worstDel} ${plural(tb.worstDel, 'levering', 'leveringen')} met stap 1 en 2.`));
    setHTML('pb_site', a > 155
      ? `<span class="warn">${tr('Beyond about 155 m², check the map and the ground again: the slope surveyed so far takes a sheet of about 20 × 7.75 m.',
        'Boven ongeveer 155 m² moeten de kaart en het terrein opnieuw bekeken worden: op de tot nu toe opgemeten helling past een folie van ongeveer 20 × 7,75 m.')}</span>`
      : tr('Fits the open slope south of the buildings: the survey shows room for at least 20 × 7.75 m (155 m²).',
        'Past op de open helling ten zuiden van de gebouwen: volgens de opname is er ruimte voor minstens 20 × 7,75 m (155 m²).'));
  }

  // ---- The numbers behind it: the options and how much roof and tank it takes -

  function renderOptions() {
    const sheet = fmt(SHEET_DEFAULT);
    const rows = [
      { name: tr('As now', 'Zoals nu'), o: {}, cost: tr('None', 'Geen') },
      { name: tr('Step 1: gutter the yoga building, car port and house terrace', 'Stap 1: dakgoten op het yogagebouw, de carport en het terras bij het huis'),
        o: { roofs: 1 }, cost: tr('Rough guess €1,500–5,000', 'Ruwe schatting € 1.500–5.000') },
      { name: tr('Steps 1 and 2: plus the new buried tank', 'Stap 1 en 2: plus de nieuwe ondergrondse tank'),
        o: { roofs: 1, tank: 1 }, cost: tr('Step 1 plus the tank: to be quoted', 'Stap 1 plus de tank: offerte aanvragen'), best: 1 },
      { name: tr(`Steps 1 and 2 plus a ${sheet} m² rain sheet (plan B on top)`, `Stap 1 en 2 plus een opvangfolie van ${sheet} m² (plan B erbovenop)`),
        o: { roofs: 1, tank: 1, sheet: SHEET_DEFAULT }, cost: tr('Plus about €2,500–4,500 for the sheet (rough)', 'Plus ongeveer € 2.500–4.500 voor de folie (ruw)') },
      { name: tr(`Step 1 and a ${sheet} m² rain sheet, no new tank`, `Stap 1 en een opvangfolie van ${sheet} m², geen nieuwe tank`),
        o: { roofs: 1, sheet: SHEET_DEFAULT }, cost: tr('Step 1 plus about €2,500–4,500 (rough)', 'Stap 1 plus ongeveer € 2.500–4.500 (ruw)') },
    ];
    const limit = 3;
    let h = `<thead><tr><th>${tr('Option', 'Optie')}</th><th class="num">${tr('Typical summer without water', 'Gewone zomer zonder water')}</th>` +
      `<th class="num">${tr('Driest summer', 'Droogste zomer')} (${story.driest})</th><th class="num">${tr('Summers that run dry', 'Zomers die droogvallen')}</th>` +
      `<th class="num">${tr('Tankers a summer: average / worst', 'Tankwagens per zomer: gemiddeld / slechtste')}</th><th>${tr('Cost', 'Kosten')}</th></tr></thead><tbody>`;
    for (const row of rows) {
      const a = summaryOf(simulate(withSteps(story.off, row.o)));
      const b = summaryOf(simulate(withSteps(story.base, row.o)));
      const dry = a.byYear[story.driest];
      h += `<tr${row.best ? ' class="best"' : ''}><td>${row.best ? '<b>' + row.name + '</b>' : row.name}</td>` +
        `<td class="num">${a.medianDry ? weeksText(Math.round(a.medianDry)) : tr('none', 'geen')}</td>` +
        `<td class="num">${dry && dry.dryDays ? weeksText(dry.dryDays) : tr('none', 'geen')}</td>` +
        `<td class="num">${tr(`${a.ranDry} of ${a.n}`, `${a.ranDry} van ${a.n}`)}</td>` +
        `<td class="num">${oneDp(b.meanDel)} / <span class="${b.worstDel > limit ? 'bad' : 'good'}">${b.worstDel}</span></td>` +
        `<td>${row.cost}</td></tr>`;
    }
    setHTML('options', h + '</tbody>');
  }

  function renderSizing() {
    const base = story.base;
    const key = (x) => Math.round(x);
    // Close values count as one, keeping the first (the house's own options come first).
    const uniq = (xs) => xs.filter((x, k) => xs.findIndex((y) => Math.abs(y - x) < 8) === k).sort((p, q) => p - q);
    const s1 = withSteps(base, { roofs: 1 });
    const extra = base.surfaces.reduce((a, x, k) => a + (!x.g && !x.on && !step1Rows(base).includes(k) ? x.l * x.w : 0), 0);
    const tags = {};
    const tag = (A, V, t) => { tags[key(A) + '|' + key(V)] = t; };
    const volNow = tankVolume(base);
    const vol12 = tankVolume(withSteps(base, { roofs: 1, tank: 1 }));
    tag(catchment(base), volNow, tr('today', 'nu'));
    tag(catchment(s1), volNow, tr('step 1', 'stap 1'));
    tag(catchment(s1), vol12, tr('steps 1 + 2', 'stap 1 + 2'));
    const rows = uniq([catchment(base), catchment(s1), catchment(s1) + extra, 230, 400]);
    const cols = uniq([volNow, vol12, 70, 100, 120]);
    let h = `<thead><tr><th>${tr('Roof m² \\ tanks m³', 'Dak m² \\ tanks m³')}</th>` + cols.map((v) => `<th class="num">${fmt(v)}</th>`).join('') + '</tr></thead><tbody>';
    for (const A of rows) {
      h += `<tr><th>${fmt(A)}</th>`;
      for (const V of cols) {
        const s = clone(base);
        s.surfaces = [{ n: 'Roofs', l: A, w: 1, on: 1 }];
        s.tanklist = [{ n: 'Tanks', shape: 'box', l: V, w: 1, d: 1, on: 1 }];
        const x = summaryOf(simulate(s));
        const t = tags[key(A) + '|' + key(V)];
        h += `<td class="num cell ${x.worstDel > 3 ? 'over' : x.worstDel ? 'near' : 'zero'}${t ? ' here' : ''}">` +
          `<b>${x.worstDel}</b><span class="tag">${x.withDel ? tr(`in ${x.withDel} of ${x.n}`, `in ${x.withDel} van ${x.n}`) : tr('never', 'nooit')}</span>${t ? `<span class="tag here-tag">${t}</span>` : ''}</td>`;
      }
      h += '</tr>';
    }
    setHTML('sizing', h + '</tbody>');
  }

  function renderStory() {
    renderStoryText();
    renderExampleSwitches();
    renderStrips();
    drawWhyChart();
    renderPlanB();
    renderOptions();
    renderSizing();
  }

  // ---- Chart ---------------------------------------------------------------

  let chartData = null;
  let layout = null;
  // The stretch of time shown on the chart, as ISO dates; null means the start or end of the period.
  let view = { from: null, to: null };
  const MIN_VIEW_DAYS = 14;

  // Visible range as day offsets [a, b] into the simulation, clamped to the simulated period.
  function viewRange(r) {
    const last = r.L - 1;
    let a = view.from ? indexOf(view.from) - r.i0 : 0;
    let b = view.to ? indexOf(view.to) - r.i0 : last;
    if (a > b) [a, b] = [b, a];
    a = Math.max(0, Math.min(last, a));
    b = Math.max(0, Math.min(last, b));
    if (b - a < MIN_VIEW_DAYS) {
      b = Math.min(last, a + MIN_VIEW_DAYS);
      a = Math.max(0, b - MIN_VIEW_DAYS);
    }
    return [a, b];
  }

  function setView(from, to) {
    view = { from: from || null, to: to || null };
    $('hair').style.display = 'none';
    $('tip').style.display = 'none';
    syncViewInputs();
    drawChart();
    writeHash();
  }

  function syncViewInputs() {
    if (!chartData) return;
    const { r } = chartData;
    const [a, b] = viewRange(r);
    const fromEl = $('view_from');
    const toEl = $('view_to');
    fromEl.min = toEl.min = isoAt(r.i0);
    fromEl.max = toEl.max = isoAt(r.i0 + r.L - 1);
    fromEl.value = isoAt(r.i0 + a);
    toEl.value = isoAt(r.i0 + b);
    const sel = $('view_year');
    const first = String(YEAR[r.i0]);
    if (sel.dataset.first !== first) {
      let options = `<option value="">${tr('choose…', 'kies…')}</option>`;
      for (let y = LAST_YEAR; y >= YEAR[r.i0]; y--) options += `<option value="${y}">${y}</option>`;
      sel.innerHTML = options;
      sel.dataset.first = first;
    }
    sel.value = '';
  }

  function drawChart() {
    if (!chartData) return;
    const { r, rb } = chartData;
    const canvas = $('chart');
    const w = canvas.clientWidth || 700;
    const h = canvas.clientHeight || 320;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const pad = { l: 50, r: 8, t: 10, b: 22 };
    const pw = w - pad.l - pad.r;
    const ph = h - pad.t - pad.b;
    const [a, b] = viewRange(r);
    const span = b - a;
    const ymax = Math.max(r.cap, rb ? rb.cap : 0) || 1;
    const X = (j) => pad.l + (j - a) / span * pw;
    const Y = (v) => pad.t + (1 - v / ymax) * ph;
    layout = { pad, pw, ph, a, b, X, Y };

    // Everything inside the plot is clipped to it.
    ctx.save();
    ctx.beginPath();
    ctx.rect(pad.l, 0, pw, h);
    ctx.clip();

    // Guest season
    ctx.fillStyle = 'rgba(216, 90, 48, 0.08)';
    let open = -1;
    for (let j = a; j <= b + 1; j++) {
      const on = j <= b && inSeason(MONTH[r.i0 + j], r.s.s0, r.s.s1);
      if (on && open < 0) open = j;
      if (!on && open >= 0) { ctx.fillRect(X(open), pad.t, Math.max(1, X(Math.min(j, b)) - X(open)), ph); open = -1; }
    }

    // Horizontal grid
    ctx.strokeStyle = 'rgba(130, 130, 130, 0.2)';
    ctx.lineWidth = 1;
    for (let g = 0; g <= 4; g++) {
      const y = Y(ymax * g / 4);
      ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(w - pad.r, y); ctx.stroke();
    }

    // Tanker trigger
    if (r.s.tanker && r.trigger > 0) {
      ctx.strokeStyle = 'rgba(216, 90, 48, 0.55)';
      ctx.setLineDash([4, 4]);
      ctx.beginPath(); ctx.moveTo(pad.l, Y(r.trigger)); ctx.lineTo(w - pad.r, Y(r.trigger)); ctx.stroke();
      ctx.setLineDash([]);
    }

    const trace = (vol) => {
      ctx.beginPath();
      ctx.moveTo(X(a), Y(vol[a]));
      for (let j = a + 1; j <= b; j++) ctx.lineTo(X(j), Y(vol[j]));
    };

    // Current settings
    trace(r.vol);
    ctx.lineTo(X(b), Y(0));
    ctx.lineTo(X(a), Y(0));
    ctx.closePath();
    ctx.fillStyle = 'rgba(29, 158, 117, 0.12)';
    ctx.fill();
    trace(r.vol);
    ctx.strokeStyle = '#1D9E75';
    ctx.lineWidth = span < 800 ? 1.8 : 1.3;
    ctx.stroke();

    // Comparison setup
    if (rb) {
      trace(rb.vol);
      ctx.strokeStyle = 'rgba(95, 94, 90, 0.75)';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 3]);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Tanker deliveries
    if (r.s.tanker) {
      ctx.fillStyle = '#D85A30';
      const base = pad.t + ph;
      const size = span < 800 ? 5 : 3.5;
      for (const j of r.deliveryDays) {
        if (j < a || j > b) continue;
        const x = X(j);
        ctx.beginPath(); ctx.moveTo(x - size, base); ctx.lineTo(x + size, base); ctx.lineTo(x, base - size * 2); ctx.closePath(); ctx.fill();
      }
    }
    ctx.restore();

    // Axis labels
    ctx.fillStyle = '#5f5e5a';
    ctx.font = '11px system-ui, sans-serif';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (let g = 0; g <= 4; g++) ctx.fillText(fmt(ymax * g / 4) + ' m³', pad.l - 5, Y(ymax * g / 4));

    // Time labels: years for long views, months for a few years or less, days for a few weeks.
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    const label = (j, text) => ctx.fillText(text, Math.min(w - pad.r - 12, Math.max(pad.l + 12, X(j))), h - pad.b + 5);
    if (span > 1100) {
      const step = [1, 2, 5, 10].find((k) => k * pw / (span / 365.25) >= 34) || 10;
      for (let j = a; j <= b; j++) {
        const i = r.i0 + j;
        if (MONTH[i] === 1 && DOM[i] === 1 && YEAR[i] % step === 0) label(j, String(YEAR[i]));
      }
    } else if (span > 75) {
      const step = [1, 2, 3, 6].find((k) => k * pw / (span / 30.44) >= 40) || 6;
      for (let j = a; j <= b; j++) {
        const i = r.i0 + j;
        if (DOM[i] === 1 && (MONTH[i] - 1) % step === 0) label(j, MONTH[i] === 1 ? String(YEAR[i]) : MONTHS_SHORT[MONTH[i] - 1]);
      }
    } else {
      const step = [1, 2, 7].find((k) => k * pw / span >= 44) || 7;
      for (let j = a; j <= b; j += step) label(j, DOM[r.i0 + j] + ' ' + MONTHS_SHORT[MONTH[r.i0 + j] - 1]);
    }
  }

  // Day offset in the simulation under a screen x position.
  function dayAt(clientX) {
    const rect = $('chart').getBoundingClientRect();
    const { pad, pw, a, b } = layout;
    return a + Math.round((clientX - rect.left - pad.l) / pw * (b - a));
  }

  function showTip(clientX) {
    if (!chartData || !layout) return;
    const { r, rb } = chartData;
    const rect = $('chart').getBoundingClientRect();
    const { a, b, X } = layout;
    const j = dayAt(clientX);
    const hair = $('hair');
    const tip = $('tip');
    if (j < a || j > b) { hair.style.display = 'none'; tip.style.display = 'none'; return; }
    const i = r.i0 + j;
    const rain = R.sources[r.s.src].mm[i] * climateFactor(MONTH[i], r.s);
    tip.innerHTML = `<b>${longDate(isoAt(i))}</b><br>${tr('In the tanks', 'In de tanks')}: ${m3(r.vol[j])}` +
      (rb ? `<br>${tr('Comparison setup', 'Vergelijking')}: ${m3(rb.vol[j])}` : '') +
      `<br>${tr('Rain that day', 'Regen die dag')}: ${fmt(rain, 1)} mm` +
      (r.deliveryDays.includes(j) ? `<br>${tr('Tanker delivery', 'Levering per tankwagen')}` : '');
    const px = X(j);
    hair.style.left = px + 'px';
    hair.style.display = 'block';
    tip.style.display = 'block';
    const tw = tip.offsetWidth;
    tip.style.left = (px + 12 + tw > rect.width ? px - 12 - tw : px + 12) + 'px';
  }

  // ---- Calibration ---------------------------------------------------------

  const cal = {
    rain: [{ d0: '', l0: '', d1: '', l1: '' }],
    use: { d0: '', l0: '', d1: '', l1: '', g: '' },
  };

  // Rain recorded at the Anglars gauge from day i0 up to (not including) day i1, as each
  // gauge reading covers 06:00 UTC that day to 06:00 UTC the next.
  function rainBetween(i0, i1, s) {
    const mm = R.sources.anglars.mm;
    let raw = 0;
    let usable = 0;
    for (let i = Math.max(0, i0); i < Math.min(N, i1); i++) { raw += mm[i]; usable += harvestMm(mm[i], s); }
    return { raw, usable };
  }

  function buildCalibration() {
    const maxDate = isoAt(N);
    const dateIn = (attrs) => `<input type="date" min="${R.start}" max="${maxDate}" ${attrs}>`;
    const numIn = (attrs) => `<input type="number" step="0.5" min="0" ${attrs}>`;
    const depth = tr('Depth (cm)', 'Diepte (cm)');
    let h = `<thead><tr><th>${tr('Before: date', 'Voor: datum')}</th><th>${depth}</th><th>${tr('After: date', 'Na: datum')}</th>` +
      `<th>${depth}</th><th>${tr('Result', 'Resultaat')}</th></tr></thead><tbody>`;
    cal.rain.forEach((row, k) => {
      h += `<tr><td>${dateIn(`data-cr="${k}" data-f="d0"`)}</td><td>${numIn(`data-cr="${k}" data-f="l0"`)}</td>` +
        `<td>${dateIn(`data-cr="${k}" data-f="d1"`)}</td><td>${numIn(`data-cr="${k}" data-f="l1"`)}</td>` +
        `<td class="small" id="cr_out_${k}"></td></tr>`;
    });
    $('cal_rain').innerHTML = h + '</tbody>';
    document.querySelectorAll('[data-cr]').forEach((el) => { el.value = cal.rain[+el.dataset.cr][el.dataset.f]; });

    $('cal_use').innerHTML = `<thead><tr><th>${tr('Start: date', 'Begin: datum')}</th><th>${depth}</th><th>${tr('End: date', 'Eind: datum')}</th>` +
      `<th>${depth}</th><th>${tr('Guests', 'Gasten')}</th></tr></thead><tbody><tr>` +
      `<td>${dateIn('data-cu="d0"')}</td><td>${numIn('data-cu="l0"')}</td><td>${dateIn('data-cu="d1"')}</td><td>${numIn('data-cu="l1"')}</td>` +
      '<td><input type="number" min="1" max="30" step="1" data-cu="g"></td></tr></tbody>';
    document.querySelectorAll('[data-cu]').forEach((el) => { el.value = cal.use[el.dataset.cu]; });
  }

  function calcRain(row) {
    if (!row.d0 || !row.d1 || row.l0 === '' || row.l1 === '') return { text: '' };
    const i0 = indexOf(row.d0);
    const i1 = indexOf(row.d1);
    if (!(i1 > i0)) return { text: tr('The second reading needs to be after the first.', 'De tweede meting moet na de eerste komen.') };
    if (i0 < 0 || i1 > N) {
      return { text: tr(`Rain data covers ${longDate(R.start)} to ${longDate(R.end)}.`, `De neerslaggegevens lopen van ${longDate(R.start)} tot ${longDate(R.end)}.`) };
    }
    const rain = rainBetween(i0, i1, state);
    // The proposed ground sheet isn't built, so it's left out. Other surfaces with their own share are
    // taken off first; what's left measures the surfaces that use the general setting.
    const general = state.surfaces.reduce((a, x) => a + (x.on && !x.g && !ownShare(x) ? x.l * x.w : 0), 0);
    const fixedWet = state.surfaces.reduce((a, x) => a + (x.on && !x.g && ownShare(x) ? x.l * x.w * x.e / 100 : 0), 0);
    const gained = (parseFloat(row.l1) - parseFloat(row.l0)) / 100 * planArea(state);
    if (rain.raw < 3) {
      return { text: tr(`Only ${fmt(rain.raw, 1)} mm fell between those readings. Pick a wetter spell.`,
        `Er viel maar ${fmt(rain.raw, 1)} mm tussen die metingen. Kies een nattere periode.`) };
    }
    if (!(rain.usable > 0)) return { text: tr('Tick at least one collecting surface first.', 'Vink eerst minstens één opvangoppervlak aan.') };
    if (!(general > 0)) {
      return { text: tr('This measures the surfaces that use the general setting. Tick at least one roof.',
        'Dit meet de oppervlakken met de algemene instelling. Vink minstens één dak aan.') };
    }
    const eff = (gained - rain.usable * fixedWet / 1000) / (rain.usable * general / 1000) * 100;
    return {
      eff,
      text: tr(`${fmt(rain.raw, 1)} mm of rain, tanks gained ${m3(gained)}: <b>${fmt(eff)}%</b> reached the tanks` +
        (fixedWet > 0 ? ' from the roofs, after allowing for the surfaces with their own share.' : '.'),
      `${fmt(rain.raw, 1)} mm regen, de tanks kregen ${m3(gained)} erbij: <b>${fmt(eff)}%</b> kwam in de tanks` +
        (fixedWet > 0 ? ' van de daken, na aftrek van de oppervlakken met een eigen percentage.' : '.')),
    };
  }

  function calcUse(u) {
    const g = parseFloat(u.g);
    if (!u.d0 || !u.d1 || u.l0 === '' || u.l1 === '' || !(g > 0)) return { text: '' };
    const i0 = indexOf(u.d0);
    const i1 = indexOf(u.d1);
    if (!(i1 > i0)) return { text: tr('The end date needs to be after the start date.', 'De einddatum moet na de begindatum liggen.') };
    const days = i1 - i0;
    const rain = rainBetween(i0, i1, state);
    const built = Object.assign({}, state, { surfaces: state.surfaces.filter((x) => !x.g) });
    const fromRain = rain.usable * wetArea(built) / 1000;
    const drop = (parseFloat(u.l0) - parseFloat(u.l1)) / 100 * planArea(state);
    const lpd = (drop + fromRain) * 1000 / (g * days);
    let text = tr(`Over ${days} ${plural(days, 'day', 'days')} the tanks went down by ${m3(drop)}` +
      (fromRain > 0.05 ? ` while rain added about ${m3(fromRain)}` : '') +
      `: <b>${fmt(lpd)} litres per guest per day</b>, laundry and dishwasher included.`,
    `In ${days} ${plural(days, 'dag', 'dagen')} daalden de tanks met ${m3(drop)}` +
      (fromRain > 0.05 ? `, terwijl de regen ongeveer ${m3(fromRain)} toevoegde` : '') +
      `: <b>${fmt(lpd)} liter per gast per dag</b>, inclusief was en vaatwasser.`);
    if (i1 > N) {
      text += tr(` Rain data only runs to ${longDate(R.end)}, so any rain after that isn't counted.`,
        ` De neerslaggegevens lopen maar tot ${longDate(R.end)}, dus regen daarna telt niet mee.`);
    }
    return { lpd, text };
  }

  function renderCalibration() {
    const effs = [];
    cal.rain.forEach((row, k) => {
      const c = calcRain(row);
      setHTML('cr_out_' + k, c.text);
      if (isFinite(c.eff) && c.eff > 0) effs.push(c.eff);
    });
    if (effs.length) {
      const avg = effs.reduce((a, b) => a + b, 0) / effs.length;
      setHTML('cal_rain_out', tr(`Average of ${effs.length} ${plural(effs.length, 'spell', 'spells')}: <b>${fmt(avg)}%</b> of the rain reaches the tanks ` +
        `(the page is using ${state.eff}%). <button type="button" data-apply-eff="${Math.round(avg)}">Use ${fmt(avg)}%</button>`,
      `Gemiddelde van ${effs.length} ${plural(effs.length, 'periode', 'periodes')}: <b>${fmt(avg)}%</b> van de regen komt in de tanks ` +
        `(de pagina gebruikt ${state.eff}%). <button type="button" data-apply-eff="${Math.round(avg)}">Gebruik ${fmt(avg)}%</button>`));
    } else setHTML('cal_rain_out', '');
    const u = calcUse(cal.use);
    setHTML('cal_use_out', u.text + (isFinite(u.lpd) && u.lpd > 0
      ? ` <button type="button" data-apply-lpd="${Math.round(u.lpd)}">${tr(`Use ${fmt(u.lpd)} litres per guest per day`, `Gebruik ${fmt(u.lpd)} liter per gast per dag`)}</button>` : ''));
  }

  // ---- Settings in the page address ----------------------------------------

  function toHash(s) {
    const p = new URLSearchParams();
    for (const k of Object.keys(DEFAULTS)) if (s[k] !== DEFAULTS[k]) p.set(k, s[k]);
    if (JSON.stringify(s.surfaces) !== JSON.stringify(DEFAULT_SURFACES)) {
      // Names are only written when they differ from the default name for that row; a surface's
      // own share is written as e<percent>.
      p.set('surf', s.surfaces.map((x, k) => {
        const parts = [x.on ? 1 : 0, x.l, x.w];
        if (ownShare(x)) parts.push('e' + x.e);
        if (x.g) parts.push('g');
        if (!DEFAULT_SURFACES[k] || DEFAULT_SURFACES[k].n !== x.n) parts.push(x.n.replace(/[~|]/g, ' '));
        return parts.join('~');
      }).join('|'));
    }
    if (JSON.stringify(s.tanklist) !== JSON.stringify(DEFAULT_TANKS)) {
      p.set('tk', s.tanklist.map((t, k) => {
        const parts = [t.on ? 1 : 0, t.shape === 'round' ? 'r' : 'b', t.l, t.w, t.d];
        if (t.g) parts.push('g');
        if (!DEFAULT_TANKS[k] || DEFAULT_TANKS[k].n !== t.n) parts.push(t.n.replace(/[~|]/g, ' '));
        return parts.join('~');
      }).join('|'));
    }
    if (LANG === 'nl') p.set('lang', 'nl');
    if (view.from) p.set('vf', view.from);
    if (view.to) p.set('vt', view.to);
    return p.toString();
  }

  function viewFromHash(hash) {
    const p = new URLSearchParams(hash.replace(/^#/, ''));
    const date = (v) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
    return { from: date(p.get('vf')), to: date(p.get('vt')) };
  }

  function fromHash(hash) {
    const s = freshDefaults();
    const p = new URLSearchParams(hash.replace(/^#/, ''));
    for (const k of Object.keys(DEFAULTS)) {
      if (!p.has(k)) continue;
      const v = p.get(k);
      if (STRING_KEYS.has(k)) s[k] = v;
      else if (isFinite(parseFloat(v))) s[k] = parseFloat(v);
    }
    if (p.has('surf')) {
      const parts = p.get('surf').split('|').filter(Boolean);
      const n0 = parts.length;
      const list = parts.map((t, k) => {
        const [on, l, w, ...rest] = t.split('~');
        const x = { n: '', l: parseFloat(l) || 0, w: parseFloat(w) || 0, on: on === '1' ? 1 : 0 };
        if (rest.length && /^e\d+(\.\d+)?$/.test(rest[0])) x.e = parseFloat(rest.shift().slice(1));
        if (rest[0] === 'g') { rest.shift(); x.g = 1; }
        // Links from before the marker existed: the unnamed row in the sheet's place is the sheet.
        if (k === SHEET_ROW && !rest.length) x.g = 1;
        x.n = rest.join(' ') || (DEFAULT_SURFACES[k] ? DEFAULT_SURFACES[k].n : 'Other surface');
        return x;
      });
      // Links made before the ground sheet existed don't have it: put it back in its usual place,
      // ahead of any surfaces added by hand.
      if (list.length && !list.some((x) => x.g)) list.splice(Math.min(SHEET_ROW, list.length), 0, clone(DEFAULT_SURFACES[SHEET_ROW]));
      // Default surfaces added since the link was made (such as the car port roof) go in their usual place.
      DEFAULT_SURFACES.forEach((d, k) => {
        if (list.length && k >= n0 && !d.g && !list.some((x) => !x.g && x.n === d.n)) list.splice(Math.min(k, list.length), 0, clone(d));
      });
      if (list.length) s.surfaces = list;
    }
    if (p.has('tk')) {
      const tparts = p.get('tk').split('|').filter(Boolean);
      const t0 = tparts.length;
      const list = tparts.map((t, k) => {
        const [on, shape, l, w, d, ...rest] = t.split('~');
        const tank = {
          n: '', shape: shape === 'r' ? 'round' : 'box',
          l: parseFloat(l) || 0, w: parseFloat(w) || 0, d: parseFloat(d) || 0,
          on: on === '1' ? 1 : 0,
        };
        if (rest[0] === 'g') { rest.shift(); tank.g = 1; }
        tank.n = rest.join(' ') || (DEFAULT_TANKS[k] ? DEFAULT_TANKS[k].n : 'Tank ' + (k + 1));
        return tank;
      });
      // Links made before the extra tank existed: put it back in its usual place.
      if (list.length && !list.some((t) => t.g)) list.splice(Math.min(SHEET_TANK_ROW, list.length), 0, clone(DEFAULT_TANKS[SHEET_TANK_ROW]));
      // Default tanks added since the link was made (such as the new buried tank) go in their usual place.
      DEFAULT_TANKS.forEach((d, k) => {
        if (list.length && k >= t0 && !d.g && !list.some((t) => !t.g && t.n === d.n)) list.splice(Math.min(k, list.length), 0, clone(d));
      });
      if (list.length) s.tanklist = list;
    } else if (['tanks', 'tl', 'tw', 'td'].some((k) => p.has(k))) {
      // Links made before tanks became a list described n identical box tanks.
      const num = (k, def) => (isFinite(parseFloat(p.get(k))) ? parseFloat(p.get(k)) : def);
      const count = Math.max(1, Math.round(num('tanks', 2)));
      s.tanklist = Array.from({ length: count }, (_, k) => (
        { n: 'Tank ' + (k + 1), shape: 'box', l: num('tl', 4), w: num('tw', 4), d: num('td', 4), on: 1 }));
      s.tanklist.push(clone(DEFAULT_TANKS[SHEET_TANK_ROW]));
      s.tanklist.push(clone(DEFAULT_TANKS.find((t) => t.n === NEW_TANK)));
    }
    // Links made before supplier and distance existed had one call-out charge per delivery.
    if (p.has('callout') && !p.has('fixed') && !p.has('km')) {
      const c = parseFloat(p.get('callout'));
      if (isFinite(c)) { s.fixed = c; s.km = 0; s.supplier = 'custom'; }
    }
    const sup = SUPPLIERS.find((x) => x.id === s.supplier);
    if (!sup || (sup.km !== null && sup.km !== s.km)) s.supplier = 'custom';
    const truck = TRUCKS.find((x) => x.id === s.truck);
    if (!truck || (truck.load !== null && truck.load !== s.load)) s.truck = 'custom';
    if (!has(R.sources, s.src)) s.src = DEFAULTS.src;
    if (!has(TOILET_LITRES, s.toilet)) s.toilet = DEFAULTS.toilet;
    s.guests = Math.min(MAX_GUESTS, Math.max(0, Math.round(s.guests)));
    s.s0 = Math.min(12, Math.max(1, Math.round(s.s0)));
    s.s1 = Math.min(12, Math.max(1, Math.round(s.s1)));
    if (s.mode !== 'direct') s.mode = 'build';
    s.from = Math.min(LAST_FULL_YEAR, Math.max(FIRST_YEAR, Math.round(s.from)));
    return s;
  }

  // The address bar only ever shows the plain link (and the language), so whoever copies it from there
  // shares the defaults. Settings travel only in a link made with "Copy link to these settings", and
  // are cleared from the address once the page has read them.
  function writeHash() {
    const h = LANG === 'nl' ? 'lang=nl' : '';
    try { history.replaceState(null, '', h ? '#' + h : location.pathname + location.search); } catch (e) { /* file:// in some browsers */ }
  }
  const shareUrl = () => {
    const h = toHash(state);
    return location.href.split('#')[0] + (h ? '#' + h : '');
  };

  // ---- Inputs --------------------------------------------------------------

  let surfRows = [];

  function renderSurfaces() {
    const box = $('surfaces');
    box.innerHTML = '';
    surfRows = state.surfaces.map((x, k) => {
      const el = document.createElement('div');
      el.className = 'surf-row';
      el.innerHTML = `<input type="checkbox" aria-label="${tr('Connected to the tanks', 'Aangesloten op de tanks')}"> ` +
        `<input type="text" maxlength="40" aria-label="${tr('Name', 'Naam')}"> ` +
        `<input type="number" min="0" max="200" step="0.1" aria-label="${tr('Length in metres', 'Lengte in meters')}"> × ` +
        `<input type="number" min="0" max="200" step="0.1" aria-label="${tr('Width in metres', 'Breedte in meters')}"> m ` +
        '<span class="area"></span>' +
        `<span class="share"><input type="number" min="1" max="100" step="1" aria-label="${tr('Share of rain reaching the tanks, %; blank uses the general setting',
          'Deel van de regen dat in de tanks komt, %; leeg gebruikt de algemene instelling')}"> ${tr('% reaches tanks', '% naar tanks')}</span>` +
        (k >= DEFAULT_SURFACES.length && !x.g ? ` <button type="button" class="small-btn">${tr('Remove', 'Verwijderen')}</button>` : '');
      const [on, name, len, wid, share] = el.querySelectorAll('input');
      on.checked = !!x.on;
      name.value = showName(x.n);
      len.value = x.l;
      wid.value = x.w;
      share.value = ownShare(x) ? x.e : '';
      on.addEventListener('change', () => { x.on = on.checked ? 1 : 0; schedule(); });
      name.addEventListener('input', () => { x.n = name.value; schedule(); });
      len.addEventListener('input', () => { const v = parseFloat(len.value); if (isFinite(v)) { x.l = v; schedule(); } });
      wid.addEventListener('input', () => { const v = parseFloat(wid.value); if (isFinite(v)) { x.w = v; schedule(); } });
      share.addEventListener('input', () => {
        const v = parseFloat(share.value);
        if (share.value.trim() === '') delete x.e;
        else if (isFinite(v) && v > 0) x.e = Math.min(100, v);
        else return;
        schedule();
      });
      const del = el.querySelector('button');
      if (del) del.addEventListener('click', () => { state.surfaces.splice(k, 1); renderSurfaces(); schedule(); });
      box.appendChild(el);
      return { el, area: el.querySelector('.area'), share };
    });
  }

  let tankRows = [];

  function renderTanks() {
    const box = $('tanks');
    box.innerHTML = '';
    tankRows = state.tanklist.map((t, k) => {
      const el = document.createElement('div');
      el.className = 'surf-row';
      el.innerHTML = `<input type="checkbox" aria-label="${tr('In use', 'In gebruik')}"> ` +
        `<input type="text" maxlength="40" aria-label="${tr('Name', 'Naam')}"> ` +
        `<select aria-label="${tr('Shape', 'Vorm')}"><option value="box">${tr('Box', 'Rechthoekig')}</option><option value="round">${tr('Round', 'Rond')}</option></select> ` +
        `<span class="lbl"></span><input type="number" min="0" max="50" step="0.1" aria-label="${tr('Length or diameter in metres', 'Lengte of diameter in meters')}">` +
        `<span class="wpart"> × <input type="number" min="0" max="50" step="0.1" aria-label="${tr('Width in metres', 'Breedte in meters')}"></span> × ` +
        `<input type="number" min="0" max="20" step="0.1" aria-label="${tr('Depth in metres', 'Diepte in meters')}"> m ` +
        '<span class="area"></span>' +
        (k >= DEFAULT_TANKS.length && !t.g ? ` <button type="button" class="small-btn">${tr('Remove', 'Verwijderen')}</button>` : '');
      const [on, name, len, wid, dep] = el.querySelectorAll('input');
      const shape = el.querySelector('select');
      on.checked = !!t.on;
      name.value = showName(t.n);
      shape.value = t.shape;
      len.value = t.l;
      wid.value = t.w;
      dep.value = t.d;
      const num = (input, key) => input.addEventListener('input', () => {
        const v = parseFloat(input.value);
        if (isFinite(v)) { t[key] = v; schedule(); }
      });
      on.addEventListener('change', () => { t.on = on.checked ? 1 : 0; schedule(); });
      name.addEventListener('input', () => { t.n = name.value; schedule(); });
      shape.addEventListener('change', () => { t.shape = shape.value; schedule(); });
      num(len, 'l');
      num(wid, 'w');
      num(dep, 'd');
      const del = el.querySelector('button');
      if (del) del.addEventListener('click', () => { state.tanklist.splice(k, 1); renderTanks(); schedule(); });
      box.appendChild(el);
      return { el, area: el.querySelector('.area'), lbl: el.querySelector('.lbl'), wpart: el.querySelector('.wpart') };
    });
  }

  function setInputs() {
    document.querySelectorAll('[data-k]').forEach((el) => {
      const v = state[el.dataset.k];
      if (el.type === 'checkbox') el.checked = !!v;
      else if (el.type === 'radio') el.checked = el.value === v;
      else el.value = v;
    });
    renderSurfaces();
    renderTanks();
  }

  // Picking a supplier sets the distance and picking a tanker sets the load; typing your own
  // distance or load switches the choice to 'Other'.
  function linkPresets(k) {
    if (k === 'supplier') {
      const p = SUPPLIERS.find((x) => x.id === state.supplier);
      if (p && p.km !== null) { state.km = p.km; document.querySelector('[data-k=km]').value = p.km; }
    } else if (k === 'truck') {
      const t = TRUCKS.find((x) => x.id === state.truck);
      if (t && t.load !== null) { state.load = t.load; document.querySelector('[data-k=load]').value = t.load; }
    } else if (k === 'km') {
      const p = SUPPLIERS.find((x) => x.id === state.supplier);
      if (!p || p.km !== state.km) { state.supplier = 'custom'; $('supplier_select').value = 'custom'; }
    } else if (k === 'load') {
      const t = TRUCKS.find((x) => x.id === state.truck);
      if (!t || t.load !== state.load) { state.truck = 'custom'; $('truck_select').value = 'custom'; }
    }
  }

  function readInput(el) {
    const k = el.dataset.k;
    if (el.type === 'checkbox') state[k] = el.checked ? 1 : 0;
    else if (el.type === 'radio') { if (el.checked) state[k] = el.value; }
    else if (STRING_KEYS.has(k)) state[k] = el.value;
    else { const v = parseFloat(el.value); if (isFinite(v)) state[k] = v; }
  }

  // ---- Update loop ---------------------------------------------------------

  function update() {
    const r = simulate(state);
    const bs = baselineSettings();
    const same = comparable(bs) === comparable(state);
    const rb = same ? null : simulate(bs);
    renderOutputs(state, r);
    setHTML('headline', headline(r));
    setHTML('compare', comparison(r, rb, bs, same));
    renderExplain(state, r);
    renderCards(r);
    renderYears(r);
    renderCompare(r, rb, bs, same);
    renderFixButtons(state);
    chartData = { r, rb };
    syncViewInputs();
    drawChart();
    renderCalibration();
    writeHash();
  }

  // Coalesce rapid slider events into one update. A timer rather than requestAnimationFrame,
  // which browsers pause in background tabs and would leave the page stale.
  let pending = false;
  function schedule() {
    if (pending) return;
    pending = true;
    setTimeout(() => { pending = false; update(); }, 16);
  }

  // ---- Language switching ----------------------------------------------------

  // The page address first, then the last choice on this device, then the browser's first language.
  function initialLang() {
    const p = new URLSearchParams(location.hash.replace(/^#/, ''));
    if (p.get('lang') === 'nl' || p.get('lang') === 'en') return p.get('lang');
    try {
      const saved = localStorage.getItem('rainwater-lang');
      if (saved === 'nl' || saved === 'en') return saved;
    } catch (e) { /* storage blocked */ }
    const first = (navigator.languages && navigator.languages[0]) || navigator.language || '';
    return /^nl\b/i.test(first) ? 'nl' : 'en';
  }

  function setLang(l) {
    LANG = l === 'nl' ? 'nl' : 'en';
    MONTHS = MONTH_NAMES[LANG];
    MONTHS_SHORT = MONTH_SHORT[LANG];
    document.documentElement.lang = LANG;
    document.title = tr('Will the rainwater last the summer? — Prayssac, Lot', 'Houdt het regenwater de zomer vol? — Prayssac, Lot');
    document.querySelectorAll('[data-lang]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.lang === LANG)));
  }

  // Options in the drop-downs, which CSS can't swap.
  function localizeSelects() {
    document.querySelectorAll('select.months').forEach((sel) => {
      sel.innerHTML = MONTHS.map((m, k) => `<option value="${k + 1}">${m}</option>`).join('');
    });
    $('src_select').innerHTML = Object.keys(R.sources).map((k) => `<option value="${k}">${sourceName(k)}</option>`).join('');
    $('supplier_select').innerHTML = SUPPLIERS
      .map((x) => `<option value="${x.id}">${pick(x.name)}${x.km !== null ? ` (${fmt(x.km, 1)} km)` : ''}</option>`).join('');
    $('truck_select').innerHTML = TRUCKS
      .map((x) => `<option value="${x.id}">${pick(x.name)}${x.load !== null ? `: ${x.load} m³` : ''}</option>`).join('');
    const toilets = {
      std: tr('Standard flush (9 L)', 'Gewone spoeling (9 L)'),
      low: tr('Low flush (6 L)', 'Zuinige spoeling (6 L)'),
      dual: tr('Dual flush 6/2 L (average 3.3 L)', 'Spaarknop 6/2 L (gemiddeld 3,3 L)'),
      dry: tr('Dry / composting (no water)', 'Droog / composttoilet (geen water)'),
      grey: tr('Flushed with used shower water', 'Doorgespoeld met gebruikt douchewater'),
    };
    $('toilet_select').querySelectorAll('option').forEach((o) => { if (toilets[o.value]) o.textContent = toilets[o.value]; });
    $('view_year').dataset.first = '';
  }

  function switchLang(l) {
    setLang(l);
    try { localStorage.setItem('rainwater-lang', LANG); } catch (e) { /* storage blocked */ }
    localizeSelects();
    setInputs();
    buildCalibration();
    renderStory();
    update();
  }

  function init() {
    setLang(initialLang());
    let years = '';
    for (let y = FIRST_YEAR; y <= LAST_FULL_YEAR; y++) years += `<option value="${y}">${y}</option>`;
    $('from_select').innerHTML = years;
    localizeSelects();

    state = fromHash(location.hash);
    view = viewFromHash(location.hash);
    setInputs();
    buildCalibration();

    document.querySelectorAll('[data-k]').forEach((el) => {
      const evt = el.tagName === 'SELECT' || el.type === 'checkbox' || el.type === 'radio' ? 'change' : 'input';
      el.addEventListener(evt, () => { readInput(el); linkPresets(el.dataset.k); schedule(); });
    });
    $('add_surface').addEventListener('click', () => {
      state.surfaces.push({ n: tr('Other surface', 'Ander oppervlak'), l: 5, w: 4, on: 1 });
      renderSurfaces();
      schedule();
    });
    $('add_tank').addEventListener('click', () => {
      state.tanklist.push({ n: 'Tank ' + (state.tanklist.length + 1), shape: 'box', l: 3, w: 3, d: 3, on: 1 });
      renderTanks();
      schedule();
    });
    document.querySelectorAll('[data-preset]').forEach((b) => b.addEventListener('click', () => {
      const future = b.dataset.preset === '2050';
      state.sumAdj = future ? -15 : 0;
      state.winAdj = future ? 12 : 0;
      setInputs();
      schedule();
    }));
    $('reset').addEventListener('click', () => {
      state = freshDefaults();
      pinned = null;
      view = { from: null, to: null };
      setInputs();
      schedule();
    });
    $('pin').addEventListener('click', () => { pinned = clone(state); schedule(); });
    $('unpin').addEventListener('click', () => { pinned = null; schedule(); });
    $('share').addEventListener('click', () => {
      const url = shareUrl();
      const done = () => {
        setHTML('share_o', tr('Link copied. Paste it into a message to share these exact settings.',
          'Link gekopieerd. Plak hem in een bericht om precies deze instellingen te delen.'));
      };
      const fallback = () => {
        const box = $('share_url');
        box.style.display = '';
        box.value = url;
        box.select();
        setHTML('share_o', tr('Copy this link:', 'Kopieer deze link:'));
      };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url).then(done, fallback);
      else fallback();
    });
    $('fix_btn').addEventListener('click', () => {
      const roofs = step1Rows(state);
      const on = roofs.every((i) => state.surfaces[i].on) ? 0 : 1;
      roofs.forEach((i) => { state.surfaces[i].on = on; });
      renderSurfaces();
      update();
      $('headline').scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
    $('fix_btn2').addEventListener('click', () => {
      const kt = newTankRow(state);
      if (kt < 0) return;
      state.tanklist[kt].on = state.tanklist[kt].on ? 0 : 1;
      renderTanks();
      update();
      $('headline').scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
    $('fix_btn3').addEventListener('click', () => {
      const ks = sheetIndex(state);
      if (ks < 0) return;
      state.surfaces[ks].on = state.surfaces[ks].on ? 0 : 1;
      renderSurfaces();
      update();
      $('headline').scrollIntoView({ behavior: 'smooth', block: 'center' });
    });

    // The language switch at the top.
    document.querySelectorAll('[data-lang]').forEach((b) => b.addEventListener('click', () => {
      if (b.dataset.lang !== LANG) switchLang(b.dataset.lang);
    }));

    // The story: the example summer, and plan B's sheet size.
    document.addEventListener('click', (e) => {
      const b = e.target.closest('[data-example]');
      if (b && story) setExample(+b.dataset.example);
    });
    let pbTimer = null;
    $('pb_slider').addEventListener('input', (e) => {
      planBArea = +e.target.value;
      clearTimeout(pbTimer);
      pbTimer = setTimeout(renderPlanB, 30);
    });
    $('pb_try').addEventListener('click', () => {
      state = withSteps(state, { roofs: 1, tank: 1, sheet: planBArea });
      setInputs();
      update();
      $('try').scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    $('open_water').addEventListener('click', (e) => {
      e.preventDefault();
      $('d_water').open = true;
      $('d_water').scrollIntoView({ behavior: 'smooth', block: 'start' });
    });

    // Calibration
    $('cal_rain').addEventListener('input', (e) => {
      const t = e.target;
      if (t.dataset.cr === undefined) return;
      cal.rain[+t.dataset.cr][t.dataset.f] = t.value;
      renderCalibration();
    });
    $('cal_use').addEventListener('input', (e) => {
      const t = e.target;
      if (t.dataset.cu === undefined) return;
      cal.use[t.dataset.cu] = t.value;
      renderCalibration();
    });
    $('cal_rain_add').addEventListener('click', () => {
      cal.rain.push({ d0: '', l0: '', d1: '', l1: '' });
      buildCalibration();
      renderCalibration();
    });
    $('calib').addEventListener('click', (e) => {
      const t = e.target;
      if (t.dataset.applyEff) {
        state.eff = Math.min(100, Math.max(1, +t.dataset.applyEff));
        setInputs();
        schedule();
      } else if (t.dataset.applyLpd) {
        state.mode = 'direct';
        state.direct = +t.dataset.applyLpd;
        setInputs();
        schedule();
      }
    });

    // Chart time range
    const lastIso = isoAt(N - 1);
    const daysBefore = (n) => isoAt(Math.max(0, N - 1 - n));
    document.querySelectorAll('[data-view]').forEach((btn) => btn.addEventListener('click', () => {
      const v = btn.dataset.view;
      if (v === 'all') setView(null, null);
      else if (v === '12m') setView(daysBefore(365), lastIso);
      else if (v === '5y') setView(daysBefore(Math.round(5 * 365.25)), lastIso);
    }));
    $('view_year').addEventListener('change', (e) => {
      const y = e.target.value;
      if (y) setView(`${y}-01-01`, `${y}-12-31`);
    });
    const fromRange = () => setView($('view_from').value || null, $('view_to').value || null);
    $('view_from').addEventListener('change', fromRange);
    $('view_to').addEventListener('change', fromRange);

    // Chart hover and touch; with a mouse, drag across the chart to zoom in, double-click to zoom out.
    const wrap = $('chart_wrap');
    const sel = $('sel');
    const hideTip = () => { $('hair').style.display = 'none'; $('tip').style.display = 'none'; };
    let drag = null;
    wrap.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' && e.button === 0 && layout) {
        drag = { x0: e.clientX };
        e.preventDefault();
      } else showTip(e.clientX);
    });
    wrap.addEventListener('pointermove', (e) => {
      if (!drag) { showTip(e.clientX); return; }
      const rect = wrap.getBoundingClientRect();
      const x0 = Math.max(layout.pad.l, Math.min(drag.x0, e.clientX) - rect.left);
      const x1 = Math.min(rect.width - layout.pad.r, Math.max(drag.x0, e.clientX) - rect.left);
      if (x1 - x0 > 3) {
        sel.style.left = x0 + 'px';
        sel.style.width = (x1 - x0) + 'px';
        sel.style.display = 'block';
        hideTip();
      }
    });
    window.addEventListener('pointerup', (e) => {
      if (!drag) return;
      const { x0 } = drag;
      drag = null;
      sel.style.display = 'none';
      if (Math.abs(e.clientX - x0) < 8 || !chartData) return;
      const { r } = chartData;
      const j0 = Math.max(0, Math.min(r.L - 1, dayAt(Math.min(x0, e.clientX))));
      const j1 = Math.max(0, Math.min(r.L - 1, dayAt(Math.max(x0, e.clientX))));
      setView(isoAt(r.i0 + j0), isoAt(r.i0 + j1));
    });
    wrap.addEventListener('dblclick', () => setView(null, null));
    wrap.addEventListener('pointerleave', () => { if (!drag) hideTip(); });
    window.addEventListener('resize', () => { drawChart(); drawWhyChart(); });
    // A link pasted into an open tab: apply its settings and language, then the next update clears the
    // address again.
    window.addEventListener('hashchange', () => {
      const p = new URLSearchParams(location.hash.replace(/^#/, ''));
      const lang = p.get('lang');
      const settings = [...p.keys()].some((k) => k !== 'lang');
      if (settings) {
        state = fromHash(location.hash);
        view = viewFromHash(location.hash);
      }
      if ((lang === 'nl' || lang === 'en') && lang !== LANG) switchLang(lang);
      else if (settings) { setInputs(); schedule(); }
    });

    buildStory();
    renderStory();
    update();
  }

  init();
})();
