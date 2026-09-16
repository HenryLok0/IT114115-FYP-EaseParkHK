const LIVE_URL =
  "https://api.data.gov.hk/v1/carpark-info-vacancy?data=vacancy&vehicleTypes=privateCar,motorCycle,LGV,HGV,coach&lang=en_US";
const FAV_KEY = "easeparkhk.favorites";
const LANG_KEY = "easeparkhk.lang";
const THEME_KEY = "easeparkhk.dark";
const REGIONS = {
  hk: ["central & western", "wan chai", "eastern", "southern"],
  kln: ["yau tsim mong", "sham shui po", "kowloon city", "wong tai sin", "kwun tong"],
  nt: [
    "kwai tsing",
    "tsuen wan",
    "yuen long",
    "tuen mun",
    "north",
    "tai po",
    "sha tin",
    "sai kung",
    "islands",
  ],
};

const state = {
  lang: localStorage.getItem(LANG_KEY) || "zh",
  favorites: JSON.parse(localStorage.getItem(FAV_KEY) || "[]"),
  vacancy: null,
  carparks: null,
  quality: null,
  forecast: null,
  metrics: null,
  news: null,
  cameras: null,
  meters: null,
  liveAt: null,
  map: null,
};

function t(key) {
  return (I18N[state.lang] && I18N[state.lang][key]) || I18N.en[key] || key;
}

function applyChrome() {
  document.documentElement.lang = state.lang === "zh" ? "zh-Hant" : "en";
  document.querySelectorAll("[data-i18n]").forEach((node) => {
    node.textContent = t(node.dataset.i18n);
  });
  document.getElementById("lang-btn").textContent = state.lang === "zh" ? "EN" : "繁";
  if (localStorage.getItem(THEME_KEY) === "1") document.body.classList.add("dark");
}

function saveFav() {
  localStorage.setItem(FAV_KEY, JSON.stringify(state.favorites));
}

function toggleFav(id) {
  if (state.favorites.includes(id)) {
    state.favorites = state.favorites.filter((item) => item !== id);
  } else {
    state.favorites.push(id);
  }
  saveFav();
  render();
}

function districtKey(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/ district$/i, "")
    .trim();
}

function regionOf(meta) {
  const key = districtKey(meta.district_en || meta.district_tc);
  if (REGIONS.hk.some((item) => key.includes(item) || item.includes(key))) return "hk";
  if (REGIONS.kln.some((item) => key.includes(item) || item.includes(key))) return "kln";
  if (REGIONS.nt.some((item) => key.includes(item) || item.includes(key))) return "nt";
  return "";
}

function vehicleEntry(parkVacancy, vehicle) {
  return parkVacancy && parkVacancy[vehicle] ? parkVacancy[vehicle] : null;
}

function formatVacancy(entry) {
  if (!entry || entry.v === undefined || entry.v === null) return { text: "—", cls: "na" };
  if (entry.v === -1) return { text: "N/A", cls: "na" };
  if (entry.t === "B") {
    const labels = state.lang === "zh" ? ["滿", "將滿", "充足"] : ["Full", "Filling", "Plenty"];
    return { text: labels[entry.v] || String(entry.v), cls: entry.v === 0 ? "bad" : "warn" };
  }
  if (entry.t === "C") {
    const labels = state.lang === "zh" ? ["滿", "未滿"] : ["Full", "Not full"];
    return { text: labels[entry.v] || String(entry.v), cls: entry.v === 0 ? "bad" : "good" };
  }
  const n = Number(entry.v);
  if (Number.isNaN(n)) return { text: String(entry.v), cls: "na" };
  if (n <= 0) return { text: "0", cls: "bad" };
  return { text: String(n), cls: "good" };
}

function mergedParks() {
  const vacancyParks = (state.vacancy && state.vacancy.parks) || {};
  const metaParks = (state.carparks && state.carparks.parks) || {};
  const forecastParks = (state.forecast && state.forecast.parks) || {};
  const ids = new Set([...Object.keys(vacancyParks), ...Object.keys(metaParks)]);
  return [...ids].map((id) => {
    const meta = metaParks[id] || { park_id: id };
    return {
      id,
      meta,
      vacancy: vacancyParks[id] || {},
      forecast: forecastParks[id] || null,
      name: state.lang === "zh" ? meta.name_tc || meta.name_en : meta.name_en || meta.name_tc,
      address:
        state.lang === "zh"
          ? meta.displayAddress_tc || meta.displayAddress_en
          : meta.displayAddress_en || meta.displayAddress_tc,
      district: state.lang === "zh" ? meta.district_tc || meta.district_en : meta.district_en,
      status: (meta.opening_status || "").toUpperCase(),
      region: regionOf(meta),
    };
  });
}

function statusLabel(status) {
  if (status === "OPEN") return t("open");
  if (status === "CLOSED") return t("closed");
  return t("unknown");
}

async function loadJson(path) {
  const response = await fetch(path, { cache: "no-store" });
  if (!response.ok) throw new Error(path);
  return response.json();
}

async function tryLiveOverlay() {
  try {
    const payload = await fetch(LIVE_URL).then((response) => {
      if (!response.ok) throw new Error("live");
      return response.json();
    });
    const parks = {};
    for (const item of payload.results || []) {
      parks[item.park_Id] = {};
      for (const vehicle of ["privateCar", "motorCycle", "LGV", "HGV", "coach", "CV"]) {
        const row = Array.isArray(item[vehicle]) ? item[vehicle][0] : item[vehicle];
        if (row && row.vacancy !== undefined) {
          parks[item.park_Id][vehicle] = { v: row.vacancy, t: row.vacancy_type, u: row.lastupdate };
        }
      }
    }
    if (Object.keys(parks).length) {
      state.vacancy = {
        ...(state.vacancy || {}),
        parks,
        live: true,
      };
      state.liveAt = new Date().toISOString();
    }
  } catch (_error) {
    state.liveAt = null;
  }
}

function route() {
  const hash = location.hash.replace(/^#/, "") || "/";
  const [path, queryString] = hash.split("?");
  const query = new URLSearchParams(queryString || "");
  const parts = path.split("/").filter(Boolean);
  return { path: "/" + (parts[0] || ""), id: parts[1] || "", query };
}

function cardsHtml() {
  const q = state.quality || { vehicles: { privateCar: {} }, park_count: 0 };
  const pc = q.vehicles.privateCar || {};
  return `<div class="grid">
    <div class="card"><h3>${t("parks")}</h3><strong>${q.park_count || 0}</strong></div>
    <div class="card"><h3>${t("available")}</h3><strong>${pc.available_pct ?? "—"}%</strong></div>
    <div class="card"><h3>${t("missing")}</h3><strong>${pc.unavailable ?? "—"}</strong></div>
    <div class="card"><h3>${t("stale")}</h3><strong>${(pc.stale && pc.stale.over_30min) ?? "—"}</strong></div>
  </div>`;
}

function filterParks(parks, query) {
  const vehicle = query.get("vehicle") || "privateCar";
  const region = query.get("region") || "all";
  const status = query.get("status") || "all";
  const q = (query.get("q") || "").trim().toLowerCase();
  return parks.filter((park) => {
    if (region !== "all" && park.region !== region) return false;
    if (status === "OPEN" && park.status !== "OPEN") return false;
    if (status === "CLOSED" && park.status !== "CLOSED") return false;
    if (q && !`${park.name} ${park.address} ${park.id}`.toLowerCase().includes(q)) return false;
    park._entry = vehicleEntry(park.vacancy, vehicle);
    park._shown = formatVacancy(park._entry);
    return true;
  });
}

function setQuery(query) {
  const current = route();
  location.hash = `${current.path}?${query.toString()}`;
}

function parksView(query) {
  const parks = filterParks(mergedParks(), query);
  const favs = parks.filter((park) => state.favorites.includes(park.id));
  const rest = parks.filter((park) => !state.favorites.includes(park.id));
  const vehicle = query.get("vehicle") || "privateCar";
  const table = (rows, title) => {
    if (!rows.length) return "";
    return `<h2>${title}</h2>
      <table><thead><tr>
        <th>${t("name")}</th><th>${t("address")}</th><th>${t("status")}</th>
        <th>${t("vacancy")}</th><th>${t("forecast30")}</th><th></th>
      </tr></thead><tbody>
      ${rows
        .map((park) => {
          const yhat = park.forecast ? park.forecast.persistence : "—";
          return `<tr>
            <td><a href="#/park/${encodeURIComponent(park.id)}">${park.name || park.id}</a></td>
            <td>${park.address || "—"}</td>
            <td>${statusLabel(park.status)}</td>
            <td><span class="pill ${park._shown.cls}">${park._shown.text}</span></td>
            <td>${vehicle === "privateCar" ? yhat : "—"}</td>
            <td><button class="ghost fav" data-fav="${park.id}">${state.favorites.includes(park.id) ? "★" : "☆"}</button></td>
          </tr>`;
        })
        .join("")}
      </tbody></table>`;
  };
  return `${cardsHtml()}
    <div class="filters">
      <label>${t("search")}<input id="q" value="${query.get("q") || ""}"></label>
      <label>${t("vehicle")}<select id="vehicle">
        ${["privateCar", "motorCycle", "LGV", "HGV", "coach"]
          .map(
            (item) =>
              `<option value="${item}" ${item === vehicle ? "selected" : ""}>${t(item)}</option>`
          )
          .join("")}
      </select></label>
      <label>${t("region")}<select id="region">
        <option value="all">${t("all")}</option>
        <option value="hk" ${query.get("region") === "hk" ? "selected" : ""}>${t("hk")}</option>
        <option value="kln" ${query.get("region") === "kln" ? "selected" : ""}>${t("kln")}</option>
        <option value="nt" ${query.get("region") === "nt" ? "selected" : ""}>${t("nt")}</option>
      </select></label>
      <label>${t("status")}<select id="status">
        <option value="all">${t("all")}</option>
        <option value="OPEN" ${query.get("status") === "OPEN" ? "selected" : ""}>${t("open")}</option>
        <option value="CLOSED" ${query.get("status") === "CLOSED" ? "selected" : ""}>${t("closed")}</option>
      </select></label>
    </div>
    ${favs.length ? table(favs, t("favorite")) : ""}
    ${rest.length ? table(rest, t("parks")) : `<p class="empty">${t("no_rows")}</p>`}`;
}

function parkView(id) {
  const park = mergedParks().find((item) => item.id === id);
  if (!park) return `<p class="empty">Not found</p>`;
  const vehicles = ["privateCar", "motorCycle", "LGV", "HGV", "coach"];
  const rows = vehicles
    .map((vehicle) => {
      const shown = formatVacancy(vehicleEntry(park.vacancy, vehicle));
      const spaces = park.meta.spaces ? park.meta.spaces[vehicle] : "—";
      return `<tr><td>${t(vehicle)}</td><td><span class="pill ${shown.cls}">${shown.text}</span></td><td>${spaces ?? "—"}</td></tr>`;
    })
    .join("");
  const lat = park.meta.latitude;
  const lng = park.meta.longitude;
  return `<p><a href="#/">${t("back")}</a></p>
    <h1>${park.name || id}</h1>
    <p>${park.address || ""}</p>
    <p>${statusLabel(park.status)} · ${park.district || ""}</p>
    <p><button class="ghost fav" data-fav="${park.id}">${state.favorites.includes(park.id) ? "★" : "☆"} ${t("favorite")}</button></p>
    <table><thead><tr><th>${t("vehicle")}</th><th>${t("vacancy")}</th><th>${t("spaces")}</th></tr></thead><tbody>${rows}</tbody></table>
    ${park.forecast ? `<p class="muted">${t("forecast30")} (persistence): ${park.forecast.persistence} · trend: ${park.forecast.trend}</p>` : ""}
    <div id="map" class="card" style="margin-top:16px"></div>
    <script-placeholder data-lat="${lat || ""}" data-lng="${lng || ""}"></script-placeholder>`;
}

function mapView(query) {
  return `${cardsHtml()}<p class="legend muted">
      <span class="pill good">A &gt; 0</span>
      <span class="pill bad">0 / full</span>
      <span class="pill na">N/A / missing</span>
    </p><div id="map"></div>`;
}

function qualityView() {
  const m = state.metrics || {};
  const persistence = (m.persistence && m.persistence.mae) ?? "—";
  const trend = (m.trend && m.trend.mae) ?? "—";
  const n = (m.persistence && m.persistence.n) || 0;
  const districts = m.by_district_persistence_mae || {};
  const districtRows = Object.entries(districts)
    .map(([name, stats]) => `<tr><td>${name}</td><td>${stats.mae ?? "—"}</td><td>${stats.n || 0}</td></tr>`)
    .join("");
  return `<h1>${t("quality_title")}</h1>
    <p>${t("rq")}</p>
    <p class="muted">${t("type_note")}</p>
    <div class="grid">
      <div class="card"><h3>${t("persistence")}</h3><strong>${persistence}</strong></div>
      <div class="card"><h3>${t("trend")}</h3><strong>${trend}</strong></div>
      <div class="card"><h3>${t("pairs")}</h3><strong>${n}</strong></div>
    </div>
    ${n ? `<table><thead><tr><th>${t("region")}</th><th>MAE</th><th>n</th></tr></thead><tbody>${districtRows}</tbody></table>` : `<p class="empty">${t("need_history")}</p>`}
    <h2>${state.lang === "zh" ? "缺數據地圖" : "Missing-data map"}</h2>
    <div id="map"></div>`;
}

function metersView() {
  const regions = (state.meters && state.meters.regions) || {};
  const lang = state.lang === "zh" ? "zh" : "en";
  const blocks = Object.entries(regions)
    .map(([name, payload]) => {
      const rows = payload[lang] || payload.en || [];
      if (!rows.length) return "";
      const keys = Object.keys(rows[0]).slice(0, 8);
      return `<h2>${name.replaceAll("_", " ")}</h2>
        <table><thead><tr>${keys.map((key) => `<th>${key}</th>`).join("")}</tr></thead>
        <tbody>${rows
          .slice(0, 200)
          .map((row) => `<tr>${keys.map((key) => `<td>${row[key] ?? ""}</td>`).join("")}</tr>`)
          .join("")}</tbody></table>`;
    })
    .join("");
  return `<h1>${t("meters_title")}</h1>${blocks || `<p class="empty">No meter file yet.</p>`}`;
}

function camerasView() {
  const list = ((state.cameras && state.cameras.cameras) || {})[state.lang === "zh" ? "zh" : "en"] || [];
  if (!list.length) return `<h1>${t("cameras_title")}</h1><p class="empty">No camera file yet.</p>`;
  return `<h1>${t("cameras_title")}</h1><div class="list">${list
    .slice(0, 80)
    .map(
      (cam) => `<article class="camera">
        <strong>${cam.description || cam.key}</strong>
        <p class="muted">${cam.region} · ${cam.district}</p>
        ${cam.url ? `<img src="${cam.url}" alt="${cam.description || cam.key}" loading="lazy">` : ""}
      </article>`
    )
    .join("")}</div>`;
}

function newsView() {
  const notices = (state.news && state.news.notices) || [];
  if (!notices.length) return `<h1>${t("news_title")}</h1><p class="empty">No notices file yet.</p>`;
  return `<h1>${t("news_title")}</h1><div class="list">${notices
    .slice(0, 80)
    .map((item) => {
      const title = state.lang === "zh" ? item.title_tc || item.title_en : item.title_en || item.title_tc;
      const content = state.lang === "zh" ? item.content_tc || item.content_en : item.content_en || item.content_tc;
      return `<article class="notice"><h3>${title}</h3><p class="muted">${item.feed}</p><p>${content}</p></article>`;
    })
    .join("")}</div>`;
}

function aboutView() {
  if (state.lang === "zh") {
    return `<h1>${t("about_title")}</h1>
      <p>EaseParkHK 係香港停車場開放數據嘅收集、質素分析同短期空置預測，結果用 GitHub Pages 公開展示。</p>
      <p>${t("rq")}</p>
      <ul>
        <li>方法：每 15 分鐘采樣；<code>-1</code>／缺值／B／C 唔當空位數。</li>
        <li>Baseline：假設 30 分鐘後同而家一樣（persistence）。</li>
        <li>對照模型：用最近 15 分鐘變化外推 30 分鐘（trend），空位下限為 0。</li>
        <li>網站只係展示層。冇帳戶、冇電郵、冇 Gemini API key。</li>
        <li>收藏只存在呢部瀏覽器嘅 localStorage。</li>
      </ul>
      <p>數據來源：運輸署／data.gov.hk 停車場空置、咪錶車位、交通通告、交通鏡頭。開放數據條款仍然適用。預測唔等於保證有位。</p>`;
  }
  return `<h1>${t("about_title")}</h1>
    <p>EaseParkHK collects Hong Kong car park open data, analyses quality, and forecasts private-car vacancy 30 minutes ahead. GitHub Pages only displays the results.</p>
    <p>${t("rq")}</p>
    <ul>
      <li>Sampling every 15 minutes. <code>-1</code>, missing, B and C are not treated as counts.</li>
      <li>Baseline: persistence (assume unchanged).</li>
      <li>Comparison model: project the last 15-minute change over 30 minutes, floored at 0.</li>
      <li>No accounts, email, or Gemini keys. Favourites stay in localStorage on this device.</li>
    </ul>
    <p>Sources: Transport Department / data.gov.hk car park vacancy, metered parking, traffic notices, and cameras. A forecast is not a parking guarantee.</p>`;
}

function privacyView() {
  if (state.lang === "zh") {
    return `<h1>${t("privacy_title")}</h1>
      <p>本站係靜態 GitHub Pages，冇伺服器帳戶、冇登入、冇電郵。</p>
      <p>收藏同語言設定只寫入你部裝置嘅 localStorage，唔會上傳。清瀏覽器資料就會刪除。</p>
      <p>交通鏡頭圖片由政府來源載入。我哋唔收集身份證或其他個人資料。預測結果唔構成泊車保證，亦唔應用嚟處理個人資料決定。</p>
      <p>適用香港《個人資料（私隱）條例》。數據仍受香港政府開放數據條款約束。</p>`;
  }
  return `<h1>${t("privacy_title")}</h1>
    <p>This is a static GitHub Pages site. There is no account, login, or email.</p>
    <p>Favourites and language are stored in localStorage on this device only.</p>
    <p>Camera images load from government hosts. We do not collect identity documents. Forecasts are not parking guarantees and are not used to make decisions about individuals.</p>
    <p>The Hong Kong PDPO applies. Open data remains under the government licence.</p>`;
}

function bindFilters() {
  const q = document.getElementById("q");
  const vehicle = document.getElementById("vehicle");
  const region = document.getElementById("region");
  const status = document.getElementById("status");
  const apply = () => {
    const query = route().query;
    if (q) query.set("q", q.value);
    if (vehicle) query.set("vehicle", vehicle.value);
    if (region) query.set("region", region.value);
    if (status) query.set("status", status.value);
    setQuery(query);
  };
  [vehicle, region, status].forEach((node) => node && node.addEventListener("change", apply));
  if (q) q.addEventListener("keydown", (event) => event.key === "Enter" && apply());
}

function markerColor(entry) {
  const shown = formatVacancy(entry);
  if (shown.cls === "good") return "#1b7f4a";
  if (shown.cls === "bad") return "#b42318";
  if (shown.cls === "warn") return "#b54708";
  return "#6b7280";
}

function drawMap(mode) {
  const node = document.getElementById("map");
  if (!node || typeof L === "undefined") return;
  if (state.map) {
    state.map.remove();
    state.map = null;
  }
  state.map = L.map(node).setView([22.32, 114.17], 11);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "&copy; OpenStreetMap",
  }).addTo(state.map);
  const vehicle = route().query.get("vehicle") || "privateCar";
  mergedParks().forEach((park) => {
    const lat = Number(park.meta.latitude);
    const lng = Number(park.meta.longitude);
    if (!lat || !lng) return;
    const entry = vehicleEntry(park.vacancy, vehicle);
    if (mode === "missing" && entry && entry.v !== -1 && entry.v !== undefined) return;
    const color = mode === "missing" ? "#6b7280" : markerColor(entry);
    L.circleMarker([lat, lng], { radius: 6, color, fillColor: color, fillOpacity: 0.85 })
      .addTo(state.map)
      .bindPopup(
        `<a href="#/park/${encodeURIComponent(park.id)}">${park.name || park.id}</a><br>${formatVacancy(entry).text}`
      );
  });
  const detail = document.querySelector("script-placeholder");
  if (detail && detail.dataset.lat) {
    state.map.setView([Number(detail.dataset.lat), Number(detail.dataset.lng)], 16);
  }
}

function render() {
  applyChrome();
  const collected = (state.vacancy && state.vacancy.collected_at) || "—";
  const liveText = state.liveAt ? `${t("live")} ${state.liveAt}` : t("snapshot_only");
  document.getElementById("status-line").textContent = `${t("snapshot")} ${collected} · ${liveText}`;
  const { path, id, query } = route();
  const need = { "/news": "news", "/cameras": "cameras", "/meters": "meters" }[path];
  if (need && !state[need]) {
    document.getElementById("app").innerHTML = `<p class="empty">Loading…</p>`;
    ensureFeed(need).then(render);
    return;
  }
  const app = document.getElementById("app");
  if (path === "/map") app.innerHTML = mapView(query);
  else if (path === "/quality") app.innerHTML = qualityView();
  else if (path === "/park") app.innerHTML = parkView(decodeURIComponent(id));
  else if (path === "/meters") app.innerHTML = metersView();
  else if (path === "/cameras") app.innerHTML = camerasView();
  else if (path === "/news") app.innerHTML = newsView();
  else if (path === "/about") app.innerHTML = aboutView();
  else if (path === "/privacy") app.innerHTML = privacyView();
  else app.innerHTML = parksView(query);

  app.querySelectorAll("[data-fav]").forEach((btn) => {
    btn.addEventListener("click", () => toggleFav(btn.dataset.fav));
  });
  bindFilters();
  if (document.getElementById("map")) {
    requestAnimationFrame(() => drawMap(path === "/quality" ? "missing" : "vacancy"));
  }
}

async function ensureFeed(name) {
  if (state[name]) return;
  try {
    state[name] = await loadJson("data/" + name + ".json");
  } catch (_error) {
    state[name] = { empty: true };
  }
}

async function boot() {
  applyChrome();
  try {
    const [vacancy, carparks, quality] = await Promise.all([
      loadJson("data/vacancy.json"),
      loadJson("data/carparks.json"),
      loadJson("data/quality.json"),
    ]);
    state.vacancy = vacancy;
    state.carparks = carparks;
    state.quality = quality;
  } catch (error) {
    document.getElementById("app").innerHTML =
      `<p class="empty">Missing docs/data JSON. Run <code>python scripts/run_pipeline.py</code> first.</p>`;
    return;
  }
  try {
    state.forecast = await loadJson("data/forecast.json");
    state.metrics = await loadJson("data/metrics.json");
  } catch (_error) {
    /* forecast appears after Actions has history */
  }
  await tryLiveOverlay();
  render();
}

document.getElementById("lang-btn").addEventListener("click", () => {
  state.lang = state.lang === "zh" ? "en" : "zh";
  localStorage.setItem(LANG_KEY, state.lang);
  render();
});
document.getElementById("theme-btn").addEventListener("click", () => {
  document.body.classList.toggle("dark");
  localStorage.setItem(THEME_KEY, document.body.classList.contains("dark") ? "1" : "0");
});
window.addEventListener("hashchange", render);
boot();
