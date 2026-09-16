# EaseParkHK（泊易香港）

香港停車場開放數據嘅收集、質素分析同短期空置預測。結果用 **GitHub Pages** 公開展示。冇後端、冇登入、冇 Gemini。

## 研究問題

用運輸署開放數據，可唔可以預測未來 30 分鐘私家車空位？誤差比起「假設同而家一樣」（persistence baseline）低幾多？

網站只係方法嘅展示層。貢獻喺資料集、缺值規則、baseline 同 MAE／RMSE，唔係帳戶系統。

## 改咗形態嘅功能

| 舊 Flask web app | 而家 Pages |
| --- | --- |
| 即場 `requests` / `pandas.read_excel` | GitHub Actions 每 15 分鐘寫 JSON，網頁讀檔 |
| 登入、電郵重設、Flask-Login、session | 已放棄 |
| 收藏用 server session | `localStorage`（只限同一部瀏覽器） |
| Gemini chatbox | 已放棄（API key 唔可以放前端） |
| follow / Post / Product / Brand 教學碼 | 已刪 |
| 「真即時後端」 | 「最近一次快照」+ 若 CORS 允許，瀏覽器再打一次政府 API |

## 本地預覽靜態站

```sh
git clone https://github.com/yourusername/IT114115-FYP-EaseParkHK.git
cd IT114115-FYP-EaseParkHK
python scripts/run_pipeline.py
python -m http.server 8080 --directory docs
```

瀏覽器打開 `http://localhost:8080`。采集器唔需要 `.env`，亦冇 API key。

測試：

```sh
python tests/test_collect_vacancy.py
python tests/test_forecast_and_feeds.py
```

`--skip-feeds` 可以跳過咪錶 Excel／新聞／鏡頭（較快）：

```sh
python scripts/run_pipeline.py --skip-feeds
```

## GitHub Pages

1. Push 去 default branch。
2. **Settings → Pages**：Source = Deploy from a branch，branch = `main`，folder = `/docs`。
3. **Settings → Actions → General**：允許 Actions，Workflow permissions = **Read and write**。
4. **Actions → Collect open data → Run workflow** 手動跑一次。
5. 之後約每 15 分鐘 UTC 更新 `data/` 同 `docs/data/`。GitHub cron 會遲；當最近一次成功采集。

無 repository secrets。超過約 60 日冇活動，排程會停，打開 repo 或手動跑一次即可。

## 數據同模型

| 檔 | 用途 |
| --- | --- |
| `data/latest/vacancy.json` | 最新空位 |
| `data/latest/carparks.json` | 名稱、坐標、公布車位數 |
| `data/latest/quality.json` | 覆蓋率、`-1`、延遲 |
| `data/latest/forecast.json` | 30 分鐘 persistence／trend |
| `data/latest/metrics.json` | MAE／RMSE（要有相隔約 30 分鐘嘅快照） |
| `data/history/YYYY-MM-DD.jsonl` | 訓練／評估用歷史 |
| `docs/data/*.json` | Pages 讀嘅副本 |

規則：只評分 `vacancy_type = A` 且 `vacancy >= 0`。`-1`、缺值、B／C 狀態碼唔混進 MAE。詳見 [`data/README.md`](data/README.md)。

- Baseline：ŷ(t+30) = y(t)
- 對照模型：用最近 15 分鐘差值外推 30 分鐘，下限 0

## 限制

數據唔完整、部分場 `lastupdate` 過時、預測唔等於保證有位。收藏唔跨裝置。鏡頭圖片仍由政府主機提供。

## Licence

MIT. See [`LICENSE`](LICENSE). Open data remains under the [Hong Kong Government Open Data Licence](https://data.gov.hk/en/terms-and-conditions).
