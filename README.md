# Will the rainwater last the summer?

Live: https://alanrio.github.io/rainwater/

A day-by-day water balance for an off-grid house near Prayssac (Lot, France) that runs on
rain collected from its roofs. It replays every day of measured rainfall since 1994 through
the roofs and tanks, takes off what guests use, and shows how often a tanker would be needed,
what that costs, and whether the house would ever run dry. Every assumption is a setting on
the page, and the settings are stored in the page address so a scenario can be shared as a link.

## Files

| File | What it is |
|---|---|
| `index.html` | Page layout, styles and the written explanation, in English and Dutch |
| `app.js` | Simulation, results, chart, comparison, calibration, shareable links |
| `rainfall.js` | Daily rainfall data, generated. Do not edit by hand |
| `scripts/update_rainfall.py` | Rebuilds `rainfall.js` from Météo-France and Open-Meteo |
| `img/rain-sheet-site.jpg` | LiDAR relief map of the site with the proposed rain sheet |
| `scripts/site_map.py` | Redraws that map from `data/` (numpy and matplotlib) |
| `scripts/scenarios.py` | What-if tables from the command line, same model as the page (standard library) |
| `data/site_lidar.npz`, `data/sheet_layout.json` | LiDAR extract around the site and the sheet's position |
| `.github/workflows/publish.yml` | Weekly data refresh and publishing to GitHub Pages |

No build step and no external dependencies. Open `index.html` in a browser and it works,
including offline: the data is loaded with a `<script>` tag rather than fetched, so it also
works when opened straight from disk.

## Continuing this project

Where things stand (20 October 2026), for picking this up in a new session:

- **The page is written for business partners with little time.** The top screen says it in
  plain terms: the rainwater runs out every summer (mid-August, about 8 weeks without water,
  with a full house and nothing trucked in); two fixes, both needed; plan B if it's still short.
  It avoids m², m³, lorries and prices on purpose. Below it, in order: why it runs out, plan B
  (a live sheet-size slider), the numbers (options table and a roof × tank grid), the details,
  how the model works, and the simulator ("Try it yourself").
- **The page is in English and Dutch**, with a switch at the very top. Static text in
  `index.html` is written twice, marked `lang="en"` and `lang="nl"`, and CSS hides the language
  not in use; text written by `app.js` goes through `tr(english, dutch)`, and numbers and dates
  follow the language (3,7 and € 1.015 in Dutch). Change both when editing text. The choice is
  stored in the link as `#lang=nl` and remembered on the device; otherwise the browser's first
  language decides. Default surface and tank names stay English in the settings and links and are
  shown in Dutch through `NAMES_NL`.
- **Every number in the top half is worked out by the page** from the default settings
  (`renderStory` and the functions after it in `app.js`), over complete summers since 1994. So
  changing `DEFAULT_SURFACES`, `DEFAULT_TANKS` or `DEFAULTS` updates the story, the tables and the
  charts, and each new summer is added by the weekly rainfall update. Only the costs and the
  descriptive text in the details are typed in.
- **The recommendation:** step 1, gutter the yoga building, car port and house terrace; step 2, a
  new buried tank of about 25 m³ (`New buried tank` in `DEFAULT_TANKS`). Plan B, the "get out of
  jail" card: the rain sheet on the slope, as big as it takes. The target is no summer with more
  than 3 tanker deliveries.
- **Settled:** the tanks are 10 m³ (house) and 50 m³ (solar building); the toilets are dual flush
  6/2 L, modelled as 3.3 L a flush (one full for every two short).
- **Open:** the cost of the new tank (quotes); the pump intake height in the existing tanks (the
  usable share, `DEFAULTS.usable`, is 90% by assumption); how much rain really reaches the tanks
  (75% by assumption; the dipstick tool on the page measures it once the guttering is done).
- **Checking changes:** `python scripts/scenarios.py` uses the same model and gives the same tanker
  numbers as the simulator for the same settings.
- **Commits:** use the GitHub no-reply e-mail for this public repository, not a personal one.

## Publishing and updates

Every push to `main` publishes the site. Every Monday a GitHub Action runs
`scripts/update_rainfall.py`, commits the new `rainfall.js` if anything changed, and
republishes. It can also be run by hand from the Actions tab ("Run workflow").

GitHub Pages must be set to **Settings → Pages → Source: GitHub Actions**.

To refresh the data locally:

```
python scripts/update_rainfall.py
```

## Rainfall data

| Source | What it is | Role |
|---|---|---|
| Météo-France rain gauge 46005001, Anglars-Juillac | Measured daily rainfall, 2.9 km from the house. The gauge is at 104 m in the valley, the house at about 229 m on the plateau. Complete from 1994 | Default |
| ERA5 via Open-Meteo, 44.512 N 1.188 E | Weather-model reconstruction on a ~28 km grid | Independent cross-check |

The gauge file comes from data.gouv.fr ("Données climatologiques de base - quotidiennes",
department 46). Each gauge value is the 24 hours from 06:00 UTC that day to 06:00 UTC the
next. Any missing gauge day is filled with the ERA5 value for that day; there are none since
1994.

Checks done when choosing the source (2010–2025):

- May–October rain averaged 384 mm at Anglars, 381 mm at Montcuq, 374 mm at Le Montat and
  382 mm at Gourdon, so the Anglars gauge agrees with its neighbours.
- Annual rain: gauge 856 mm, ERA5 861 mm. May–October: gauge 384 mm, ERA5 410 mm. ERA5
  overstated summer rain by 20–30% in 2024–2026.
- Over 2010–2025 both sources give the same number of tanker deliveries.

## Model

For each day, in order:

1. Climate adjustment, if set: rain from June to August and from December to February is
   scaled by the chosen percentages.
2. Rain reaching the gutters = rain capped at the overflow threshold (if set), minus the
   loss at the start of each wet day (if set).
3. Harvest (m³) = that rain (mm) × collecting area (m²) × collection efficiency ÷ 1000,
   summed over the surfaces. 1 mm on 1 m² is 1 litre. A surface can have its own efficiency
   (the ground sheet uses 85%); the others use the general setting.
4. Anything above the usable tank volume overflows.
5. A tanker ordered earlier arrives: one load, or less if the tank can't take it all.
   Each delivery costs the fixed charge + the distance charge + load × water price.
6. The house uses water: during the season, guests × litres per guest plus the house's
   laundry, dishwasher and other use, scaled by the share of the season the house is full; outside the
   season, people present × litres per person. If the tanks are empty, the shortfall is a
   day without water.
7. If the level is at or below the trigger and water is being used, a tanker is ordered,
   arriving after the set number of days.

The tank level carries over from day to day through the whole period.

Calibration on the page uses the Anglars gauge: tank depth readings before and after a rainy
spell give the real collection efficiency (water gained ÷ rain × area, after taking off what
surfaces with their own efficiency delivered); readings across a stretch with guests give real
litres per guest per day (fall in level plus rain added).

Settings live in the page address. Surfaces are written as
`on~length~width[~e<share>][~g][~name]` and tanks as `on~shape~length~width~depth[~g][~name]`,
separated by `|`, where `g` marks the proposed ground sheet and its extra tank. Links made
before these existed get them added, switched off. The calibration tool leaves both out, as
they aren't built.

The extra tank is modelled as a separate store: only the sheet fills it, and each day it
empties into the main tanks as far as they have room (on site, a solar pump switched by a float
switch in the main tanks). The level shown is the total of both.

## The recommended fix: gutter the other roofs, add a tank, plan B if needed

With a full house (8 guests May–October, dual flush), about 730 litres a day. The tanks hold
about 10½ weeks of that; the season is 26 weeks. Every summer since 1994 runs dry with the
house as it is. Since 1994 (32 complete summers), with the default settings:

| Option | Typical summer without water | Driest (2009) | Summers that run dry | Tankers a summer: average / worst |
|---|---|---|---|---|
| As now | 8 weeks | 13 weeks | 32 of 32 | 3.6 / 6 |
| Step 1: gutter the yoga building, car port and house terrace (+114 m²) | 2 weeks | 9 weeks | 23 of 32 | 1.4 / 4 |
| **Steps 1 and 2: plus a 25 m³ buried tank** | **none** | **4 weeks** | **5 of 32** | **0.3 / 2** |
| Steps 1 and 2 plus a 90 m² rain sheet | none | 1 week | 1 of 32 | 0.1 / 1 |
| Step 1 and a 90 m² rain sheet, no new tank | none | 6 weeks | 11 of 32 | 0.5 / 3 |

(Worked out on 20 October 2026; the page recalculates these itself.) There's no fixed ratio of
roof to tank: for the 3-tanker target, the tank needed shoots up below about 220 m² of roof (95 m³
at 220 m², 285 m³ at 210 m²), and above it more roof lets the tank shrink only slowly (75 m³ at
287 m², 55 m³ at 400 m²; the grid on the page).

The rain sheet site: 20 × 4.5 m on the slope south of the buildings, with room for at least
20 × 7.75 m (IGN LiDAR HD, tiles 0557_6382 and 0558_6382, flown 11 April 2022); the house sits
on a saddle at about 229.5 m, the slope rises from about 231 to 232 m at 10° facing
west-north-west, and about 25 m of buried pipe falls about 2 m to the main tanks at the
southern corner of the north-east building.
- **Suppliers:** Egide Systèmes, Mérignac, 05 56 02 76 39 and EPDM Méditerranée, Mudaison,
  07 82 52 53 55 (Elevate distributors); Chausson Matériaux (Flexirub Aquafilma, made to
  measure); ETOBA, 01 34 84 04 64.
- **Rules:** PLUi zone Ntvb, which bans digging out or raising the ground except for permitted
  works and earthworks covered by visible sheeting, even where no permit is needed; ask the
  mairie in writing first. ZNIEFF type 1 "Bois sec de Niaudon" (semi-dry limestone grassland):
  low risk for about 120 m² next to the buildings; work in autumn or winter and fell no trees.

### Why not a borehole

The house is at 229 m. The nearest boreholes, all on valley floors, found water at levels from
118 m above sea level down to below sea level, and the springs come out at about 100–110 m, so
water is at least about 110 m down and could be much deeper. Karst limestone can give a dry
hole: roughly a 1 in 5 chance for the first hole, as a judgement. With water at about 140 m,
the hole alone costs about €20,000 if the first one works, about €33,000 if the second does,
about €29,000 for two dry holes and no water; about €22,000 on average. Each extra 10 m adds
about €1,100. A pump able to lift 130 m or more, its solar drive and treatment add
€5,000–9,000.

## Default settings

| Setting | Default | Basis |
|---|---|---|
| Collecting surfaces | House roof 15 × 5 m and gîte roof 14 × 7 m | Footprint (plan area), which is what catches rain |
| Optional surfaces | Yoga building roof 5 × 7 m, terraces 10 × 4 m and 5 × 3 m, car port roof 12 × 4.5 m (meant for a swimming pool), house terrace 5 × 5 m (above the house tank) | Off by default |
| Ground sheet | 20 × 4.5 m EPDM sheet, 85% reaching the tanks | Off by default; plan B (see above) |
| Collection efficiency | 75% | BS 8515 / DIN 1989 use about 0.8–0.9 runoff × 0.9 filter; set lower for clay tiles and summer cloudbursts |
| Tanks | Solar building tank 50 m³ (4.5 × 4.45 × 2.5 m) and house tank 10 m³ (2 × 2 × 2.5 m), 90% usable; new buried tank 25 m³ (4 × 2.5 × 2.5 m), off | Each tank has its own size and shape (box or round), and more can be added |
| Guests | 8, house full, May to October | |
| Water use | 82 L per guest per day plus 81 L for the house | Showers 1 × 50 L, dual flush 6/2 L × 5 (3.3 L average: one full for every two short, as in the UK water efficiency calculator, Approved Document G), taps 15 L; laundry 8 loads × 55 L a week and dishwasher 1.5 × 12 L a day for the house |
| Tanker | On; ordered at 5%, arrives after 2 days | |
| Supplier | Transports Delrieu, Parnac, 15.6 km by road | Nearest haulier with food-grade tanks |
| Tanker size | Small rigid lorry, 12 m³ | Cautious until access for a bigger lorry is checked; presets for 16, 20 and 28 m³ |
| Delivery cost | €150 fixed + €3/km on the round trip + €2.80/m³ water | See below |
| Climate | No change | "2050 outlook" preset: summer −15%, winter +12% (Météo-France, Occitanie) |
| Period | From 1994 | The whole gauge record |

## Tanker deliveries

Cost per delivery = fixed charge + €/km × 2 × road distance + water price × m³ delivered.

- **Fixed charge, €150:** filling up at an authorised point on the water network, hooking up and pumping off, about 1 to
  1.5 hours of lorry and driver. Lorries with a driver hire at €90 to €130 an hour.
- **€3 per km, round trip:** CNR (the French road-haulage cost observatory) puts the full
  cost of a lorry at about €1.80 to €2.30 per km; delivery firms quote €2 to €4 per km.
- **Water, €2.80 per m³:** SISPEA average drinking-water price for the Lot, 2025.

Checked against two real prices: about €300 for a small private delivery (French price
guides), and about €10 per m³, which is what Figeac budgeted in its August 2026 drought plan
for trucking in drinking water (about €10,000 a day for up to about 1,000 m³; France 3,
14 August 2026; the plan had not been triggered).
The model gives €277 for 12 m³ and €322 for 28 m³ from Parnac.

Water weighs a tonne per m³, so the legal weight limit sets the load: about 12 m³ on a
two-axle lorry (19 t), 16 m³ on three axles (26 t), 20 m³ on four (32 t), 25 to 30 m³ on an
articulated tanker (44 t). An articulated tanker needs a lane at least 3 m wide, 4 m
headroom, firm ground, room to turn and no weight limits on the way; the hose reaches
about 30 m.

### Hauliers near the house (researched October 2026)

No firm in the Lot advertises water deliveries to homes. These run tankers near the house;
none has been asked for a quote yet. Road distances are from OSRM to Prayssac.

| Haulier | Base | Road distance | What they run | Contact |
|---|---|---|---|---|
| Transports Delrieu | 91 chemin de la Combe du Tic, 46140 Parnac | 15.6 km, 19 min | 4 food-grade tanker semi-trailers (bulk wine, also to private customers); 2 × 28 m³ other-water tankers | 05 65 30 70 51 |
| SARL Cassan | Rue des Charmes, Le Nouel, 46220 Prayssac | 1.6 km, 3 min | Fuel and liquids tankers, within 40 km. Not usable for washing water unless they have a food-grade tank | 05 65 36 20 13, cassanpetrolier@orange.fr |
| Établissements Imbert | ZAE Les Falguières, 46230 Fontanes | 42.7 km, 47 min | Haulage incl. bulk tanker work (directories); tank type not confirmed | 05 65 22 13 60 |
| Amichauf | 52 avenue de Sarlat, 46200 Souillac | 86.7 km, 78 min | Listed for water treatment, transport and distribution; no tanker details | — |
| Transports Veynat | 62 avenue de Branne, 33370 Tresses | 196.5 km, 2 h 43 | Drinking-water tanker specialist (food-grade liquids since the 1880s) | 05 57 97 70 30, transport-eau@veynat.fr |

Ruled out: Transports Daurat (Cancon, liquidated 2023), Transports Roquemauroux (Duravel,
solid bulk only), Flocea and Eau Source Distribution (brokers based on the Mediterranean
coast).

In a drought, towns in the Lot compete for the same tankers (Figeac had public contracts
ready in August 2026), so book early or arrange a standing agreement.

### Where the water comes from

None of the hauliers above sells water. A tanker has to fill up from the public network at
a point the operator authorises. Taking water from fire hydrants without written permission
is prohibited and can be prosecuted as theft. The usual legal routes are a pre-paid filling
station for professionals (*borne de puisage*; the neighbouring Lot-et-Garonne syndicate
Eau47 runs several at €2/m³ excl. VAT), a temporary metered connection agreed with the
operator, or a supply agreement with the syndicate.

Prayssac's drinking water comes from the **Aquareso** syndicate (33 communes of the Lot
valley and Bouriane, including Prayssac, Anglars-Juillac and Puy-l'Évêque), which contracts
the network out to **SOGEDO** (SAUR until the end of 2025).

- Aquareso: ZA de La Paganie, 46700 Puy-l'Évêque, 05 65 36 06 54, accueil@aquareso.fr
- SOGEDO (24 h): 05 53 30 21 98

No public filling station in the Aquareso area was found online. Ask Aquareso where a
tanker can fill near Prayssac, which hauliers already do it, and at what price.
