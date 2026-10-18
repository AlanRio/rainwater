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
| `index.html` | Page layout, styles and the written explanation |
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

Where things stand (18 October 2026), for picking this up in a new session:

- **The recommendation** is on the page under "The recommended fix": step 1, gutter the yoga
  building, car port and house terrace into the main tanks; step 2, for no tankers at all,
  dual-flush toilets or a 90 m² rain sheet (20 × 4.5 m) on the slope south of the buildings.
- **Open question: the main tanks' real size.** The page assumes the house tank and the solar
  building tank are 4 × 4 × 4 m each (128 m³, 115 m³ usable). A business partner says they are
  10 m³ and 50 m³; the 10 m³ is doubtful (it is at least 3 m deep, so 10 m³ would mean only
  about 1.8 × 1.8 m inside). If the total really is about 60 m³, storage becomes the
  bottleneck: step 1 alone still needs about 4.5 tankers a summer, and more storage (an extra
  tank) matters more than more collecting surface.
- **Next steps once measured** (inside length, width, depth to the overflow, height of the pump
  intake for each tank):
  1. Set the sizes of "House tank" and "Solar building tank" in `DEFAULT_TANKS` in `app.js`
     (and the usable share in `DEFAULTS.usable` if it differs from 90%).
  2. Rerun the options with `python scripts/scenarios.py` (edit the list at the bottom),
     including extra storage, and choose step 2 again: the sheet size, an extra tank (the
     "Extra tank (sheet only)" row in the simulator; a buried precast concrete rainwater tank
     was the preferred kind), or both.
  3. Update the hard-coded numbers in `index.html` (the fix section's text, the options table
     and the storage table, which say "Worked out on 18 October 2026"), this README, and the
     sheet size in `DEFAULT_SURFACES` and `data/sheet_layout.json`; then
     `python scripts/site_map.py` to redraw the map.
  4. Commit and push to `main`; GitHub Actions publishes the page.
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
| ERA5 via Open-Meteo, 44.5 N 1.2 E | Weather-model reconstruction on a ~28 km grid | Independent cross-check |

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

## The recommended fix: connect the other roofs first, then close the gap

The roofs catch too little rain: with the house full all summer, the house and gîte roofs can't
even refill the tanks over winter. The fix is more collecting surface, starting with what's
already there. The page has the full write-up, the map and the sources; in short (default
settings: 8 guests May–October, main tanks estimated at 115 m³ usable):

- **Step 1: connect the yoga building (5 × 7 m), car port (12 × 4.5 m) and house terrace
  (5 × 5 m, above the house tank).** 114 m² more for gutters, downpipes, first-flush diverters
  and pipes, about €1,500–5,000. Tankers go from 5.3 a summer (about €1,500 a year) to about
  0.7: none in 10 of the 17 summers since 2010, most others one, 2011 four or five. The car port
  was meant for a swimming pool; it can feed the house tanks first and overflow to the pool.
- **Step 2, for no tankers at all:** dual-flush toilets (no tanker in any summer since 1994,
  lowest about 10 m³ in 2009); or a rain sheet of about 90 m² (20 × 4.5 m) on the slope south
  of the buildings, about €2,500–4,500 (no tanker since 2010; one or two in a 2009-like summer);
  or about 105 m² more roof such as the garage.
- **Measure the main tanks first:** with step 1 done, the sheet needed is 90 m² at 115 m³ usable,
  55 m² at 120, 50 m² at 124 and 45 m² at 130. A 10 m³ extra tank fed only by the sheet would
  bring 90 m² down to about 70 m², but costs more than the sheet it saves.
- **Site of the sheet** (IGN LiDAR HD, flown 11 April 2022): the
  house sits on a saddle at about 229.5 m between two hollows. The slope south of the buildings
  rises from about 231 to 232 m at 10°, facing west-north-west. The sheet is square on the
  slope, its 20 m bottom edge on the contour with a collection trench falling 1% to the
  north-east end; about 25 m of buried 110 mm pipe falls about 2 m to the main tanks at the
  southern corner of the north-east building (up to about 2 m deep beside the south-east
  building). No pump.
- **The earlier plan,** a 155 m² sheet with a 10 m³ precast tank and no other roofs, cost about
  €7,000–13,000 and is kept on the page for comparison.
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
| Ground sheet | 20 × 4.5 m EPDM sheet, 85% reaching the tanks | Off by default; step 2 of the recommended fix (see above) |
| Collection efficiency | 75% | BS 8515 / DIN 1989 use about 0.8–0.9 runoff × 0.9 filter; set lower for clay tiles and summer cloudbursts |
| Tanks | House tank and solar building tank, each a 4 × 4 × 4 m box, 90% usable | Estimated, still to be measured. Each tank has its own size and shape (box or round), and more can be added |
| Guests | 8, house full, May to October | |
| Water use | 120 L per guest per day | Showers 1 × 50 L, standard 9 L flush × 5, taps 15 L; laundry 8 loads × 55 L a week and dishwasher 1.5 × 12 L a day for the house |
| Tanker | On; ordered at 5%, arrives after 2 days | |
| Supplier | Transports Delrieu, Parnac, 15.6 km by road | Nearest haulier with food-grade tanks |
| Tanker size | Small rigid lorry, 12 m³ | Cautious until access for a bigger lorry is checked; presets for 16, 20 and 28 m³ |
| Delivery cost | €150 fixed + €3/km on the round trip + €2.80/m³ water | See below |
| Climate | No change | "2050 outlook" preset: summer −15%, winter +12% (Météo-France, Occitanie) |
| Period | From 2010 | Selectable back to 1994 |

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
