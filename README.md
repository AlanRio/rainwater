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
| Optional surfaces | New 10 × 10 m roof, terraces 10 × 4 m and 5 × 3 m | Off by default |
| Collection efficiency | 75% | BS 8515 / DIN 1989 use about 0.8–0.9 runoff × 0.9 filter; set lower for clay tiles and summer cloudbursts |
| Tanks | Tank 1 and Tank 2, each a 4 × 4 × 4 m box, 90% usable | Estimated, still to be measured. Each tank has its own size and shape (box or round), and more can be added |
| Guests | 8, fully booked, May to October | |
| Water use | 120 L per guest per day | Showers 1 × 50 L, standard 9 L flush × 5, taps 15 L; laundry 8 loads × 55 L a week and dishwasher 1.5 × 12 L a day for the house |
| Tanker | On; ordered at 5%, arrives after 2 days; 12 m³ loads | Small rigid tanker suits the access |
| Water price | €2.80/m³ | SISPEA, Lot (46) average, 2025 |
| Call-out | €270 per delivery | Makes a 12 m³ delivery about €300, in line with published prices for small loads |
| Climate | No change | "2050 outlook" preset: summer −15%, winter +12% (Météo-France, Occitanie) |
| Period | From 2010 | Selectable back to 1994 |
