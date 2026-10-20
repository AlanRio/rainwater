// Rainwater simulator for an off-grid house near Prayssac (Lot, France).
// A day-by-day water balance of the tanks, driven by the measured rainfall in rainfall.js
// (window.RAINFALL, rebuilt weekly by scripts/update_rainfall.py).
(function () {
  'use strict';

  const R = window.RAINFALL;
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
    'August', 'September', 'October', 'November', 'December'];
  const MONTHS_SHORT = MONTHS.map((m) => m.slice(0, 3));
  // Dual flush is the house's 6/2 L: one full flush for every two short ones, as in the UK water efficiency
  // calculator (Approved Document G), averages (6 + 2 × 2) / 3 = 3.3 L.
  const TOILET_LITRES = { std: 9, low: 6, dual: 10 / 3, dry: 0, grey: 9 };
  const STRING_KEYS = new Set(['src', 'mode', 'toilet', 'supplier', 'truck']);

  // Hauliers near the house that run tankers (researched October 2026), with the road
  // distance from their base to Prayssac. Picking one sets the distance; 'custom' keeps yours.
  const SUPPLIERS = [
    { id: 'delrieu', name: 'Transports Delrieu, Parnac', km: 15.6,
      note: 'Runs food-grade tanker semi-trailers (bulk wine) and two 28 m³ water tankers. The nearest firm with food-grade tanks; ask whether they can send a smaller lorry.' },
    { id: 'cassan', name: 'SARL Cassan, Prayssac', km: 1.6,
      note: 'Runs fuel and liquids tankers. Only suitable if they have a separate food-grade tank.' },
    { id: 'imbert', name: 'Établissements Imbert, Fontanes', km: 42.7,
      note: 'Haulier listed for bulk tanker work; tank type not confirmed.' },
    { id: 'amichauf', name: 'Amichauf, Souillac', km: 86.7,
      note: 'Listed for water transport and distribution; no tanker details found.' },
    { id: 'veynat', name: 'Transports Veynat, Tresses (Gironde)', km: 196.5,
      note: 'Drinking-water tanker specialist, but nearly 200 km away.' },
    { id: 'custom', name: 'Other (enter the distance)', km: null, note: '' },
  ];
  // Tanker sizes: water weighs a tonne per m³, so the legal weight limit sets the load.
  const TRUCKS = [
    { id: 'rigid2', name: 'Small rigid lorry, 2 axles (19 t)', load: 12 },
    { id: 'rigid3', name: 'Rigid lorry, 3 axles (26 t)', load: 16 },
    { id: 'rigid4', name: 'Large rigid lorry, 4 axles (32 t)', load: 20 },
    { id: 'semi', name: 'Articulated tanker (44 t)', load: 28 },
    { id: 'custom', name: 'Other (enter the load)', load: null },
  ];
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

  const fmt = (x, d = 0) => Number(x).toLocaleString('en-GB', { minimumFractionDigits: d, maximumFractionDigits: d });
  const eur = (x) => '€' + fmt(x);
  const m3 = (x) => fmt(x, Math.abs(x) < 10 && x !== 0 ? 1 : 0) + ' m³';
  const longDate = (iso) => new Date(iso + 'T00:00:00Z')
    .toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
  const plural = (n, one, many) => (n === 1 ? one : many);
  const signed = (x) => (x > 0 ? '+' : '') + x;
  const oneDp = (x) => fmt(x, x > 0 && x < 10 ? 1 : 0);
  const $ = (id) => document.getElementById(id);
  const setHTML = (id, html) => { const el = $(id); if (el) el.innerHTML = html; };
  const setAll = (cls, text) => document.querySelectorAll('.' + cls).forEach((el) => { el.textContent = text; });
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
    return p && p.id !== 'custom' ? p.name.split(',')[0] : `a supplier ${fmt(s.km, 1)} km away`;
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
    return `${fmt(catchment(s))} m² collecting, ${m3(usableVolume(s))} of usable tank, ` +
      `${s.guests} ${plural(s.guests, 'guest', 'guests')} at ${fmt(d.perGuest)} litres a day, ` +
      `${s.occ === 100 ? 'house full all season' : 'house full ' + s.occ + '% of the season'}${s.tanker ? '' : ', no tanker'}`;
  }

  // ---- The answer ----------------------------------------------------------

  function headline(r) {
    const s = r.s;
    const { T } = r;
    if (r.d.season <= 0 && r.d.off <= 0) {
      return 'Nobody is using water in these settings, so the tanks simply stay full. Add guests under <i>Settings</i>.';
    }
    const w = worstYear(r);
    const lowest = `The lowest the tanks got was ${m3(r.minLevel)}${r.minYear ? ' in ' + r.minYear : ''}.`;
    if (T.dryDays === 0 && T.deliveries === 0) {
      return `<b>The rain alone would have been enough every year since ${s.from}</b>, with no tanker needed. ${lowest}`;
    }
    if (s.tanker) {
      const per = T.deliveries / r.span;
      let t = `You'd need about <b>${oneDp(per)} tanker ${plural(Math.round(per * 10) / 10, 'delivery', 'deliveries')} a summer</b>, ` +
        `costing about <b>${eur(T.cost / r.span)} a year</b> on average since ${s.from}.`;
      if (w && !w.calm && w.deliveries) {
        t += ` The worst year was ${w.year}: ${w.deliveries} ${plural(w.deliveries, 'delivery', 'deliveries')}, ${eur(w.cost)}.`;
      }
      if (T.dryDays > 0) {
        t += ` <span class="bad">Even with the tanker, the house would have been without water on ${fmt(T.dryDays)} ` +
          `${plural(T.dryDays, 'day', 'days')}. Order earlier or allow for a slower delivery under <i>Tanker in detail</i>.</span>`;
      }
      return t;
    }
    const per = T.dryDays / r.span;
    let t = `Without a tanker, the house would run out of water on about <b>${oneDp(per)} days a summer</b> on average since ${s.from}, ` +
      `in ${r.yearsDry} of ${r.summers} ${plural(r.summers, 'summer', 'summers')}.`;
    if (w && !w.calm) t += ` The worst year was ${w.year}, with ${w.dryDays} ${plural(w.dryDays, 'day', 'days')} without water.`;
    return t;
  }

  function comparison(r, rb, bs, same) {
    const who = pinned ? 'the settings you pinned' : 'the default setup';
    if (same) {
      return pinned
        ? 'These are the settings you pinned for comparison. Change something to see the difference it makes.'
        : 'These are the default settings for the house as it is now. Try the buttons below: step 1, step 2 and plan B.';
    }
    const intro = `Compared with ${who} (${describe(bs)}): `;
    if (r.s.tanker && bs.tanker) {
      const dDel = (rb.T.deliveries - r.T.deliveries) / r.span;
      const dCost = (rb.T.cost - r.T.cost) / r.span;
      if (Math.abs(dCost) < 1 && Math.abs(dDel) < 0.05) return intro + 'no real difference in tanker use.';
      if (dCost > 0) {
        let t = intro + `<b>${oneDp(dDel)} fewer ${plural(Math.round(dDel * 10) / 10, 'delivery', 'deliveries')} a summer, saving ${eur(dCost)} a year.</b>`;
        if (r.s.upCost > 0) t += ` Changes costing ${eur(r.s.upCost)} would pay for themselves in about ${fmt(r.s.upCost / dCost, 1)} years.`;
        return t;
      }
      return intro + `<b>${oneDp(-dDel)} more ${plural(Math.round(-dDel * 10) / 10, 'delivery', 'deliveries')} a summer, costing ${eur(-dCost)} a year more.</b>`;
    }
    const dDry = (rb.T.dryDays - r.T.dryDays) / r.span;
    if (Math.abs(dDry) < 0.05) return intro + 'no real difference in days without water.';
    return intro + (dDry > 0
      ? `<b>${oneDp(dDry)} fewer days without water a summer.</b>`
      : `<b>${oneDp(-dDry)} more days without water a summer.</b>`);
  }

  // ---- Rendering -----------------------------------------------------------

  function renderOutputs(s, r) {
    const d = r.d;
    setHTML('o_guests', String(s.guests));
    setHTML('o_occ', s.occ + '%');
    setHTML('o_lpd', fmt(d.perGuest));
    setHTML('o_day', fmt(d.fullHouse));
    setHTML('o_area', fmt(r.area) + ' m²');
    setHTML('o_tankvol', m3(tankVolume(s)));
    setHTML('o_usable', m3(r.cap));
    setHTML('o_tanker', s.tanker
      ? `Each delivery brings ${fmt(s.load)} m³ from ${supplierName(s)} and costs about <b>${eur(deliveryCost(s))}</b> ` +
        `(€${fmt(deliveryCost(s) / s.load, 1)} per m³). ` +
        `It's ordered when the tanks fall to ${s.trig}% and arrives ${s.lead} ${plural(s.lead, 'day', 'days')} later.`
      : 'With no tanker, the results show how often the house would run dry.');
    const sup = SUPPLIERS.find((x) => x.id === s.supplier);
    setHTML('o_supplier', sup && sup.note ? sup.note : '');
    const perM3 = (x) => '€' + fmt(x, 1);
    setHTML('o_cost_breakdown', `Each delivery: ${eur(s.fixed)} fixed + ${eur(s.perKm * 2 * s.km)} for ` +
      `${fmt(2 * s.km, 1)} km there and back + ${eur(s.load * s.price)} for ${fmt(s.load)} m³ of water ` +
      `= <b>${eur(deliveryCost(s))}</b>, or ${perM3(deliveryCost(s) / s.load)} per m³.`);
    setHTML('o_off', String(s.offPeople));
    setHTML('o_eff', s.eff + '%');
    setHTML('o_loss', s.loss > 0 ? fmt(s.loss, 1) + ' mm' : 'none');
    setHTML('o_cap', s.cap > 0 ? s.cap + ' mm a day' : 'no limit');
    setHTML('o_usable_pct', s.usable + '%');
    setHTML('o_fill', s.fill + '%');
    setHTML('o_trig', `${s.trig}% (${m3(r.trigger)})`);
    setHTML('o_lead', `${s.lead} ${plural(s.lead, 'day', 'days')}`);
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
      setHTML('b_pp', `${fmt(d.perGuest)} litres per guest per day`);
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
    const climate = s.sumAdj || s.winAdj ? ' (before the climate adjustment)' : '';

    setAll('ex_from', String(s.from));
    setAll('ex_range', `${longDate(R.start)} to ${longDate(R.end)}`);
    setHTML('updated_o', longDate(R.updated));
    setHTML('ex_rain', `<b>${fmt(rainAvg)} mm</b>${climate}`);
    const share = avgShare(s);
    const mixed = s.surfaces.some((x) => x.on && ownShare(x) && x.e !== s.eff);
    setHTML('ex_area', `<b>${fmt(r.area)} m²</b>`);
    setHTML('ex_eff', `<b>${mixed ? 'on average ' : ''}${fmt(share)}%</b>`);
    setHTML('ex_usable', `<b>${m3(r.cap)}</b>`);
    const season = `${MONTHS[s.s0 - 1]} to ${MONTHS[s.s1 - 1]}`;
    setHTML('ex_use', `From ${season} the house uses <b>${fmt(r.d.season)} litres a day</b> on average ` +
      `(${s.guests} ${plural(s.guests, 'guest', 'guests')} at about ${fmt(r.d.perGuest)} litres each` +
      `${s.occ < 100 ? `, the house full ${s.occ}% of the season` : ''})` +
      `${s.offPeople > 0 ? `, and ${fmt(r.d.off)} litres a day the rest of the year` : ''}.`);
    setHTML('ex_tanker', s.tanker
      ? `When the tanks fall to ${s.trig}%, a tanker is ordered and brings ${fmt(s.load)} m³ ${s.lead} ${plural(s.lead, 'day', 'days')} later.`
      : `There's no tanker in these settings, so when the tanks are empty the house has no water until it rains.`);

    setHTML('fl_rain', `${fmt(rainAvg)} mm a year`);
    setHTML('fl_area', `${fmt(r.area)} m² collecting, ${mixed ? 'about ' : ''}${fmt(share)}% reaches the tanks`);
    setHTML('fl_collect', `${fmt(r.T.collected / r.span)} m³ a year`);
    setHTML('fl_tank', `${m3(r.cap)} usable`);
    setHTML('fl_season', `${season}, ${s.guests} ${plural(s.guests, 'guest', 'guests')}${s.occ < 100 ? `, ${s.occ}% full` : ''}`);
    setHTML('fl_use', `${fmt(r.d.season)} litres a day`);
    setHTML('fl_tanker', s.tanker
      ? `Backup: a tanker brings ${fmt(s.load)} m³ when the tanks fall to ${s.trig}% (${m3(r.trigger)}).`
      : 'No tanker backup in these settings.');

    // Cross-check against the other rainfall source with the same settings.
    const otherKey = Object.keys(R.sources).find((k) => k !== s.src);
    const gaugeKey = 'anglars';
    const eraKey = 'era5';
    setHTML('chk_gauge', `${fmt(avg(gaugeKey))} mm`);
    setHTML('chk_era', `${fmt(avg(eraKey))} mm`);
    setHTML('chk_years', fullYears.length > 1 ? `${s.from} to ${LAST_FULL_YEAR}` : String(s.from));
    if (otherKey) {
      const alt = simulate(Object.assign({}, s, { src: otherKey }));
      const name = (k) => R.sources[k].short;
      const [what, a, b] = s.tanker
        ? ['tanker deliveries a summer', alt.T.deliveries / alt.span, r.T.deliveries / r.span]
        : ['days without water a summer', alt.T.dryDays / alt.span, r.T.dryDays / r.span];
      setHTML('chk_alt', a === 0 && b === 0
        ? `no ${what.replace(' a summer', '')} with either source`
        : `about <b>${oneDp(a)} ${what}</b> with the ${name(otherKey)}, against <b>${oneDp(b)}</b> with the ${name(s.src)}`);
    }
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
      card('c_del', `${oneDp(T.deliveries / r.span)} a summer`, `${fmt(T.deliveries)} in total since ${s.from}`, T.deliveries ? '' : 'good');
      card('c_cost', `${eur(T.cost / r.span)} a year`, `${eur(T.cost)} in total`, T.cost ? 'bad' : 'good');
    } else {
      card('c_del', 'Off', 'Tanker switched off', '');
      card('c_cost', '–', 'Tanker switched off', '');
    }
    if (w && !w.calm) {
      const parts = [];
      if (s.tanker && w.deliveries) parts.push(`${w.deliveries} ${plural(w.deliveries, 'delivery', 'deliveries')}, ${eur(w.cost)}`);
      if (w.dryDays) parts.push(`${w.dryDays} ${plural(w.dryDays, 'day', 'days')} without water`);
      card('c_worst', String(w.year), parts.join('; '), '');
    } else if (w) {
      card('c_worst', 'None', `Closest call: ${w.year}, down to ${m3(w.min)}`, 'good');
    } else {
      card('c_worst', '–', '', '');
    }
    card('c_dry', fmt(T.dryDays), T.dryDays ? `in ${r.yearsDry} of ${r.summers} ${plural(r.summers, 'summer', 'summers')}` : 'Never ran dry', T.dryDays ? 'bad' : 'good');
    const pct = r.cap > 0 ? Math.round(r.minLevel / r.cap * 100) : 0;
    card('c_min', m3(r.minLevel), `${pct}% full${r.minYear ? ', in ' + r.minYear : ''}`, pct <= 5 ? 'warn' : '');
    card('c_bal', `${fmt(T.collected / r.span)} / ${fmt(T.used / r.span)} m³`,
      `collected / used a year; ${fmt(T.overflow / r.span)} m³ a year overflowed`, '');
  }

  function renderYears(r) {
    const s = r.s;
    const w = worstYear(r);
    let h = '<thead><tr><th>Year</th><th class="num">Rain in season</th><th class="num">Collected</th>' +
      '<th class="num">Overflowed</th><th class="num">Used</th>' +
      (s.tanker ? '<th class="num">Deliveries</th><th class="num">Tanker cost</th>' : '') +
      '<th class="num">Lowest level</th><th class="num">Days without water</th></tr></thead><tbody>';
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
    if (r.years.length && r.years[r.years.length - 1].days < 365) notes.push(`* ${LAST_YEAR} runs to ${longDate(R.end)}.`);
    if (w && !w.calm) notes.push(`The highlighted row is the worst year.`);
    notes.push('Rain in season is the rain that fell during the guest season.');
    setHTML('years_note', notes.join(' '));
  }

  function renderCompare(r, rb, bs, same) {
    setHTML('base_o', (pinned ? 'the settings you pinned' : 'the default setup') + ` (${describe(bs)})` + (same ? ', which matches the current settings.' : '.'));
    $('lg_base').style.display = rb ? '' : 'none';
    $('lg_tanker').style.display = r.s.tanker ? '' : 'none';
    let pay;
    if (same) pay = 'Change a setting first, then enter what that change would cost.';
    else if (!(r.s.upCost > 0)) pay = 'Enter what the changes would cost to see how long they take to pay back.';
    else if (r.s.tanker && bs.tanker) {
      const save = (rb.T.cost - r.T.cost) / r.span;
      pay = save > 0
        ? `<b>Pays for itself in about ${fmt(r.s.upCost / save, 1)} years</b> (${eur(save)} of tanker costs saved a year).`
        : 'These changes don\'t reduce tanker costs, so they wouldn\'t pay back.';
    } else pay = 'Payback needs the tanker switched on in both setups, so there\'s a cost to compare.';
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
    $('fix_btn').textContent = roofs.length && roofs.every((i) => s.surfaces[i].on) ? 'Undo step 1' : 'Step 1: gutter the three roofs';
    $('fix_btn2').textContent = kt >= 0 && s.tanklist[kt].on ? 'Undo step 2' : 'Step 2: add the new tank';
    $('fix_btn3').textContent = ks >= 0 && s.surfaces[ks].on ? 'Take the rain sheet off' : 'Plan B: add the rain sheet';
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
    return day <= 10 ? 'early ' + m : day <= 20 ? 'mid-' + m : 'late ' + m;
  }
  const weeksText = (days) => (days < 7 ? `${fmt(days)} ${plural(days, 'day', 'days')}` : `${fmt(Math.round(days / 7))} ${plural(Math.round(days / 7), 'week', 'weeks')}`);
  const halves = (x) => {
    const h = Math.round(x * 2) / 2;
    const whole = Math.floor(h);
    return (whole || h % 1 === 0 ? fmt(whole) : '') + (h % 1 ? '½' : '');
  };
  function sizeWords(x) {
    if (x > 1.2) return `about ${fmt(x, 1)} times the size of`;
    const opts = [[0.25, 'a quarter'], [1 / 3, 'a third'], [0.5, 'half'], [2 / 3, 'two-thirds'], [0.75, 'three-quarters'], [1, 'the same size as']];
    const [v, w] = opts.reduce((a, b) => (Math.abs(b[0] - x) < Math.abs(a[0] - x) ? b : a));
    return v === 1 ? 'about ' + w : `about ${w} the size of`;
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
    { key: 'now', name: 'Today', short: 'Today' },
    { key: 's1', name: 'With step 1', short: 'Step 1', roofs: 1 },
    { key: 's12', name: 'With steps 1 and 2', short: 'Steps 1 + 2', roofs: 1, tank: 1 },
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
    const since = `since ${base.from}`;
    const season = `${MONTHS[base.s0 - 1]} to ${MONTHS[base.s1 - 1]}`;

    let h1;
    if (now.ranDry === now.n) h1 = 'The rainwater runs out every summer.';
    else if (now.ranDry > now.n / 2) h1 = 'The rainwater runs out most summers.';
    else if (now.ranDry > 0) h1 = `The rainwater runs out in ${now.ranDry} of ${now.n} summers.`;
    else h1 = 'The rainwater lasts the summer.';
    setHTML('st_h1', h1);

    let t = `With a full house (${base.guests} guests, ${season}), `;
    if (now.ranDry) {
      t += `the tanks run dry around <b>${roughDate(now.runOut)}</b> and the house is ` +
        `<b>without water for about ${weeksText(Math.round(now.medianDry))}</b>, unless water is trucked in. `;
      t += now.ranDry === now.n
        ? `That's <b>every summer ${since}</b>`
        : `That's <b>${now.ranDry} of the ${now.n} summers ${since}</b>`;
      const wet = now.byYear[story.wettest];
      t += wet && wet.dryDays >= 7
        ? `; even the wettest (${story.wettest}) left ${weeksText(wet.dryDays)} without water.`
        : '.';
    } else t += `the tanks would have lasted every summer ${since}.`;
    setHTML('st_today', t);

    // Step 1 on its own.
    const lastS1 = s1.byYear[story.last];
    setHTML('st_s1', !s1.ranDry
      ? 'On its own, that would already be enough.'
      : lastS1 && lastS1.dryDays
        ? `Not enough on its own: last summer would still have run dry on ${dayMonth(lastS1.firstDry)}.`
        : `Not enough on its own: ${s1.ranDry} of ${s1.n} summers would still run dry.`);

    // Step 2: the new tank, against the biggest tank there now.
    const kt = newTankRow(base);
    const tanks = base.tanklist.filter((x, k) => k !== kt && !x.g && x.on);
    const big = tanks.reduce((a, b) => (tankFootprint(b) * b.d > tankFootprint(a) * a.d ? b : a), tanks[0]);
    const newVol = kt >= 0 ? tankFootprint(base.tanklist[kt]) * base.tanklist[kt].d : 0;
    setHTML('st_s2', big && newVol
      ? `2. Add a buried tank ${sizeWords(newVol / (tankFootprint(big) * big.d))} the ${big.n.toLowerCase()}.`
      : '2. Add a buried tank.');

    // Both together.
    const dryNow = now.byYear[story.driest];
    const dry12 = s12.byYear[story.driest];
    let both = `<b>Together:</b> ` + (s12.ranDry
      ? `the water lasts the whole season in <b>${s12.n - s12.ranDry} of the ${s12.n} summers ${since}</b>.`
      : `the water lasts the whole season <b>every summer ${since}</b>.`);
    if (dry12 && dry12.dryDays && dryNow && dryNow.dryDays) {
      both += ` In the driest summer on record (${story.driest}) it runs out on ${dayMonth(dry12.firstDry)} instead of ${dayMonth(dryNow.firstDry)}.`;
    } else if (dry12 && !dry12.dryDays) both += ` Even the driest summer on record (${story.driest}) gets through.`;
    setHTML('st_both', both);

    // Why it runs out.
    const perDay = d.season / 1000;
    const seasonLen = now.ys.length ? median(now.ys.map((y) => y.seasonDays)) : 184;
    const capNow = usableVolume(base);
    const cap12 = usableVolume(withSteps(base, { roofs: 1, tank: 1 }));
    setHTML('why_use', `about ${fmt(Math.round(d.season / 10) * 10)} litres a day`);
    setHTML('why_parts', d.u.parts
      ? `${fmt(d.perGuest)} litres a guest including the dual-flush toilets, laundry and dishwasher`
      : `${fmt(d.perGuest)} litres a guest`);
    setAll('why_tankw', halves(capNow / perDay / 7));
    setAll('why_tankw12', halves(cap12 / perDay / 7));
    setAll('why_seasonw', fmt(Math.round(seasonLen / 7)));
    setAll('why_season', season);
    setAll('why_from', String(base.from));
    setHTML('why_need', fmt(Math.round(seasonLen / 7 - capNow / perDay / 7)));

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
    const nY = Math.max(1, story.years.length);
    setHTML('why_rain', `${fmt(tot / nY)} mm`);
    setHTML('why_heavy', `${fmt(heavy / Math.max(1, tot) * 100)}%`);
    setHTML('why_gap', weeksText(Math.round(median(spells))));
    setHTML('why_gapmax', weeksText(Math.max(...spells)));
    const storm = (s) => 20 * wetArea(s) / 1000 / perDay;
    setHTML('why_storm_now', `${halves(storm(base))} days`);
    setHTML('why_storm_s1', `${halves(storm(withSteps(base, { roofs: 1 })))} days`);
    const ofN = (st) => `${st.ranDry} of ${st.n}`;
    setHTML('why_s1only', ofN(s1));
    setHTML('why_s2only', ofN(runs.s2only.st));
    setHTML('why_both', ofN(s12));
  }

  // ---- The example summer: calendar strips and the tank level ---------------

  function exampleButtons() {
    const seen = new Set();
    const opts = [];
    const add = (y, label) => { if (y && !seen.has(y)) { seen.add(y); opts.push({ y, label }); } };
    add(story.last, `Last summer (${story.last})`);
    add(story.driest, `Driest summer (${story.driest})`);
    add(story.wettest, `Wettest summer (${story.wettest})`);
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
        ? `Runs dry on ${dayMonth(Y.firstDry)}: <b class="bad">${weeksText(Y.dryDays)} without water</b>`
        : '<b class="good">Water all season</b>';
      html += `<div class="strip-row"><div class="strip-name">${o.name}</div><div class="strip">${segs}</div><div class="strip-out">${out}</div></div>`;
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
    $('strips').setAttribute('aria-label', `Each day of the ${y} season, with and without water, for the house today, with step 1, and with steps 1 and 2.`);
    setHTML('strip_note', (y === story.last
      ? `Last summer the house wasn't full; this shows what ${story.base.guests} guests all season would have faced. `
      : '') + 'Blue: water in the tanks. Red: tanks empty. Nothing trucked in.');
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
      ends.push({ y: Yw(r.vol[days[days.length - 1]] / perDay / 7), col, name: o.short });
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
    $('why_chart').setAttribute('aria-label', `Weeks of water left in the tanks through the ${y} season, for the house today, with step 1, and with steps 1 and 2, with the daily rain.`);
    setHTML('why_chart_title', `Water left in the tanks through the ${y} season, in weeks for a full house`);
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
      return Y && Y.dryDays ? `${weeksText(Y.dryDays)} without water in ${driest}` : `water all through ${driest}`;
    };
    const runs = (x) => (x.ranDry ? `runs dry in <b>${x.ranDry} of ${x.n} summers</b>` : `<b>never runs dry</b>`);
    setHTML('pb_both', a > 0
      ? `<b>On top of steps 1 and 2:</b> ${runs(both)} (${both0.ranDry} without the sheet); ${dryLine(both)}.`
      : `<b>Steps 1 and 2 without a sheet:</b> ${runs(both0)}; ${dryLine(both0)}.`);
    setHTML('pb_instead', a > 0
      ? `<b>Instead of the new tank (step 1 and the sheet):</b> ${runs(instead)}; ` +
        `${instead.medianDry ? `a typical summer has ${weeksText(Math.round(instead.medianDry))} without water` : 'a typical summer has water all season'}; ${dryLine(instead)}.`
      : '');
    const tb = wt({ roofs: 1, tank: 1, sheet: a });
    const ti = wt({ roofs: 1, sheet: a });
    setHTML('pb_tankers', `If tankers are called: worst summer ${tb.worstDel} ${plural(tb.worstDel, 'delivery', 'deliveries')} with steps 1 and 2${a > 0 ? ' and the sheet' : ''}` +
      (a > 0 ? `, ${ti.worstDel} with step 1 and the sheet` : '') + '.');
    setHTML('pb_site', a > 155
      ? '<span class="warn">Beyond about 155 m², check the map and the ground again: the slope surveyed so far takes a sheet of about 20 × 7.75 m.</span>'
      : 'Fits the open slope south of the buildings: the survey shows room for at least 20 × 7.75 m (155 m²).');
  }

  // ---- The numbers behind it: the options and how much roof and tank it takes -

  function renderOptions() {
    const rows = [
      { name: 'As now', o: {}, cost: 'None' },
      { name: 'Step 1: gutter the yoga building, car port and house terrace', o: { roofs: 1 }, cost: 'Rough guess €1,500–5,000' },
      { name: 'Steps 1 and 2: plus the new buried tank', o: { roofs: 1, tank: 1 }, cost: 'Step 1 plus the tank: to be quoted', best: 1 },
      { name: `Steps 1 and 2 plus a ${fmt(SHEET_DEFAULT)} m² rain sheet (plan B on top)`, o: { roofs: 1, tank: 1, sheet: SHEET_DEFAULT }, cost: 'Plus about €2,500–4,500 for the sheet (rough)' },
      { name: `Step 1 and a ${fmt(SHEET_DEFAULT)} m² rain sheet, no new tank`, o: { roofs: 1, sheet: SHEET_DEFAULT }, cost: 'Step 1 plus about €2,500–4,500 (rough)' },
    ];
    const limit = 3;
    let h = '<thead><tr><th>Option</th><th class="num">Typical summer without water</th>' +
      `<th class="num">Driest summer (${story.driest})</th><th class="num">Summers that run dry</th>` +
      '<th class="num">Tankers a summer: average / worst</th><th>Cost</th></tr></thead><tbody>';
    for (const row of rows) {
      const a = summaryOf(simulate(withSteps(story.off, row.o)));
      const b = summaryOf(simulate(withSteps(story.base, row.o)));
      const dry = a.byYear[story.driest];
      h += `<tr${row.best ? ' class="best"' : ''}><td>${row.best ? '<b>' + row.name + '</b>' : row.name}</td>` +
        `<td class="num">${a.medianDry ? weeksText(Math.round(a.medianDry)) : 'none'}</td>` +
        `<td class="num">${dry && dry.dryDays ? weeksText(dry.dryDays) : 'none'}</td>` +
        `<td class="num">${a.ranDry} of ${a.n}</td>` +
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
    tag(catchment(base), volNow, 'today');
    tag(catchment(s1), volNow, 'step 1');
    tag(catchment(s1), vol12, 'steps 1 + 2');
    const rows = uniq([catchment(base), catchment(s1), catchment(s1) + extra, 230, 400]);
    const cols = uniq([volNow, vol12, 70, 100, 120]);
    let h = '<thead><tr><th>Roof m² \\ tanks m³</th>' + cols.map((v) => `<th class="num">${fmt(v)}</th>`).join('') + '</tr></thead><tbody>';
    for (const A of rows) {
      h += `<tr><th>${fmt(A)}</th>`;
      for (const V of cols) {
        const s = clone(base);
        s.surfaces = [{ n: 'Roofs', l: A, w: 1, on: 1 }];
        s.tanklist = [{ n: 'Tanks', shape: 'box', l: V, w: 1, d: 1, on: 1 }];
        const x = summaryOf(simulate(s));
        const t = tags[key(A) + '|' + key(V)];
        h += `<td class="num cell ${x.worstDel > 3 ? 'over' : x.worstDel ? 'near' : 'zero'}${t ? ' here' : ''}">` +
          `<b>${x.worstDel}</b><span class="tag">${x.withDel ? `in ${x.withDel} of ${x.n}` : 'never'}</span>${t ? `<span class="tag here-tag">${t}</span>` : ''}</td>`;
      }
      h += '</tr>';
    }
    setHTML('sizing', h + '</tbody>');
  }

  function renderStory() {
    buildStory();
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
      let options = '<option value="">choose…</option>';
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
    tip.innerHTML = `<b>${longDate(isoAt(i))}</b><br>In the tanks: ${m3(r.vol[j])}` +
      (rb ? `<br>Comparison setup: ${m3(rb.vol[j])}` : '') +
      `<br>Rain that day: ${fmt(rain, 1)} mm` +
      (r.deliveryDays.includes(j) ? '<br>Tanker delivery' : '');
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
    let h = '<thead><tr><th>Before: date</th><th>Depth (cm)</th><th>After: date</th><th>Depth (cm)</th><th>Result</th></tr></thead><tbody>';
    cal.rain.forEach((row, k) => {
      h += `<tr><td>${dateIn(`data-cr="${k}" data-f="d0"`)}</td><td>${numIn(`data-cr="${k}" data-f="l0"`)}</td>` +
        `<td>${dateIn(`data-cr="${k}" data-f="d1"`)}</td><td>${numIn(`data-cr="${k}" data-f="l1"`)}</td>` +
        `<td class="small" id="cr_out_${k}"></td></tr>`;
    });
    $('cal_rain').innerHTML = h + '</tbody>';
    document.querySelectorAll('[data-cr]').forEach((el) => { el.value = cal.rain[+el.dataset.cr][el.dataset.f]; });

    $('cal_use').innerHTML = '<thead><tr><th>Start: date</th><th>Depth (cm)</th><th>End: date</th><th>Depth (cm)</th><th>Guests</th></tr></thead><tbody><tr>' +
      `<td>${dateIn('data-cu="d0"')}</td><td>${numIn('data-cu="l0"')}</td><td>${dateIn('data-cu="d1"')}</td><td>${numIn('data-cu="l1"')}</td>` +
      '<td><input type="number" min="1" max="30" step="1" data-cu="g"></td></tr></tbody>';
    document.querySelectorAll('[data-cu]').forEach((el) => { el.value = cal.use[el.dataset.cu]; });
  }

  function calcRain(row) {
    if (!row.d0 || !row.d1 || row.l0 === '' || row.l1 === '') return { text: '' };
    const i0 = indexOf(row.d0);
    const i1 = indexOf(row.d1);
    if (!(i1 > i0)) return { text: 'The second reading needs to be after the first.' };
    if (i0 < 0 || i1 > N) return { text: `Rain data covers ${longDate(R.start)} to ${longDate(R.end)}.` };
    const rain = rainBetween(i0, i1, state);
    // The proposed ground sheet isn't built, so it's left out. Other surfaces with their own share are
    // taken off first; what's left measures the surfaces that use the general setting.
    const general = state.surfaces.reduce((a, x) => a + (x.on && !x.g && !ownShare(x) ? x.l * x.w : 0), 0);
    const fixedWet = state.surfaces.reduce((a, x) => a + (x.on && !x.g && ownShare(x) ? x.l * x.w * x.e / 100 : 0), 0);
    const gained = (parseFloat(row.l1) - parseFloat(row.l0)) / 100 * planArea(state);
    if (rain.raw < 3) return { text: `Only ${fmt(rain.raw, 1)} mm fell between those readings. Pick a wetter spell.` };
    if (!(rain.usable > 0)) return { text: 'Tick at least one collecting surface first.' };
    if (!(general > 0)) return { text: 'This measures the surfaces that use the general setting. Tick at least one roof.' };
    const eff = (gained - rain.usable * fixedWet / 1000) / (rain.usable * general / 1000) * 100;
    return {
      eff,
      text: `${fmt(rain.raw, 1)} mm of rain, tanks gained ${m3(gained)}: <b>${fmt(eff)}%</b> reached the tanks` +
        (fixedWet > 0 ? ' from the roofs, after allowing for the surfaces with their own share.' : '.'),
    };
  }

  function calcUse(u) {
    const g = parseFloat(u.g);
    if (!u.d0 || !u.d1 || u.l0 === '' || u.l1 === '' || !(g > 0)) return { text: '' };
    const i0 = indexOf(u.d0);
    const i1 = indexOf(u.d1);
    if (!(i1 > i0)) return { text: 'The end date needs to be after the start date.' };
    const days = i1 - i0;
    const rain = rainBetween(i0, i1, state);
    const built = Object.assign({}, state, { surfaces: state.surfaces.filter((x) => !x.g) });
    const fromRain = rain.usable * wetArea(built) / 1000;
    const drop = (parseFloat(u.l0) - parseFloat(u.l1)) / 100 * planArea(state);
    const lpd = (drop + fromRain) * 1000 / (g * days);
    let text = `Over ${days} ${plural(days, 'day', 'days')} the tanks went down by ${m3(drop)}` +
      (fromRain > 0.05 ? ` while rain added about ${m3(fromRain)}` : '') +
      `: <b>${fmt(lpd)} litres per guest per day</b>, laundry and dishwasher included.`;
    if (i1 > N) text += ` Rain data only runs to ${longDate(R.end)}, so any rain after that isn't counted.`;
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
      setHTML('cal_rain_out', `Average of ${effs.length} ${plural(effs.length, 'spell', 'spells')}: <b>${fmt(avg)}%</b> of the rain reaches the tanks ` +
        `(the page is using ${state.eff}%). <button type="button" data-apply-eff="${Math.round(avg)}">Use ${fmt(avg)}%</button>`);
    } else setHTML('cal_rain_out', '');
    const u = calcUse(cal.use);
    setHTML('cal_use_out', u.text + (isFinite(u.lpd) && u.lpd > 0
      ? ` <button type="button" data-apply-lpd="${Math.round(u.lpd)}">Use ${fmt(u.lpd)} litres per guest per day</button>` : ''));
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
    s.s0 = Math.min(12, Math.max(1, Math.round(s.s0)));
    s.s1 = Math.min(12, Math.max(1, Math.round(s.s1)));
    if (s.mode !== 'direct') s.mode = 'build';
    s.from = Math.min(LAST_FULL_YEAR, Math.max(FIRST_YEAR, Math.round(s.from)));
    return s;
  }

  function writeHash() {
    const h = toHash(state);
    try { history.replaceState(null, '', h ? '#' + h : location.pathname + location.search); } catch (e) { /* file:// in some browsers */ }
  }

  // ---- Inputs --------------------------------------------------------------

  let surfRows = [];

  function renderSurfaces() {
    const box = $('surfaces');
    box.innerHTML = '';
    surfRows = state.surfaces.map((x, k) => {
      const el = document.createElement('div');
      el.className = 'surf-row';
      el.innerHTML = '<input type="checkbox" aria-label="Connected to the tanks"> ' +
        '<input type="text" maxlength="40" aria-label="Name"> ' +
        '<input type="number" min="0" max="200" step="0.1" aria-label="Length in metres"> × ' +
        '<input type="number" min="0" max="200" step="0.1" aria-label="Width in metres"> m ' +
        '<span class="area"></span>' +
        '<span class="share"><input type="number" min="1" max="100" step="1" aria-label="Share of rain reaching the tanks, %; blank uses the general setting"> % reaches tanks</span>' +
        (k >= DEFAULT_SURFACES.length && !x.g ? ' <button type="button" class="small-btn">Remove</button>' : '');
      const [on, name, len, wid, share] = el.querySelectorAll('input');
      on.checked = !!x.on;
      name.value = x.n;
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
      el.innerHTML = '<input type="checkbox" aria-label="In use"> ' +
        '<input type="text" maxlength="40" aria-label="Name"> ' +
        '<select aria-label="Shape"><option value="box">Box</option><option value="round">Round</option></select> ' +
        '<span class="lbl"></span><input type="number" min="0" max="50" step="0.1" aria-label="Length or diameter in metres">' +
        '<span class="wpart"> × <input type="number" min="0" max="50" step="0.1" aria-label="Width in metres"></span> × ' +
        '<input type="number" min="0" max="20" step="0.1" aria-label="Depth in metres"> m ' +
        '<span class="area"></span>' +
        (k >= DEFAULT_TANKS.length && !t.g ? ' <button type="button" class="small-btn">Remove</button>' : '');
      const [on, name, len, wid, dep] = el.querySelectorAll('input');
      const shape = el.querySelector('select');
      on.checked = !!t.on;
      name.value = t.n;
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

  function init() {
    document.querySelectorAll('select.months').forEach((sel) => {
      sel.innerHTML = MONTHS.map((m, k) => `<option value="${k + 1}">${m}</option>`).join('');
    });
    $('src_select').innerHTML = Object.keys(R.sources)
      .map((k) => `<option value="${k}">${R.sources[k].name}</option>`).join('');
    let years = '';
    for (let y = FIRST_YEAR; y <= LAST_FULL_YEAR; y++) years += `<option value="${y}">${y}</option>`;
    $('from_select').innerHTML = years;
    $('supplier_select').innerHTML = SUPPLIERS
      .map((x) => `<option value="${x.id}">${x.name}${x.km !== null ? ` (${fmt(x.km, 1)} km)` : ''}</option>`).join('');
    $('truck_select').innerHTML = TRUCKS
      .map((x) => `<option value="${x.id}">${x.name}${x.load !== null ? `: ${x.load} m³` : ''}</option>`).join('');

    state = fromHash(location.hash);
    view = viewFromHash(location.hash);
    setInputs();
    buildCalibration();

    document.querySelectorAll('[data-k]').forEach((el) => {
      const evt = el.tagName === 'SELECT' || el.type === 'checkbox' || el.type === 'radio' ? 'change' : 'input';
      el.addEventListener(evt, () => { readInput(el); linkPresets(el.dataset.k); schedule(); });
    });
    $('add_surface').addEventListener('click', () => {
      state.surfaces.push({ n: 'Other surface', l: 5, w: 4, on: 1 });
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
      writeHash();
      const url = location.href;
      const done = () => { setHTML('share_o', 'Link copied. Paste it into a message to share these exact settings.'); };
      const fallback = () => {
        const box = $('share_url');
        box.style.display = '';
        box.value = url;
        box.select();
        setHTML('share_o', 'Copy this link:');
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
    window.addEventListener('hashchange', () => {
      if (location.hash.replace(/^#/, '') === toHash(state)) return;
      state = fromHash(location.hash);
      view = viewFromHash(location.hash);
      setInputs();
      schedule();
    });

    renderStory();
    update();
  }

  init();
})();
