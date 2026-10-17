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
| `.github/workflows/publish.yml` | Weekly data refresh and publishing to GitHub Pages |

No build step and no external dependencies. Open `index.html` in a browser and it works,
including offline: the data is loaded with a `<script>` tag rather than fetched, so it also
works when opened straight from disk.

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
| Météo-France rain gauge 46005001, Anglars-Juillac | Measured daily rainfall, 2.1 km from the house at the same height (104 m). Complete from 1994 | Default |
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
3. Harvest (m³) = that rain (mm) × collecting area (m²) × collection efficiency ÷ 1000.
   1 mm on 1 m² is 1 litre.
4. Anything above the usable tank volume overflows.
5. A tanker ordered earlier arrives: one load, or less if the tank can't take it all.
   Each delivery costs load × water price + call-out.
6. The house uses water: during the season, guests × litres per guest plus the house's
   laundry, dishwasher and other use, scaled by the share of the season booked; outside the
   season, people present × litres per person. If the tanks are empty, the shortfall is a
   day without water.
7. If the level is at or below the trigger and water is being used, a tanker is ordered,
   arriving after the set number of days.

The tank level carries over from day to day through the whole period.

Calibration on the page uses the Anglars gauge: tank depth readings before and after a rainy
spell give the real collection efficiency (water gained ÷ rain × area); readings across a
stretch with guests give real litres per guest per day (fall in level plus rain added).

## Default settings

| Setting | Default | Basis |
|---|---|---|
| Collecting surfaces | Roofs 1 and 2, 15 × 5 m each | Footprint (plan area), which is what catches rain |
| Optional surfaces | Yoga building roof 5 × 7 m, terraces 10 × 4 m and 5 × 3 m | Off by default |
| Collection efficiency | 75% | BS 8515 / DIN 1989 use about 0.8–0.9 runoff × 0.9 filter; set lower for clay tiles and summer cloudbursts |
| Tanks | Tank 1 and Tank 2, each a 4 × 4 × 4 m box, 90% usable | Estimated, still to be measured. Each tank has its own size and shape (box or round), and more can be added |
| Guests | 8, fully booked, May to October | |
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
guides), and about €10 per m³ for 30 m³ loads, which is what Figeac paid when trucking in
drinking water in August 2026 (€10,000 a day for about 1,000 m³; France 3, 14 August 2026).
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
