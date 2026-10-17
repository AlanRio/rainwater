// Rainwater simulator for an off-grid house near Prayssac (Lot, France).
// A day-by-day water balance of the tanks, driven by the measured rainfall in rainfall.js
// (window.RAINFALL, rebuilt weekly by scripts/update_rainfall.py).
(function () {
  'use strict';

  const R = window.RAINFALL;
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
    'August', 'September', 'October', 'November', 'December'];
  const TOILET_LITRES = { std: 9, low: 6, dual: 4.5, dry: 0, grey: 9 };
  const STRING_KEYS = new Set(['src', 'mode', 'toilet']);
  // The comparison setup always sees the same weather as the current settings.
  const WEATHER_KEYS = ['src', 'from', 'sumAdj', 'winAdj'];

  const DEFAULT_SURFACES = [
    { n: 'Roof 1', l: 15, w: 5, on: 1 },
    { n: 'Roof 2', l: 15, w: 5, on: 1 },
    { n: 'Yoga building', l: 5, w: 7, on: 0 },
    { n: 'Terrace', l: 10, w: 4, on: 0 },
    { n: 'Small terrace', l: 5, w: 3, on: 0 },
  ];
  // Box tanks use length × width × depth; round tanks use l as the diameter and ignore w.
  const DEFAULT_TANKS = [
    { n: 'Tank 1', shape: 'box', l: 4, w: 4, d: 4, on: 1 },
    { n: 'Tank 2', shape: 'box', l: 4, w: 4, d: 4, on: 1 },
  ];
  const DEFAULTS = {
    // guests and season
    guests: 8, occ: 100, s0: 5, s1: 10, offPeople: 0,
    // water use: built up from parts, or one figure per guest
    mode: 'build', direct: 120,
    shN: 1, shL: 50, toilet: 'std', flush: 5, taps: 15, wmLoads: 8, wmL: 55, dwRuns: 1.5, dwL: 12, otherL: 0,
    // collection
    eff: 75, loss: 0, cap: 0,
    // tanks (their sizes are in the tank list)
    usable: 90, fill: 100,
    // tanker
    tanker: 1, trig: 5, lead: 2, load: 12, price: 2.8, callout: 270,
    // weather
    src: 'anglars', from: 2010, sumAdj: 0, winAdj: 0,
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
  const tankFootprint = (t) => (t.shape === 'round' ? Math.PI * t.l * t.l / 4 : t.l * t.w);
  const tankVolume = (s) => s.tanklist.reduce((a, t) => a + (t.on ? tankFootprint(t) * t.d : 0), 0);
  const usableVolume = (s) => tankVolume(s) * s.usable / 100;
  // Water surface area of the linked tanks: 1 cm of depth is this many m² × 0.01 m³.
  const planArea = (s) => s.tanklist.reduce((a, t) => a + (t.on ? tankFootprint(t) : 0), 0);
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
    const perMm = area * s.eff / 100 / 1000; // 1 mm on 1 m² is 1 litre
    const d = demand(s);
    const useSeason = d.season / 1000;
    const useOff = d.off / 1000;

    const vol = new Float32Array(L);
    const deliveryDays = [];
    const years = [];
    let v = cap * s.fill / 100;
    let arrival = -1; // day a tanker that's been ordered will arrive
    let Y = null;
    let minLevel = Infinity;
    let minDay = -1;

    const deliver = (j) => {
      const add = Math.min(s.load, cap - v);
      if (add <= 0.001) return false;
      v += add;
      Y.deliveries++;
      Y.delivered += add;
      Y.cost += add * s.price + s.callout;
      deliveryDays.push(j);
      return true;
    };

    for (let j = 0; j < L; j++) {
      const i = i0 + j;
      const m = MONTH[i];
      if (!Y || Y.year !== YEAR[i]) {
        Y = { year: YEAR[i], days: 0, seasonDays: 0, rain: 0, collected: 0, overflow: 0, used: 0,
          deliveries: 0, delivered: 0, cost: 0, dryDays: 0, min: Infinity };
        years.push(Y);
      }
      Y.days++;
      const mm = rain[i] * climateFactor(m, s);
      const occupied = inSeason(m, s.s0, s.s1);
      if (occupied) { Y.seasonDays++; Y.rain += mm; }

      // Rain in; anything above capacity overflows.
      const inflow = harvestMm(mm, s) * perMm;
      v += inflow;
      Y.collected += inflow;
      if (v > cap) { Y.overflow += v - cap; v = cap; }

      // A tanker ordered earlier arrives.
      if (arrival >= 0 && j >= arrival) { deliver(j); arrival = -1; }

      // The house uses water; if the tanks are empty, it goes without.
      const use = occupied ? useSeason : useOff;
      v -= use;
      Y.used += use;
      if (v < 0) { Y.used += v; if (use > 0) Y.dryDays++; v = 0; }

      // Order a tanker when the level falls to the trigger.
      if (s.tanker && use > 0 && arrival < 0 && v <= trigger) {
        if (s.lead > 0) arrival = j + s.lead;
        else for (let g = 0; g < 50 && v <= trigger && deliver(j); g++);
      }

      if (use > 0) {
        if (v < Y.min) Y.min = v;
        if (v < minLevel) { minLevel = v; minDay = j; }
      }
      vol[j] = v;
    }

    const T = { collected: 0, overflow: 0, used: 0, deliveries: 0, delivered: 0, cost: 0, dryDays: 0 };
    for (const y of years) for (const k of Object.keys(T)) T[k] += y[k];
    const summers = years.filter((y) => y.seasonDays > 0).length || 1;
    return {
      s, i0, L, span: L / 365.25, area, cap, trigger, d, vol, deliveryDays, years, T, summers,
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
      `${s.occ === 100 ? 'fully booked' : s.occ + '% booked'}${s.tanker ? '' : ', no tanker'}`;
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
        : 'These are the default settings for the house as it is now. Try ticking the yoga building roof, or switching the toilets to dual flush, to see what changes.';
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
      ? `Each delivery brings ${fmt(s.load)} m³ and costs about <b>${eur(s.load * s.price + s.callout)}</b>. ` +
        `It's ordered when the tanks fall to ${s.trig}% and arrives ${s.lead} ${plural(s.lead, 'day', 'days')} later.`
      : 'With no tanker, the results show how often the house would run dry.');
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
    setHTML('ex_area', `<b>${fmt(r.area)} m²</b>`);
    setHTML('ex_eff', `<b>${s.eff}%</b>`);
    setHTML('ex_usable', `<b>${m3(r.cap)}</b>`);
    const season = `${MONTHS[s.s0 - 1]} to ${MONTHS[s.s1 - 1]}`;
    setHTML('ex_use', `From ${season} the house uses <b>${fmt(r.d.season)} litres a day</b> on average ` +
      `(${s.guests} ${plural(s.guests, 'guest', 'guests')} at about ${fmt(r.d.perGuest)} litres each` +
      `${s.occ < 100 ? `, ${s.occ}% of the season booked` : ''})` +
      `${s.offPeople > 0 ? `, and ${fmt(r.d.off)} litres a day the rest of the year` : ''}.`);
    setHTML('ex_tanker', s.tanker
      ? `When the tanks fall to ${s.trig}%, a tanker is ordered and brings ${fmt(s.load)} m³ ${s.lead} ${plural(s.lead, 'day', 'days')} later.`
      : `There's no tanker in these settings, so when the tanks are empty the house has no water until it rains.`);

    setHTML('fl_rain', `${fmt(rainAvg)} mm a year`);
    setHTML('fl_area', `${fmt(r.area)} m² collecting, ${s.eff}% reaches the tanks`);
    setHTML('fl_collect', `${fmt(r.T.collected / r.span)} m³ a year`);
    setHTML('fl_tank', `${m3(r.cap)} usable`);
    setHTML('fl_season', `${season}, ${s.guests} ${plural(s.guests, 'guest', 'guests')}${s.occ < 100 ? `, ${s.occ}% booked` : ''}`);
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

  // ---- Chart ---------------------------------------------------------------

  let chartData = null;
  let layout = null;
  // The stretch of time shown on the chart, as ISO dates; null means the start or end of the period.
  let view = { from: null, to: null };
  const MONTHS_SHORT = MONTHS.map((m) => m.slice(0, 3));
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
    const area = catchment(state);
    const gained = (parseFloat(row.l1) - parseFloat(row.l0)) / 100 * planArea(state);
    if (rain.raw < 3) return { text: `Only ${fmt(rain.raw, 1)} mm fell between those readings. Pick a wetter spell.` };
    if (!(area > 0) || !(rain.usable > 0)) return { text: 'Tick at least one collecting surface first.' };
    const eff = gained / (rain.usable * area / 1000) * 100;
    return {
      eff,
      text: `${fmt(rain.raw, 1)} mm of rain, tanks gained ${m3(gained)}: <b>${fmt(eff)}%</b> reached the tanks.`,
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
    const fromRain = rain.usable * catchment(state) * state.eff / 100 / 1000;
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
      // Names are only written when they differ from the default name for that row.
      p.set('surf', s.surfaces.map((x, k) => {
        const parts = [x.on ? 1 : 0, x.l, x.w];
        if (!DEFAULT_SURFACES[k] || DEFAULT_SURFACES[k].n !== x.n) parts.push(x.n.replace(/[~|]/g, ' '));
        return parts.join('~');
      }).join('|'));
    }
    if (JSON.stringify(s.tanklist) !== JSON.stringify(DEFAULT_TANKS)) {
      p.set('tk', s.tanklist.map((t, k) => {
        const parts = [t.on ? 1 : 0, t.shape === 'round' ? 'r' : 'b', t.l, t.w, t.d];
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
      const list = p.get('surf').split('|').filter(Boolean).map((t, k) => {
        const [on, l, w, ...name] = t.split('~');
        const n = name.join(' ') || (DEFAULT_SURFACES[k] ? DEFAULT_SURFACES[k].n : 'Other surface');
        return { on: on === '1' ? 1 : 0, l: parseFloat(l) || 0, w: parseFloat(w) || 0, n };
      });
      if (list.length) s.surfaces = list;
    }
    if (p.has('tk')) {
      const list = p.get('tk').split('|').filter(Boolean).map((t, k) => {
        const [on, shape, l, w, d, ...name] = t.split('~');
        return {
          n: name.join(' ') || (DEFAULT_TANKS[k] ? DEFAULT_TANKS[k].n : 'Tank ' + (k + 1)),
          shape: shape === 'r' ? 'round' : 'box',
          l: parseFloat(l) || 0, w: parseFloat(w) || 0, d: parseFloat(d) || 0,
          on: on === '1' ? 1 : 0,
        };
      });
      if (list.length) s.tanklist = list;
    } else if (['tanks', 'tl', 'tw', 'td'].some((k) => p.has(k))) {
      // Links made before tanks became a list described n identical box tanks.
      const num = (k, def) => (isFinite(parseFloat(p.get(k))) ? parseFloat(p.get(k)) : def);
      const count = Math.max(1, Math.round(num('tanks', 2)));
      s.tanklist = Array.from({ length: count }, (_, k) => (
        { n: 'Tank ' + (k + 1), shape: 'box', l: num('tl', 4), w: num('tw', 4), d: num('td', 4), on: 1 }));
    }
    if (!R.sources[s.src]) s.src = DEFAULTS.src;
    if (!(s.toilet in TOILET_LITRES)) s.toilet = DEFAULTS.toilet;
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
        (k >= DEFAULT_SURFACES.length ? ' <button type="button" class="small-btn">Remove</button>' : '');
      const [on, name, len, wid] = el.querySelectorAll('input');
      on.checked = !!x.on;
      name.value = x.n;
      len.value = x.l;
      wid.value = x.w;
      on.addEventListener('change', () => { x.on = on.checked ? 1 : 0; schedule(); });
      name.addEventListener('input', () => { x.n = name.value; schedule(); });
      len.addEventListener('input', () => { const v = parseFloat(len.value); if (isFinite(v)) { x.l = v; schedule(); } });
      wid.addEventListener('input', () => { const v = parseFloat(wid.value); if (isFinite(v)) { x.w = v; schedule(); } });
      const del = el.querySelector('button');
      if (del) del.addEventListener('click', () => { state.surfaces.splice(k, 1); renderSurfaces(); schedule(); });
      box.appendChild(el);
      return { el, area: el.querySelector('.area') };
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
        (k >= DEFAULT_TANKS.length ? ' <button type="button" class="small-btn">Remove</button>' : '');
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

    state = fromHash(location.hash);
    view = viewFromHash(location.hash);
    setInputs();
    buildCalibration();

    document.querySelectorAll('[data-k]').forEach((el) => {
      const evt = el.tagName === 'SELECT' || el.type === 'checkbox' || el.type === 'radio' ? 'change' : 'input';
      el.addEventListener(evt, () => { readInput(el); schedule(); });
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
    window.addEventListener('resize', () => drawChart());
    window.addEventListener('hashchange', () => {
      if (location.hash.replace(/^#/, '') === toHash(state)) return;
      state = fromHash(location.hash);
      view = viewFromHash(location.hash);
      setInputs();
      schedule();
    });

    update();
  }

  init();
})();
