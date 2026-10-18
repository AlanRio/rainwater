"""Quick what-if tables from the command line, using the same daily water balance as app.js.

Standard library only. Edit the SCENARIOS list at the bottom and run:

    python scripts/scenarios.py

Defaults match the website: 8 guests May-October; showers 50 L, toilets 5 x 9 L, taps 15 L per
guest a day; laundry 8 x 55 L a week and dishwasher 1.5 x 12 L a day; roofs 75% and the ground
sheet 85% reaching the tanks; 90% of tank volume usable; a 12 m3 tanker ordered at 5% and
arriving 2 days later at EUR 150 + EUR 3/km x 2 x 15.6 km + EUR 2.80/m3. A "sheet tank" is filled
only by the sheet and empties into the main tanks whenever they have room.
"""
import datetime as dt
import os
import re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def load_rain(source='anglars'):
    text = open(os.path.join(ROOT, 'rainfall.js'), encoding='utf-8').read()
    block = text.split(source + ': {', 1)[1].split('mm: [', 1)[1].split(']', 1)[0]
    mm = [float(x) for x in re.findall(r'-?\d+(?:\.\d+)?', re.sub(r'//[^\n]*', '', block))]
    start = dt.date.fromisoformat(re.search(r'start: "(\d{4}-\d{2}-\d{2})"', text).group(1))
    return [start + dt.timedelta(i) for i in range(len(mm))], mm


DAYS, RAIN = load_rain()


def run(roofs_m2, tanks_m3, sheet_m2=0.0, sheet_tank_m3=0.0, from_year=2010, guests=8,
        per_guest=50 + 45 + 15, house_l=8 * 55 / 7 + 1.5 * 12, roof_eff=0.75, sheet_eff=0.85,
        usable=0.9, season=(5, 10), load=12, trigger=0.05, lead=2):
    """Returns tankers a summer, cost a year, summers needing a tanker, total, lowest level (m3), its year."""
    i0 = DAYS.index(dt.date(from_year, 1, 1))
    cap, caps = tanks_m3 * usable, sheet_tank_m3 * usable
    use = (guests * per_guest + house_l) / 1000
    v, s, arrival, n, cost, years, low, low_year = cap, caps, -1, 0, 0.0, set(), 1e9, None
    for i in range(i0, len(RAIN)):
        d = DAYS[i]
        occ = season[0] <= d.month <= season[1]
        v = min(cap, v + RAIN[i] * roofs_m2 * roof_eff / 1000)
        if caps > 0:
            s = min(caps, s + RAIN[i] * sheet_m2 * sheet_eff / 1000)
            move = min(s, cap - v)
            v, s = v + move, s - move
        else:
            v = min(cap, v + RAIN[i] * sheet_m2 * sheet_eff / 1000)
        if 0 <= arrival <= i:
            add = min(load, cap - v)
            v += add
            n += 1
            cost += add * 2.8 + 150 + 3 * 2 * 15.6
            years.add(d.year)
            arrival = -1
        if occ:
            v = max(0.0, v - use)
            if arrival < 0 and v + s <= trigger * (cap + caps):
                arrival = i + lead
            if v + s < low:
                low, low_year = v + s, d.year
    span = (len(RAIN) - i0) / 365.25
    return round(n / span, 2), round(cost / span), len(years), n, round(low, 1), low_year


if __name__ == '__main__':
    HOUSE_GITE = 15 * 5 + 14 * 7
    STEP1 = HOUSE_GITE + 5 * 7 + 12 * 4.5 + 5 * 5   # + yoga building, car port, house terrace
    TANKS = 50 + 10   # solar building tank and house tank
    SCENARIOS = [
        ('As now: house and gîte roofs', dict(roofs_m2=HOUSE_GITE, tanks_m3=TANKS)),
        ('1. Step 1 roofs', dict(roofs_m2=STEP1, tanks_m3=TANKS)),
        ('1 + 2. Plus 50 m3 new storage', dict(roofs_m2=STEP1, tanks_m3=TANKS + 50)),
        ('1 + 2 + 3. Plus dual flush', dict(roofs_m2=STEP1, tanks_m3=TANKS + 50, per_guest=50 + 22.5 + 15)),
        ('1, 70 m3 new storage, 90 m2 sheet', dict(roofs_m2=STEP1, tanks_m3=TANKS + 70, sheet_m2=90)),
    ]
    print('scenario | tankers/summer | EUR/year | summers with a tanker | total | lowest m3 | year')
    for name, kw in SCENARIOS:
        print(name, '|', ' | '.join(str(x) for x in run(**kw)))
