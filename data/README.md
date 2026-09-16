# Vacancy dataset

This folder is the research dataset. GitHub Actions appends a snapshot about every 15 minutes. The GitHub Pages site reads copies under `docs/data/`.

## Files

| Path | Purpose |
| --- | --- |
| `latest/vacancy.json` | Most recent vacancy snapshot for the dashboard |
| `latest/carparks.json` | Park names, districts, coordinates, declared capacity. Rewritten only when metadata changes. |
| `latest/quality.json` | Missingness, vacancy types, and source delay |
| `history/YYYY-MM-DD.jsonl` | One compact snapshot per line for that Hong Kong date |

## History line schema

```json
{
  "ts": "2026-09-16T20:30:00+08:00",
  "n": 581,
  "p": {
    "27": {
      "privateCar": [3, "A"],
      "motorCycle": [2, "A"]
    }
  },
  "q": {
    "privateCar_available_pct": 82.1,
    "privateCar_unavailable_pct": 14.2
  }
}
```

Each vehicle value is `[vacancy, vacancy_type]`.

- `vacancy` `-1` means the source reported N/A. It is not zero vacant spaces.
- Missing vehicle keys mean that park did not report that vehicle type.
- `vacancy_type` follows Transport Department:
  - `A`: number of vacant spaces
  - `B`: occupancy status (`0` full, `1` filling, `2` plenty)
  - `C`: occupancy status (`0` full, `1` not full)

Do not mix type A counts with type B/C status codes in the same MAE.

## Sources

- Vacancy: `https://api.data.gov.hk/v1/carpark-info-vacancy?data=vacancy`
- English metadata: `https://api.data.gov.hk/v1/carpark-info-vacancy`
- Chinese names: `https://resource.data.one.gov.hk/td/carpark/basic_info_all.json`

No API key is stored. Scheduled collection can be several minutes late because GitHub cron is best-effort.
