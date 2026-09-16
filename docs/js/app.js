const LIVE_URL =
  "https://api.data.gov.hk/v1/carpark-info-vacancy?data=vacancy&vehicleTypes=privateCar,motorCycle,LGV,HGV,coach&lang=en_US";
const FAV_KEY = "easeparkhk.favorites";
const LANG_KEY = "easeparkhk.lang";
const THEME_KEY = "easeparkhk.dark";
const PAGE_SIZE = 24;
const VEHICLES = ["privateCar", "motorCycle", "LGV", "HGV", "coach"];
const REGIONS = {
  hk: ["central & western", "wan chai", "eastern", "southern", "中西區", "灣仔", "東區", "南區", "中西", "湾仔"],
  kln: ["yau tsim mong", "sham shui po", "kowloon city", "wong tai sin", "kwun tong", "油尖旺", "深水埗", "九龍城", "黃大仙", "觀塘", "九龙城", "黄大仙", "观塘"],
  nt: ["kwai tsing", "tsuen wan", "yuen long", "tuen mun", "north", "tai po", "sha tin", "sai kung", "islands", "葵青", "荃灣", "元朗", "屯門", "北區", "大埔", "沙田", "西貢", "離島", "荃湾", "屯门", "北区", "西贡", "离岛"],
};
const METER_LABELS = { hong_kong_island: "hki", kowloon: "kowloon", new_territories: "new_territories" };
const FEED_KEYS = {
  "Temporary Road Closure": "feed_closure",
  Expressways: "feed_express",
  "Prohibited Zone": "feed_prohibited",
  "Special Traffic and Transport Arrangement": "feed_special",
  "Other Notices": "feed_other",
  "Temporary Speed Limits": "feed_speed",
  Clearways: "feed_clearways",
  "Public Transports": "feed_transit",
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
  here: null,
  toastTimer: null,
  searchTimer: null,
  focus: null,
  listHash: "#/",
};

function t(key, vars) {
  let text = (I18N[state.lang] && I18N[state.lang][key]) || I18N.en[key] || key;
  if (vars) {
    Object.entries(vars).forEach(([name, value]) => {
      text = text.replaceAll("{" + name + "}", String(value));
    });
  }
  return text;
}

function applyChrome() {
  document.documentElement.lang = state.lang === "zh" ? "zh-Hant" : "en";
  document.title = state.lang === "zh" ? "泊易香港 EaseParkHK" : "EaseParkHK";
  document.querySelectorAll("[data-i18n]").forEach((node) => {
    node.textContent = t(node.dataset.i18n);
  });
  if (localStorage.getItem(THEME_KEY) === "1") document.body.classList.add("dark");
  else document.body.classList.remove("dark");
  document.getElementById("lang-btn").textContent = state.lang === "zh" ? "EN" : "繁";
  document.getElementById("theme-btn").textContent = document.body.classList.contains("dark")
    ? t("theme_light")
    : t("theme");
  const navMap = {
    "/": "nav_parks",
    "/map": "nav_map",
    "/meters": "nav_meters",
    "/cameras": "nav_cameras",
    "/news": "nav_news",
    "/quality": "nav_quality",
  };
  document.querySelectorAll("#site-nav a").forEach((link) => {
    const key = navMap[link.dataset.nav];
    if (key) link.textContent = t(key);
  });
}

function toast(message) {
  document.querySelector(".toast")?.remove();
  const el = document.createElement("div");
  el.className = "toast";
  el.textContent = message;
  document.body.appendChild(el);
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => el.remove(), 2200);
}

function saveFav() {
  localStorage.setItem(FAV_KEY, JSON.stringify(state.favorites));
}

function toggleFav(id) {
  const y = window.scrollY;
  const adding = !state.favorites.includes(id);
  state.favorites = adding ? [...state.favorites, id] : state.favorites.filter((item) => item !== id);
  saveFav();
  render();
  window.scrollTo(0, y);
  toast(adding ? t("saved") : t("removed"));
}

function districtKey(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/ district$/i, "")
    .replace(/區$/g, "")
    .trim();
}

function displayDistrict(name) {
  if (!name) return "";
  if (state.lang === "zh") {
    const base = String(name).replace(/區$/g, "").trim();
    return base ? base + "區" : name;
  }
  return String(name).replace(/\s*District$/i, "").trim();
}

function statusFromQuery(query) {
  return query.get("status") || "OPEN";
}

function feedLabel(name) {
  const key = FEED_KEYS[name];
  return key ? t(key) : name;
}

function stripHtml(html) {
  const node = document.createElement("div");
  node.innerHTML = html || "";
  return (node.textContent || "").replace(/\s+/g, " ").trim();
}

function meterHeader(key) {
  const map = {
    District: t("district"),
    Location: t("meter_location"),
    "Types of Operating Hours": t("meter_hours"),
    "For Vehicles Other Than Medium and Heavy Goods Vehicles, Buses, Motor Cycles and Pedal Cycles": t("meter_private"),
    "For Goods Vehicles": t("meter_goods"),
    "For Coaches": t("meter_coach"),
    "地區": t("district"),
    "地點": t("meter_location"),
    "收費時間類別": t("meter_hours"),
    "供中型及重型貨車、巴士、電單車及單車以外車輛停泊": t("meter_private"),
    "供貨車停泊": t("meter_goods"),
    "供巴士停泊": t("meter_coach"),
  };
  return map[key] || key;
}

function regionOf(meta) {
  const key = districtKey(meta.district_en || "") + " " + districtKey(meta.district_tc || "");
  if (REGIONS.hk.some((item) => key.includes(item))) return "hk";
  if (REGIONS.kln.some((item) => key.includes(item))) return "kln";
  if (REGIONS.nt.some((item) => key.includes(item))) return "nt";
  return "";
}

function vehicleEntry(parkVacancy, vehicle) {
  return parkVacancy && parkVacancy[vehicle] ? parkVacancy[vehicle] : null;
}

function formatVacancy(entry) {
  if (!entry || entry.v === undefined || entry.v === null) return { text: t("na"), cls: "na", rank: -2, n: null };
  if (entry.v === -1) return { text: t("na"), cls: "na", rank: -1, n: null };
  if (entry.t === "B") {
    const labels = [t("full"), t("filling"), t("plenty")];
    return { text: labels[entry.v] || String(entry.v), cls: entry.v === 0 ? "bad" : entry.v === 1 ? "warn" : "good", rank: entry.v, n: null };
  }
  if (entry.t === "C") {
    return { text: entry.v === 0 ? t("full") : t("not_full"), cls: entry.v === 0 ? "bad" : "good", rank: entry.v, n: null };
  }
  const n = Number(entry.v);
  if (Number.isNaN(n)) return { text: String(entry.v), cls: "na", rank: -2, n: null };
  if (n <= 0) return { text: "0", cls: "bad", rank: 0, n: 0 };
  return { text: String(n), cls: "good", rank: n, n };
}

function occupancyText(park, vehicle) {
  const shown = formatVacancy(vehicleEntry(park.vacancy, vehicle));
  const total = park.meta.spaces ? park.meta.spaces[vehicle] : null;
  if (shown.n === null || !total || total <= 0) return "";
  return t("occupancy", { free: shown.n, total });
}

function haversine(a, b) {
  const toRad = (x) => (x * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
}

function mergedParks() {
  const vacancyParks = (state.vacancy && state.vacancy.parks) || {};
  const metaParks = (state.carparks && state.carparks.parks) || {};
  const forecastParks = (state.forecast && state.forecast.parks) || {};
  const ids = new Set([...Object.keys(vacancyParks), ...Object.keys(metaParks)]);
  return [...ids].map((id) => {
    const meta = metaParks[id] || { park_id: id };
    const lat = Number(meta.latitude);
    const lng = Number(meta.longitude);
    const dist = state.here && lat && lng ? haversine(state.here, { lat, lng }) : null;
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
      district: displayDistrict(
        state.lang === "zh" ? meta.district_tc || meta.district_en : meta.district_en || meta.district_tc
      ),
      status: (meta.opening_status || "").toUpperCase(),
      region: regionOf(meta),
      lat: lat || null,
      lng: lng || null,
      dist,
    };
  });
}

function statusLabel(status) {
  if (status === "OPEN") return t("open");
  if (status === "CLOSED") return t("closed");
  return t("unknown");
}

function formatWhen(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value).replace("T", " ").slice(0, 16);
  const locale = state.lang === "zh" ? "zh-HK" : "en-HK";
  const clock = date.toLocaleString(locale, {
    timeZone: "Asia/Hong_Kong",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
  const mins = Math.max(0, Math.round((Date.now() - date.getTime()) / 60000));
  if (mins < 120) return `${clock} · ${t("ago_min", { n: mins })}`;
  return clock;
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
      for (const vehicle of [...VEHICLES, "CV"]) {
        const row = Array.isArray(item[vehicle]) ? item[vehicle][0] : item[vehicle];
        if (row && row.vacancy !== undefined) {
          parks[item.park_Id][vehicle] = { v: row.vacancy, t: row.vacancy_type, u: row.lastupdate };
        }
      }
    }
    if (Object.keys(parks).length) {
      state.vacancy = { ...(state.vacancy || {}), parks, live: true };
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

function setQuery(query) {
  const current = route();
  const qs = query.toString();
  location.hash = qs ? `${current.path}?${qs}` : current.path;
}

function filterParks(parks, query) {
  const vehicle = query.get("vehicle") || "privateCar";
  const region = query.get("region") || "all";
  const district = query.get("district") || "all";
  const status = statusFromQuery(query);
  const q = (query.get("q") || "").trim().toLowerCase();
  const hideNa = query.get("na") !== "1";
  return parks.filter((park) => {
    if (region !== "all" && park.region !== region) return false;
    if (district !== "all" && districtKey(park.district) !== districtKey(district)) return false;
    if (status !== "all" && park.status !== status) return false;
    if (q && !`${park.name} ${park.address} ${park.district} ${park.id}`.toLowerCase().includes(q)) return false;
    park._entry = vehicleEntry(park.vacancy, vehicle);
    park._shown = formatVacancy(park._entry);
    if (hideNa && park._shown.cls === "na") return false;
    return true;
  });
}

function sortParks(parks, query) {
  const sort = query.get("sort") || (state.here ? "near" : "vacancy");
  const copy = [...parks];
  copy.sort((a, b) => {
    if (sort === "name") return String(a.name || "").localeCompare(String(b.name || ""), "zh-Hant");
    if (sort === "near") return (a.dist ?? 9999) - (b.dist ?? 9999);
    return (b._shown.rank || 0) - (a._shown.rank || 0);
  });
  const favs = copy.filter((park) => state.favorites.includes(park.id));
  const rest = copy.filter((park) => !state.favorites.includes(park.id));
  return { favs, rest, all: [...favs, ...rest], sort };
}

function districtOptions(parks) {
  const byKey = new Map();
  parks.forEach((park) => {
    if (!park.district) return;
    const key = districtKey(park.district);
    if (!key || byKey.has(key)) return;
    byKey.set(key, displayDistrict(park.district));
  });
  return [...byKey.entries()]
    .sort((a, b) => a[1].localeCompare(b[1], "zh-Hant"))
    .map(([key, name]) => ({ key, name }));
}

function filterBar(query, parksForDistricts) {
  const vehicle = query.get("vehicle") || "privateCar";
  const districts = districtOptions(
    mergedParks().filter((park) => {
      const region = query.get("region") || "all";
      return region === "all" || park.region === region;
    })
  );
  return `<div class="filters">
    <label>${t("search")}<input id="q" type="search" placeholder="${t("search_ph")}" value="${query.get("q") || ""}"></label>
    <label>${t("vehicle")}<select id="vehicle">${VEHICLES.map(
      (item) => `<option value="${item}" ${item === vehicle ? "selected" : ""}>${t(item)}</option>`
    ).join("")}</select></label>
    <label>${t("region")}<select id="region">
      <option value="all">${t("all")}</option>
      <option value="hk" ${query.get("region") === "hk" ? "selected" : ""}>${t("hk")}</option>
      <option value="kln" ${query.get("region") === "kln" ? "selected" : ""}>${t("kln")}</option>
      <option value="nt" ${query.get("region") === "nt" ? "selected" : ""}>${t("nt")}</option>
    </select></label>
    <label>${t("district")}<select id="district">
      <option value="all">${t("all")}</option>
      ${districts
        .map(
          ({ key, name }) =>
            `<option value="${key}" ${districtKey(query.get("district") || "") === key ? "selected" : ""}>${name}</option>`
        )
        .join("")}
    </select></label>
    <label>${t("status")}<select id="status">
      <option value="all" ${statusFromQuery(query) === "all" ? "selected" : ""}>${t("all")}</option>
      <option value="OPEN" ${statusFromQuery(query) === "OPEN" ? "selected" : ""}>${t("open")}</option>
      <option value="CLOSED" ${statusFromQuery(query) === "CLOSED" ? "selected" : ""}>${t("closed")}</option>
    </select></label>
    <button type="button" class="ghost" id="near-btn">${t("nearby")}</button>
  </div>`;
}

function parkCard(park, vehicle) {
  const shown = park._shown;
  const occ = occupancyText(park, vehicle);
  const yhat = park.forecast && vehicle === "privateCar" ? park.forecast.persistence : null;
  const dist = park.dist != null ? t("km", { n: park.dist.toFixed(1) }) : "";
  const saved = state.favorites.includes(park.id);
  const closed = park.status === "CLOSED";
  return `<article class="park-card ${closed ? "is-closed" : ""}" data-park="${park.id}">
    <div class="vacancy-box ${shown.cls}"><strong>${shown.text}</strong><span>${t("vacancy")}</span></div>
    <div>
      <h2><a href="#/park/${encodeURIComponent(park.id)}">${park.name || park.id}</a></h2>
      <p class="sub">${[park.district, dist].filter(Boolean).join(" · ")}
        <span class="pill ${closed ? "bad" : park.status === "OPEN" ? "good" : "na"}">${statusLabel(park.status)}</span>
      </p>
      ${occ ? `<p class="sub">${occ}</p>` : ""}
      ${yhat != null && !closed ? `<p class="forecast">${t("forecast30")}: ${yhat}</p>` : ""}
    </div>
    <button class="icon-btn ${saved ? "on" : ""}" data-fav="${park.id}" title="${saved ? t("unfavorite") : t("favorite")}" aria-label="${saved ? t("unfavorite") : t("favorite")}">${saved ? "★" : "☆"}</button>
  </article>`;
}

function pager(total, page) {
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  if (pages <= 1) return "";
  return `<div class="pager">
    <button class="ghost" id="prev-page" ${page <= 1 ? "disabled" : ""}>${t("prev")}</button>
    <span>${t("page", { n: `${page} / ${pages}` })}</span>
    <button class="ghost" id="next-page" ${page >= pages ? "disabled" : ""}>${t("next")}</button>
  </div>`;
}

function findView(query, forceMap) {
  const vehicle = query.get("vehicle") || "privateCar";
  const view = forceMap || query.get("view") === "map" ? "map" : "list";
  const page = Math.max(1, Number(query.get("page") || 1));
  const filtered = filterParks(mergedParks(), query);
  const { favs, rest, all, sort } = sortParks(filtered, query);
  const start = (page - 1) * PAGE_SIZE;
  const slice = rest.slice(start, start + PAGE_SIZE);
  return `<section class="hero">
      <h1>${t("hero")}</h1>
      <p>${t("hero_sub")}</p>
    </section>
    ${filterBar(query)}
    <div class="toolbar">
      <div class="seg">
        <button type="button" data-view="list" class="${view === "list" ? "active" : ""}">${t("list")}</button>
        <button type="button" data-view="map" class="${view === "map" ? "active" : ""}">${t("map")}</button>
      </div>
      <label class="field">${t("sort")}
        <select id="sort">
          <option value="vacancy" ${sort === "vacancy" ? "selected" : ""}>${t("sort_vacancy")}</option>
          <option value="name" ${sort === "name" ? "selected" : ""}>${t("sort_name")}</option>
          <option value="near" ${sort === "near" ? "selected" : ""}>${t("sort_near")}</option>
        </select>
      </label>
      <button type="button" class="ghost" id="na-btn">${query.get("na") === "1" ? t("hide_na") : t("show_na")}</button>
    </div>
    <p class="meta-row">${t("results", { n: all.length })} · ${t("forecast_hint")} · <a href="#/quality">${t("research_link")}</a></p>
    ${
      view === "map"
        ? `<p class="legend"><span class="pill good">${t("legend_free")}</span><span class="pill bad">${t("legend_full")}</span><span class="pill na">${t("legend_na")}</span></p><div id="map"></div>`
        : `${favs.length ? `<h2>${t("unfavorite")}</h2><div class="cards">${favs.map((park) => parkCard(park, vehicle)).join("")}</div>` : ""}
           ${slice.length ? `<div class="cards">${slice.map((park) => parkCard(park, vehicle)).join("")}</div>` : `<p class="empty">${t("no_rows")}</p>`}
           ${pager(rest.length, page)}`
    }`;
}

function parkView(id) {
  const vehicle = route().query.get("vehicle") || "privateCar";
  const park = mergedParks().find((item) => item.id === id);
  if (!park) return `<p class="empty">${t("park_not_found")}</p><p><a href="${state.listHash || "#/"}">${t("back")}</a></p>`;
  park._shown = formatVacancy(vehicleEntry(park.vacancy, vehicle));
  const rows = VEHICLES.map((item) => {
    const shown = formatVacancy(vehicleEntry(park.vacancy, item));
    const spaces = park.meta.spaces ? park.meta.spaces[item] : "—";
    return `<tr><td>${t(item)}</td><td><span class="pill ${shown.cls}">${shown.text}</span></td><td>${spaces ?? "—"}</td></tr>`;
  }).join("");
  const saved = state.favorites.includes(park.id);
  const maps =
    park.lat && park.lng
      ? `https://www.google.com/maps/dir/?api=1&destination=${park.lat},${park.lng}`
      : "";
  return `<p><a href="${state.listHash || "#/"}">${t("back")}</a></p>
    <div class="detail-head">
      <div>
        <h1>${park.name || id}</h1>
        <p class="sub">${park.address || ""}</p>
        <p class="sub">${[statusLabel(park.status), park.district, park.dist != null ? t("km", { n: park.dist.toFixed(1) }) : ""]
          .filter(Boolean)
          .join(" · ")}</p>
      </div>
      <div class="vacancy-box ${park._shown.cls}"><strong>${park._shown.text}</strong><span>${t(vehicle)}</span></div>
    </div>
    <div class="actions">
      <button class="ghost" data-fav="${park.id}">${saved ? "★ " + t("unfavorite") : "☆ " + t("favorite")}</button>
      ${maps ? `<a class="primary" style="display:inline-block;padding:8px 12px;border-radius:10px;background:var(--accent);color:#fff" href="${maps}" target="_blank" rel="noopener">${t("directions")}</a>` : ""}
    </div>
    ${park.forecast ? `<p class="forecast">${t("forecast30")}: ${park.forecast.persistence} · ${t("forecast_hint")}</p>` : ""}
    <div class="table-wrap"><table><thead><tr><th>${t("vehicle")}</th><th>${t("vacancy")}</th><th>${t("spaces")}</th></tr></thead><tbody>${rows}</tbody></table></div>
    <div id="map" style="margin-top:16px"></div>`;
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
    <p class="sub">${t("type_note")}</p>
    <div class="grid">
      <div class="stat"><h3>${t("persistence")}</h3><strong>${persistence}</strong></div>
      <div class="stat"><h3>${t("trend")}</h3><strong>${trend}</strong></div>
      <div class="stat"><h3>${t("pairs")}</h3><strong>${n}</strong></div>
    </div>
    ${n ? `<div class="table-wrap"><table><thead><tr><th>${t("district")}</th><th>MAE</th><th>n</th></tr></thead><tbody>${districtRows}</tbody></table></div>` : `<p class="empty">${t("need_history")}</p>`}
    <h2>${t("missing_map")}</h2>
    <p class="legend"><span class="pill na">${t("legend_na")}</span></p>
    <div id="map"></div>`;
}

function metersView(query) {
  const regions = (state.meters && state.meters.regions) || {};
  const lang = state.lang === "zh" ? "zh" : "en";
  const q = (query.get("mq") || "").toLowerCase();
  const blocks = Object.entries(regions)
    .map(([name, payload]) => {
      let rows = payload[lang] || payload.en || [];
      if (q) {
        rows = rows.filter((row) => JSON.stringify(row).toLowerCase().includes(q));
      }
      if (!rows.length) return "";
      const keys = Object.keys(rows[0]).filter((key) => !key.startsWith("col_") && key);
      if (!keys.length) return "";
      return `<h2>${t(METER_LABELS[name] || name)}</h2>
        <div class="table-wrap"><table><thead><tr>${keys.map((key) => `<th>${meterHeader(key)}</th>`).join("")}</tr></thead>
        <tbody>${rows
          .slice(0, 80)
          .map((row) => `<tr>${keys.map((key) => `<td>${row[key] ?? ""}</td>`).join("")}</tr>`)
          .join("")}</tbody></table></div>`;
    })
    .join("");
  return `<h1>${t("meters_title")}</h1>
    <p class="sub">${t("meter_hours_note")}</p>
    <div class="filters" style="grid-template-columns:1fr">
      <label>${t("search")}<input id="mq" type="search" value="${query.get("mq") || ""}" placeholder="${t("search_ph")}"></label>
    </div>
    ${blocks || `<p class="empty">${t("no_rows")}</p>`}`;
}

function camerasView(query) {
  const list = ((state.cameras && state.cameras.cameras) || {})[state.lang === "zh" ? "zh" : "en"] || [];
  const q = (query.get("cq") || "").toLowerCase();
  const region = query.get("cregion") || "all";
  const filtered = list.filter((cam) => {
    if (region !== "all" && cam.region !== region) return false;
    if (q && !`${cam.description} ${cam.district} ${cam.region}`.toLowerCase().includes(q)) return false;
    return true;
  });
  const regions = [...new Set(list.map((cam) => cam.region).filter(Boolean))];
  const more = Number(query.get("cmore") || 24);
  return `<h1>${t("cameras_title")}</h1>
    <div class="filters">
      <label>${t("search")}<input id="cq" type="search" value="${query.get("cq") || ""}"></label>
      <label>${t("region")}<select id="cregion">
        <option value="all">${t("all")}</option>
        ${regions.map((name) => `<option value="${name}" ${region === name ? "selected" : ""}>${name}</option>`).join("")}
      </select></label>
    </div>
    <p class="meta-row">${t("results_items", { n: filtered.length })}</p>
    <div class="camera-grid">${filtered
      .slice(0, more)
      .map(
        (cam) => `<article class="camera">
          <strong>${cam.description || cam.key}</strong>
          <p class="sub">${cam.region} · ${cam.district}</p>
          ${cam.url ? `<img src="${cam.url}" alt="" loading="lazy">` : ""}
        </article>`
      )
      .join("")}</div>
    ${filtered.length > more ? `<p class="pager"><button class="ghost" id="more-cam">${t("more")}</button></p>` : ""}`;
}

function newsView(query) {
  const notices = (state.news && state.news.notices) || [];
  const q = (query.get("nq") || "").toLowerCase();
  const feed = query.get("feed") || "all";
  const filtered = notices.filter((item) => {
    const title = state.lang === "zh" ? item.title_tc || item.title_en : item.title_en || item.title_tc;
    const content = state.lang === "zh" ? item.content_tc || item.content_en : item.content_en || item.content_tc;
    if (feed !== "all" && item.feed !== feed) return false;
    if (q && !`${title} ${content}`.toLowerCase().includes(q)) return false;
    return true;
  });
  const feeds = [...new Set(notices.map((item) => item.feed))];
  const more = Number(query.get("nmore") || 20);
  return `<h1>${t("news_title")}</h1>
    <div class="filters">
      <label>${t("search")}<input id="nq" type="search" value="${query.get("nq") || ""}"></label>
      <label>${t("feed")}<select id="feed">
        <option value="all">${t("all")}</option>
        ${feeds.map((name) => `<option value="${name}" ${feed === name ? "selected" : ""}>${feedLabel(name)}</option>`).join("")}
      </select></label>
    </div>
    <p class="meta-row">${t("results_items", { n: filtered.length })}</p>
    <div class="list">${filtered
      .slice(0, more)
      .map((item) => {
        const title = state.lang === "zh" ? item.title_tc || item.title_en : item.title_en || item.title_tc;
        const snippet = stripHtml(state.lang === "zh" ? item.content_tc || item.content_en : item.content_en || item.content_tc);
        return `<details class="notice"><summary><strong>${title || ""}</strong><p class="sub">${feedLabel(item.feed)}${snippet ? " · " + snippet.slice(0, 90) : ""}</p></summary><p>${snippet}</p></details>`;
      })
      .join("")}</div>
    ${filtered.length > more ? `<p class="pager"><button class="ghost" id="more-news">${t("more")}</button></p>` : ""}`;
}

function aboutView() {
  if (state.lang === "zh") {
    return `<h1>${t("about_title")}</h1>
      <p>EaseParkHK 用 GitHub Pages 公開香港停車場開放數據：而家空位、數據缺漏，同 30 分鐘私家車空位預測。</p>
      <p>${t("rq")}</p>
      <ul>
        <li>每 15 分鐘采集一次。數字先當空位；<code>-1</code>、缺值、「滿／將滿」唔當數量。</li>
        <li>對照：假設 30 分鐘後都唔變。</li>
        <li>另一個估計：用最近 15 分鐘變化外推，空位唔會低過 0。</li>
        <li>冇帳戶、冇電郵、冇 AI key。收藏只喺呢部裝置。</li>
      </ul>
      <p>${t("disclaimer_short")} 數據來源：運輸署／data.gov.hk。</p>`;
  }
  return `<h1>${t("about_title")}</h1>
    <p>EaseParkHK publishes Hong Kong car park open data on GitHub Pages: current vacancy, missing data, and a 30-minute private-car forecast.</p>
    <p>${t("rq")}</p>
    <ul>
      <li>Snapshots every 15 minutes. Only numeric counts are treated as spaces.</li>
      <li>Baseline: assume vacancy stays the same.</li>
      <li>Comparison: project the last 15-minute change, floored at 0.</li>
      <li>No accounts or API keys. Favourites stay on this device.</li>
    </ul>
    <p>${t("disclaimer_short")}</p>`;
}

function privacyView() {
  if (state.lang === "zh") {
    return `<h1>${t("privacy_title")}</h1>
      <p>靜態網站，冇登入、冇電郵。收藏、語言、夜間模式只寫入你部裝置嘅 localStorage。</p>
      <p>撳「附近」先會向瀏覽器要定位，用完嚟排序，唔會上傳。鏡頭圖片由政府網站載入。</p>
      <p>預測唔用來決定任何人嘅權利。適用《個人資料（私隱）條例》同政府開放數據條款。</p>`;
  }
  return `<h1>${t("privacy_title")}</h1>
    <p>Static site. No login. Favourites and language stay in localStorage on this device.</p>
    <p>Location is requested only if you tap Near me, and is not uploaded. Camera images load from government hosts.</p>
    <p>Forecasts are not used to decide anyone’s rights. PDPO and the government open data licence apply.</p>`;
}

function bindSearch(id, key) {
  const input = document.getElementById(id);
  if (!input) return;
  input.addEventListener("input", () => {
    clearTimeout(state.searchTimer);
    state.searchTimer = setTimeout(() => {
      state.focus = { id, start: input.selectionStart, end: input.selectionEnd };
      const query = route().query;
      query.set(key, input.value);
      query.delete("page");
      setQuery(query);
    }, 220);
  });
}

function bindFilters() {
  const applySelects = (ids) => {
    ids.forEach((id) => {
      const node = document.getElementById(id);
      if (!node) return;
      node.addEventListener("change", () => {
        if (id === "sort" && node.value === "near" && !state.here) {
          locateMe();
          return;
        }
        const query = route().query;
        query.set(id, node.value);
        if (id === "region") query.delete("district");
        query.delete("page");
        setQuery(query);
      });
    });
  };
  bindSearch("q", "q");
  bindSearch("mq", "mq");
  bindSearch("cq", "cq");
  bindSearch("nq", "nq");
  applySelects(["vehicle", "region", "district", "status", "sort", "cregion", "feed"]);
  document.getElementById("na-btn")?.addEventListener("click", () => {
    const query = route().query;
    if (query.get("na") === "1") query.delete("na");
    else query.set("na", "1");
    query.delete("page");
    setQuery(query);
  });
  document.getElementById("prev-page")?.addEventListener("click", () => {
    const query = route().query;
    query.set("page", String(Math.max(1, Number(query.get("page") || 1) - 1)));
    state.scrollToFilters = true;
    setQuery(query);
  });
  document.getElementById("next-page")?.addEventListener("click", () => {
    const query = route().query;
    query.set("page", String(Number(query.get("page") || 1) + 1));
    state.scrollToFilters = true;
    setQuery(query);
  });
  document.getElementById("more-cam")?.addEventListener("click", () => {
    const query = route().query;
    query.set("cmore", String(Number(query.get("cmore") || 24) + 24));
    setQuery(query);
  });
  document.getElementById("more-news")?.addEventListener("click", () => {
    const query = route().query;
    query.set("nmore", String(Number(query.get("nmore") || 20) + 20));
    setQuery(query);
  });
  document.querySelectorAll("[data-view]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const query = route().query;
      if (btn.dataset.view === "map") query.set("view", "map");
      else query.delete("view");
      if (route().path === "/map") {
        location.hash = "#/" + (query.toString() ? "?" + query.toString() : "");
        return;
      }
      setQuery(query);
    });
  });
  document.getElementById("near-btn")?.addEventListener("click", locateMe);
}

function locateMe() {
  if (!navigator.geolocation) {
    toast(t("nearby_fail"));
    return;
  }
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      state.here = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      const query = route().query;
      query.set("sort", "near");
      query.delete("page");
      setQuery(query);
    },
    () => toast(t("nearby_fail")),
    { enableHighAccuracy: true, timeout: 8000 }
  );
}

function markerColor(entry) {
  const shown = formatVacancy(entry);
  if (shown.cls === "good") return "#0f7a45";
  if (shown.cls === "bad") return "#b42318";
  if (shown.cls === "warn") return "#9a4d00";
  return "#667085";
}

function drawMap(mode, parks) {
  const node = document.getElementById("map");
  if (!node || typeof L === "undefined") return;
  if (state.map) {
    state.map.remove();
    state.map = null;
  }
  const center = state.here || { lat: 22.32, lng: 114.17 };
  state.map = L.map(node).setView([center.lat, center.lng], state.here ? 14 : 11);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "&copy; OpenStreetMap",
  }).addTo(state.map);
  const vehicle = route().query.get("vehicle") || "privateCar";
  const group =
    typeof L.markerClusterGroup === "function" ? L.markerClusterGroup({ showCoverageOnHover: false }) : L.layerGroup();
  const list = parks || filterParks(mergedParks(), route().query);
  list.forEach((park) => {
    if (!park.lat || !park.lng) return;
    const entry = vehicleEntry(park.vacancy, vehicle);
    if (mode === "missing" && formatVacancy(entry).cls !== "na") return;
    const color = mode === "missing" ? "#667085" : markerColor(entry);
    const marker = L.circleMarker([park.lat, park.lng], {
      radius: 7,
      color,
      fillColor: color,
      fillOpacity: 0.9,
      weight: 1,
    }).bindPopup(
      `<strong><a href="#/park/${encodeURIComponent(park.id)}">${park.name || park.id}</a></strong><br>${formatVacancy(entry).text}`
    );
    group.addLayer(marker);
  });
  state.map.addLayer(group);
  if (route().path === "/park") {
    const park = mergedParks().find((item) => item.id === route().id);
    if (park && park.lat) state.map.setView([park.lat, park.lng], 16);
  }
}

function updateStatus() {
  const collected = state.vacancy && state.vacancy.collected_at;
  const source = state.liveAt ? t("live_ok") : t("snapshot_only");
  document.getElementById("status-line").textContent = `${t("updated")} ${formatWhen(
    state.liveAt || collected
  )} · ${source} · ${t("disclaimer_short")}`;
}

function setActiveNav(path) {
  document.querySelectorAll("#site-nav a").forEach((link) => {
    const nav = link.dataset.nav;
    const onHome = path === "/" || path === "/park" || path === "/map";
    link.classList.toggle("active", nav === path || (nav === "/" && onHome && path !== "/map" && path !== "/quality"));
    if (path === "/map" && nav === "/map") link.classList.add("active");
    if (path === "/map" && nav === "/") link.classList.remove("active");
  });
}

function render() {
  applyChrome();
  updateStatus();
  const { path, id, query } = route();
  setActiveNav(path);
  const restore = state.focus;
  state.focus = null;
  const need = { "/news": "news", "/cameras": "cameras", "/meters": "meters" }[path];
  const app = document.getElementById("app");
  if (need && !state[need]) {
    app.innerHTML = `<p class="empty">${t("loading")}</p>`;
    ensureFeed(need).then(render);
    return;
  }
  if (path === "/" || path === "/map") state.listHash = location.hash || "#/";
  if (path === "/map") app.innerHTML = findView(query, true);
  else if (path === "/quality") app.innerHTML = qualityView();
  else if (path === "/park") app.innerHTML = parkView(decodeURIComponent(id));
  else if (path === "/meters") app.innerHTML = metersView(query);
  else if (path === "/cameras") app.innerHTML = camerasView(query);
  else if (path === "/news") app.innerHTML = newsView(query);
  else if (path === "/about") app.innerHTML = aboutView();
  else if (path === "/privacy") app.innerHTML = privacyView();
  else app.innerHTML = findView(query, false);

  app.querySelectorAll("[data-fav]").forEach((btn) => {
    btn.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      toggleFav(btn.dataset.fav);
    });
  });
  app.querySelectorAll("[data-park]").forEach((card) => {
    card.addEventListener("click", (event) => {
      if (event.target.closest("[data-fav], a")) return;
      location.hash = "#/park/" + encodeURIComponent(card.dataset.park);
    });
  });
  bindFilters();
  if (restore) {
    const node = document.getElementById(restore.id);
    if (node) {
      node.focus();
      if (typeof node.setSelectionRange === "function") {
        const pos = restore.end ?? node.value.length;
        node.setSelectionRange(restore.start ?? pos, pos);
      }
    }
  }
  if (state.scrollToFilters) {
    document.querySelector(".toolbar")?.scrollIntoView();
    state.scrollToFilters = false;
  }
  if (document.getElementById("map")) {
    let parks;
    if (path === "/quality") parks = mergedParks();
    else if (path === "/park") parks = mergedParks().filter((item) => item.id === decodeURIComponent(id));
    else parks = filterParks(mergedParks(), query);
    requestAnimationFrame(() => drawMap(path === "/quality" ? "missing" : "vacancy", parks));
  }
}

async function ensureFeed(name) {
  if (state[name] && !state[name].empty) return;
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
  } catch (_error) {
    document.getElementById("app").innerHTML = `<p class="empty">${t("loading")}</p>`;
    return;
  }
  try {
    state.forecast = await loadJson("data/forecast.json");
    state.metrics = await loadJson("data/metrics.json");
  } catch (_error) {
    /* optional until Actions has history */
  }
  await tryLiveOverlay();
  render();
}

document.getElementById("lang-btn").addEventListener("click", () => {
  state.lang = state.lang === "zh" ? "en" : "zh";
  localStorage.setItem(LANG_KEY, state.lang);
  const query = route().query;
  if (query.has("district")) {
    query.delete("district");
    setQuery(query);
    return;
  }
  render();
});
document.getElementById("theme-btn").addEventListener("click", () => {
  document.body.classList.toggle("dark");
  localStorage.setItem(THEME_KEY, document.body.classList.contains("dark") ? "1" : "0");
  document.getElementById("theme-btn").textContent = document.body.classList.contains("dark")
    ? t("theme_light")
    : t("theme");
});
document.getElementById("menu-btn").addEventListener("click", () => {
  const nav = document.getElementById("site-nav");
  const open = nav.classList.toggle("open");
  document.getElementById("menu-btn").setAttribute("aria-expanded", open ? "true" : "false");
});
document.getElementById("site-nav").addEventListener("click", () => {
  document.getElementById("site-nav").classList.remove("open");
  document.getElementById("menu-btn").setAttribute("aria-expanded", "false");
});
window.addEventListener("hashchange", render);
boot();
