/* ============================================================
   World Mythologies — v3 core
   Loads a pantheon content pack, routes, and renders the shared
   chrome: search, filters, figure panel, stories, about.
   All content comes from data/<pantheon>/dataset.json.
   ============================================================ */
"use strict";

/* ---------------- shared constants ---------------- */

const CAT_COLORS = {
  cosmic: "#a78bfa", trimurti: "#eab308", tridevi: "#ec4899",
  deva: "#3b82f6", goddess: "#fb7185", avatar: "#2dd4bf",
  sage: "#a3e635", human: "#cd8b4a", asura: "#dc2626",
  naga: "#16a34a", celestial: "#67e8f9", vahana: "#f97316",
  titan: "#c084fc", olympian: "#eab308", giant: "#dc2626", nymph: "#67e8f9",
  primordial: "#8b8bf0", chthonic: "#7c5cbf", daemon: "#5eead4",
  monster: "#b91c1c", hero: "#f59e0b", mortal: "#cd8b4a", seer: "#a3e635"
};
const CAT_LABELS = {
  cosmic: "Cosmic principle", trimurti: "Trimurti", tridevi: "Tridevi",
  deva: "Deva", goddess: "Goddess", avatar: "Avatar", sage: "Sage",
  human: "Human", asura: "Asura", naga: "Naga",
  celestial: "Celestial", vahana: "Vahana (mount)",
  titan: "Titan", olympian: "Olympian", giant: "Giant", nymph: "Nymph",
  primordial: "Primordial", chthonic: "Chthonic power", daemon: "Lesser divinity",
  monster: "Monster", hero: "Hero", mortal: "Mortal", seer: "Seer"
};
const ERA_LABELS = {
  "Cosmic": "Cosmic", "Vedic": "Vedic", "Puranic": "Puranic",
  "Epic-Ramayana": "Ramayana", "Epic-Mahabharata": "Mahabharata"
};

const REL_DIRECTIONAL = new Set(["parent", "avatar", "form", "devotee", "mount", "guru", "foster"]);
const REL_LABELS = {
  parent: "Parent of", consort: "Consort", sibling: "Sibling", avatar: "Avatar",
  form: "Form or aspect", enemy: "Adversary", devotee: "Devotee",
  mount: "Mount", guru: "Guru", foster: "Foster parent", ally: "Ally"
};
const REL_GROUPS = {
  parent:  { out: "Children",        in: "Parents" },
  consort: { out: "Consorts",        in: "Consorts" },
  sibling: { out: "Siblings",        in: "Siblings" },
  avatar:  { out: "Avatars",         in: "Avatar of" },
  form:    { out: "Forms",           in: "Form of" },
  enemy:   { out: "Adversaries",     in: "Adversaries" },
  devotee: { out: "Devoted to",      in: "Devotees" },
  mount:   { out: "Mount of",        in: "Mount" },
  guru:    { out: "Students",        in: "Gurus" },
  foster:  { out: "Foster children", in: "Foster parents" },
  ally:    { out: "Allies",          in: "Allies" }
};
const REL_ORDER = ["avatar", "form", "consort", "parent", "foster", "sibling",
                   "guru", "devotee", "mount", "ally", "enemy"];

const LENSES = ["map", "mindmap", "outline", "cards", "table", "figure"];

/* ---------------- app state ---------------- */

const APP = {
  manifest: null,
  archetypes: null,
  packs: {},            // id -> dataset (cached)
  data: null,           // active dataset
  pid: null,            // active pantheon id
  byId: new Map(),
  storyById: new Map(),
  neighbors: new Map(),
  nodes: [], links: [],
  selectedId: null,
  view: "map",
  lens: "map",
  filters: { era: new Set(), category: new Set(), rel: new Set() },
  chart: new Set(),     // ids selected for the chart
  lastFocusEl: null,
  built: {}             // lens -> true once first built
};

/* ---------------- utilities ---------------- */

const $ = (s, el) => (el || document).querySelector(s);
const $$ = (s, el) => Array.from((el || document).querySelectorAll(s));

function store(key, val) { try { localStorage.setItem(key, val); } catch (e) { /* private mode */ } }
function readStore(key) { try { return localStorage.getItem(key); } catch (e) { return null; } }

function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function shortName(e) { return e.name.split(" (")[0]; }
function catLabel(c) { return CAT_LABELS[c] || c; }
function catColor(c) { return CAT_COLORS[c] || "#9aa0aa"; }
function eraLabel(x) { return ERA_LABELS[x] || x; }
function portraitPath(e) {
  /* datasets store a repo-relative path; pages live at /<pid>/... so make it absolute */
  return e.portrait.charAt(0) === "/" ? e.portrait : "/" + e.portrait;
}
function entity(id) { return APP.byId.get(id); }

function wikiUrl(e) {
  return "https://en.wikipedia.org/wiki/" + encodeURIComponent(e.wikipedia.replace(/ /g, "_"));
}

function letterInk(hex) {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) > 150 ? "#1c1608" : "#fdf8ec";
}

function degree(id) {
  const s = APP.neighbors.get(id);
  return s ? s.size : 0;
}

function nodeRadius(e) {
  return Math.max(17, Math.min(34, 15 + degree(e.id) * 1.15));
}

function edgeSampleSvg(type, w) {
  const width = w || 44;
  const marker = REL_DIRECTIONAL.has(type)
    ? '<path class="m-' + type + '" d="M' + (width - 8) + ',3 L' + width + ',7 L' + (width - 8) + ',11 Z"></path>' : "";
  return '<svg width="' + width + '" height="14" aria-hidden="true">' +
    '<line class="edge ' + type + ' is-lit" x1="1" y1="7" x2="' + (width - (marker ? 9 : 1)) + '" y2="7"></line>' +
    marker + "</svg>";
}

/* ---------------- boot ---------------- */

/* Every script here is deferred, so they execute in order -- but this .then is
   a microtask, and the microtask queue drains BETWEEN deferred scripts. On a
   fast or cached response the boot could therefore run before vault.js had
   defined Vault. Waiting on DOMContentLoaded (which fires only after all
   deferred scripts have executed) closes that race without delaying the
   fetches, which still start immediately. */
const domReady = new Promise(resolve => {
  /* NOT "loading": readyState is already "interactive" while deferred scripts
     run, and DOMContentLoaded fires only after the last of them. Testing for
     "loading" here would resolve immediately and wait for nothing. */
  if (document.readyState === "complete") {
    resolve();
  } else {
    document.addEventListener("DOMContentLoaded", resolve, { once: true });
  }
});

Promise.all([
  fetch("/data/pantheons.json").then(r => r.json()),
  fetch("/data/archetypes.json").then(r => r.json()),
  domReady
]).then(([manifest, arch]) => {
  APP.manifest = manifest.pantheons;
  APP.archetypes = arch.archetypes;
  Vault.restoreReveals();
  buildLanding();
  wireChrome();
  /* v2/v3 shared links used #/pid/view; move them to the real path */
  if (/^#\//.test(location.hash || "")) {
    const legacy = location.hash.replace(/^#\/?/, "");
    return replaceUrl("/" + legacy);
  }
  return handleRoute();
}).catch(err => {
  const el = $("#graph-loading");
  if (el) el.textContent = "The data could not be loaded. Please reload the page.";
  console.error(err);
});

/* Load (and cache) one pantheon pack, then index it as the active pantheon. */
function loadPantheon(pid) {
  if (APP.pid === pid) return Promise.resolve();
  const done = d => {
    APP.packs[pid] = d;
    APP.data = d;
    APP.pid = pid;
    indexData();
    resetForPantheon();
    return d;
  };
  if (APP.packs[pid]) return Promise.resolve(done(APP.packs[pid]));
  if (Vault.isOpen(pid)) return Promise.resolve(done(Vault.attach(pid)));
  return fetch("/data/" + pid + "/dataset.json")
    .then(r => { if (!r.ok) throw new Error("pack " + pid + ": " + r.status); return r.json(); })
    .then(done);
}

function indexData() {
  const d = APP.data;
  APP.byId = new Map();
  APP.storyById = new Map();
  APP.neighbors = new Map();
  d.entities.forEach(e => { APP.byId.set(e.id, e); APP.neighbors.set(e.id, new Set()); });
  d.stories.forEach(s => APP.storyById.set(s.id, s));
  d.links.forEach(l => {
    if (APP.neighbors.has(l.from)) APP.neighbors.get(l.from).add(l.to);
    if (APP.neighbors.has(l.to)) APP.neighbors.get(l.to).add(l.from);
  });

  APP.nodes = d.entities.map(e => ({ ...e }));
  APP.links = d.links.map(l => ({ ...l, source: l.from, target: l.to }));

  /* curve parallel edges apart */
  const count = new Map(), seen = new Map();
  APP.links.forEach(l => {
    const k = [l.from, l.to].sort().join("|");
    count.set(k, (count.get(k) || 0) + 1);
  });
  APP.links.forEach(l => {
    const k = [l.from, l.to].sort().join("|");
    const n = count.get(k);
    if (n > 1) {
      const i = seen.get(k) || 0;
      seen.set(k, i + 1);
      l.curve = (i - (n - 1) / 2) * 22;
    } else l.curve = 0;
  });
}

/* Everything that must be rebuilt when the active pantheon changes. */
function resetForPantheon() {
  APP.selectedId = null;
  APP.built = {};
  APP.filters.era.clear();
  APP.filters.category.clear();
  APP.filters.rel.clear();
  $("#panel").hidden = true;

  const meta = APP.data.meta || { label: APP.pid, sublabel: "" };
  $("#brand-title").textContent = meta.label + " Mythology";
  $("#brand-sub").textContent = "A Relationship Map";
  const listed = (APP.manifest || []).find(p => p.id === APP.pid) || {};
  setBrandMark(meta.glyph || listed.glyph, meta.accent || listed.accent);
  document.title = meta.label + " Mythology - Relationship Map";
  $$(".tab[data-view]").forEach(t => {
    const v = t.dataset.view;
    if (v !== "compare") t.setAttribute("href", "/" + APP.pid + "/" + v);
  });
  $("#tray-open").setAttribute("href", "/" + APP.pid + "/chart");

  buildLegend();
  buildFilters();
  buildStories();
  GraphLens.build();
  Lenses.reset();
  Hierarchy.build();
  ChartBuilder.reset();
  restoreChartSelection();
}

/* ---------------- routing ---------------- */

const LEGACY = new Set(["map", "stories", "story", "index", "figure", "hierarchy", "chart"]);

function handleRoute() {
  const raw = decodeURIComponent(location.pathname).replace(/^\/+|\/+$/g, "");
  const parts = raw.split("/").filter(Boolean);

  if (parts[0] === "compare") {
    const first = APP.manifest[0].id;
    return loadPantheon(APP.pid || first).then(() => {
      Compare.build();
      showView("compare");
    });
  }

  /* legacy v2 routes: #/map, #/figure/x ... -> first pantheon */
  if (parts.length === 0 || LEGACY.has(parts[0])) {
    const pid = APP.manifest[0].id;
    if (parts.length === 0) {
      if (APP.manifest.length > 1) { showView("landing"); return Promise.resolve(); }
      return replaceUrl("/" + pid + "/map");
    }
    return replaceUrl("/" + pid + "/" + parts.join("/"));
  }

  const pid = parts[0];
  const entry = APP.manifest.find(p => p.id === pid);
  if (!entry) return replaceUrl("/");
  if (entry.status === "private") {
    /* the ciphertext is public; without the passphrase it is noise */
    if (!Vault.isOpen(pid)) {
      VaultGate.show(pid, () => handleRoute());
      return Promise.resolve();
    }
  } else if (entry.status !== "live") {
    /* announced but not built yet: nothing to load */
    return replaceUrl("/");
  }
  const head = parts[1] || "map";
  const arg = parts[2];

  return loadPantheon(pid).then(() => {
    switch (head) {
      case "figure":
        if (arg && APP.byId.has(arg)) { showView("map"); selectFigure(arg); }
        else { showView("map"); }
        break;
      case "stories":
        showView("stories");
        break;
      case "story":
        showView("stories");
        if (arg) {
          const card = document.getElementById("story-" + arg);
          if (card) { card.scrollIntoView({ block: "start", behavior: "smooth" }); card.focus({ preventScroll: true }); }
        }
        break;
      case "index":
        showView("map"); setLens("table");
        break;
      case "hierarchy":
        showView("hierarchy");
        break;
      case "chart":
        showView("chart"); ChartBuilder.render();
        break;
      default:
        showView("map");
        if (APP.selectedId) clearSelection(false);
    }
  });
}

/* the hub is not a pantheon, so it carries the site-wide title */
function resetBrand() {
  $("#brand-title").textContent = "Mythologies of the World";
  $("#brand-sub").textContent = "Relationship Maps";
  setBrandMark(null, null);
  document.title = "World Mythologies - Relationship Maps";
}

function showView(name) {
  APP.view = name;
  /* the portal carries no pantheon, so the pantheon-scoped chrome is hidden */
  document.body.classList.toggle("on-hub", name === "landing" || name === "vault");
  if (name === "landing") resetBrand();
  ["landing", "vault", "map", "stories", "hierarchy", "chart", "compare"].forEach(v => {
    const el = $("#view-" + v);
    if (el) el.hidden = v !== name;
  });
  $$(".tab[data-view]").forEach(t => {
    if (t.dataset.view === name) t.setAttribute("aria-current", "page");
    else t.removeAttribute("aria-current");
  });
  if (name === "map") Lenses.onShow(APP.lens);
}

function replaceUrl(path) { history.replaceState({}, "", path); return handleRoute(); }
function pushUrl(path) { history.pushState({}, "", path); return handleRoute(); }
function goTo(path) {
  if (location.pathname === path) return handleRoute();
  return pushUrl(path);
}
function figureHash(id) { return "/" + APP.pid + "/figure/" + id; }

/* Each tradition marks itself with its own sign in its own colour. The
   fallback is the neutral star the portal ships with, so a pack that has no
   glyph yet degrades to that rather than to the previous tradition's. */
const NEUTRAL_GLYPH = "\u2726";

function setBrandMark(glyph, accent) {
  const el = $("#brand-glyph");
  if (!el) return;
  el.textContent = glyph || NEUTRAL_GLYPH;
  if (accent) {
    el.style.setProperty("--brand-glyph-color", accent);
  } else {
    el.style.removeProperty("--brand-glyph-color");
  }
}

/* ---------------- landing ---------------- */

function buildLanding() {
  const live = APP.manifest.filter(p => p.status === "live");
  const planned = APP.manifest.filter(p => p.status === "planned");
  const priv = APP.manifest.filter(p => p.status === "private" && Vault.isRevealed(p.id));
  const first = live[0];

  /* hero */
  const figures = live.reduce((n, p) => n + (p.figures || 0), 0);
  const links = live.reduce((n, p) => n + (p.links || 0), 0);
  const stories = live.reduce((n, p) => n + (p.stories || 0), 0);
  const tradWord = live.length === 1 ? "tradition" : "traditions";
  $("#hero-sub").textContent =
    figures + " figures, " + links + " relationships and " + stories +
    " story cycles across " + live.length + " mapped " + tradWord + ", each traced to the text that carries it. " +
    planned.length + " more traditions in preparation. Runs entirely in your browser.";
  if (first) {
    const cta = $("#hero-cta-main");
    cta.setAttribute("href", "/" + first.id + "/map");
    cta.textContent = "Explore " + first.label + " mythology";
  }

  /* browse by tradition */
  $("#pantheon-grid").innerHTML = live.map(p =>
    '<a class="pantheon-card" href="/' + esc(p.id) + '/map">' +
      '<img src="/' + esc(p.cover) + '" alt="" loading="lazy" width="96" height="96">' +
      '<h4 class="pantheon-name">' + esc(p.label) + "</h4>" +
      '<p class="pantheon-sub">' + esc(p.sublabel || "") + "</p>" +
      '<p class="pantheon-blurb">' + esc(p.blurb || "") + "</p>" +
      '<p class="pantheon-stats">' + p.figures + " figures &middot; " + p.stories + " stories</p>" +
    "</a>"
  ).join("") + priv.map(p =>
    '<a class="pantheon-card is-private" href="/' + esc(p.id) + '/map">' +
      '<span class="soon-glyph" aria-hidden="true">&#128274;</span>' +
      '<h4 class="pantheon-name">' + esc(p.label) + "</h4>" +
      '<p class="pantheon-sub">' + esc(p.sublabel || "") + "</p>" +
      '<p class="pantheon-blurb">' + esc(p.blurb || "") + "</p>" +
      '<p class="pantheon-stats">' + (Vault.isOpen(p.id) ? "Open" : "Locked") + "</p>" +
    "</a>"
  ).join("") + planned.map(p =>
    '<div class="pantheon-card is-soon">' +
      '<span class="soon-glyph" aria-hidden="true">&#10022;</span>' +
      '<h4 class="pantheon-name">' + esc(p.label) + "</h4>" +
      '<p class="pantheon-sub">' + esc(p.sublabel || "") + "</p>" +
      '<p class="pantheon-blurb">' + esc(p.blurb || "") + "</p>" +
      '<p class="pantheon-stats">In preparation</p>' +
    "</div>"
  ).join("");

  /* ways to explore, counted from the live packs */
  const pid = first ? first.id : "";
  const ways = [
    ["&#9673;", "Relationship Map", "6 lenses", "/" + pid + "/map",
     "The force-directed graph, plus mind map, outline, cards, table and single-figure views of the same model."],
    ["&#10087;", "Story Cycles", stories + " stories", "/" + pid + "/stories",
     "Each narrative with its cast as clickable portraits and the primary texts that carry it."],
    ["&#8982;", "Hierarchy", (first && first.levels ? first.levels : 6) + " levels", "/" + pid + "/hierarchy",
     "How a pantheon is ordered, from its transcendent source down to its heroes and adversaries."],
    ["&#10023;", "Chart Builder", "12 presets", "/" + pid + "/chart",
     "Compose a poster-style relationship chart from the figures you choose, then export it as SVG or PNG."],
    ["&#9033;", "Comparative Matrix", APP.archetypes.length + " archetypes", "/compare",
     "The same questions asked of every tradition, and which figure fills each archetypal role."]
  ];
  $("#ways-grid").innerHTML = ways.map(w =>
    '<a class="way-card" href="' + w[3] + '">' +
      '<span class="way-glyph" aria-hidden="true">' + w[0] + "</span>" +
      '<h4 class="way-name">' + w[1] + "</h4>" +
      '<p class="way-count">' + w[2] + "</p>" +
      '<p class="way-blurb">' + w[4] + "</p>" +
    "</a>"
  ).join("");
}

/* ---------------- chrome ---------------- */

function wireChrome() {
  $("#theme-toggle").addEventListener("click", () => {
    const cur = document.documentElement.getAttribute("data-theme");
    const next = cur === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    store("hm-theme", next);
    $("#theme-toggle").setAttribute("aria-pressed", next === "light" ? "true" : "false");
    if (APP.view === "chart") ChartBuilder.render();
  });
  $("#theme-toggle").setAttribute("aria-pressed",
    document.documentElement.getAttribute("data-theme") === "light" ? "true" : "false");

  $("#about-btn").addEventListener("click", openAbout);
  const hubAbout = $("#hub-about-btn");
  if (hubAbout) hubAbout.addEventListener("click", openAbout);
  $("#about-close").addEventListener("click", () => $("#about-dialog").close());
  $("#lightbox-close").addEventListener("click", () => $("#lightbox").close());
  $("#lightbox").addEventListener("click", ev => {
    if (ev.target === $("#lightbox")) $("#lightbox").close();
  });
  $("#panel-close").addEventListener("click", () => clearSelection(true));

  /* lens switcher */
  $$(".lens-btn").forEach(b => b.addEventListener("click", () => setLens(b.dataset.lens)));
  const savedLens = readStore("hm-lens");
  if (savedLens && LENSES.includes(savedLens)) APP.lens = savedLens;

  $("#expand-btn").addEventListener("click", toggleExpand);

  $("#filter-mode").addEventListener("click", () => {
    applyFilterMode(readStore("hm-filtermode") === "inline" ? "menus" : "inline");
    Lenses.onResize();
  });

  document.addEventListener("keydown", ev => {
    if (ev.key === "Escape") {
      if ($("#lightbox").open || $("#about-dialog").open) return;
      if (!$("#search-list").hidden) { closeSearchList(); return; }
      if (document.body.classList.contains("is-expanded")) { toggleExpand(); return; }
      if (!$("#chart-tray").hidden) { closeTray(); return; }
      const openPop = $$(".filter-pop").find(p => !p.hidden);
      if (openPop) { closeFilterPops(); return; }
      if (APP.selectedId && APP.view === "map") clearSelection(true);
    }
  });

  document.addEventListener("click", ev => {
    if (!ev.target.closest(".filter-group")) closeFilterPops();
    if (!ev.target.closest(".search")) closeSearchList();
  });

  window.addEventListener("popstate", handleRoute);

  /* internal links are real URLs; route them without a page load */
  document.addEventListener("click", ev => {
    const a = ev.target.closest("a");
    if (!a || a.target === "_blank" || a.hasAttribute("download")) return;
    if (ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey || ev.button !== 0) return;
    const href = a.getAttribute("href");
    if (!href || href.charAt(0) !== "/") return;
    ev.preventDefault();
    goTo(href);
  });
  wireSearch();
  wireTray();

  $("#unlock-row").addEventListener("submit", ev => {
    ev.preventDefault();
    const word = $("#unlock-word").value;
    const msg = $("#unlock-msg");
    if (!word.trim()) return;
    msg.textContent = "Checking...";
    Vault.tryUnlockWord(word).then(found => {
      $("#unlock-word").value = "";
      msg.textContent = found.length
        ? "Unlocked: " + found.join(", ")
        : "No collection answers to that word.";
      setTimeout(() => { msg.textContent = ""; }, 4000);
    });
  });
}

function setLens(lens) {
  if (!LENSES.includes(lens)) return;
  APP.lens = lens;
  store("hm-lens", lens);
  $$(".lens-btn").forEach(b => b.setAttribute("aria-selected", b.dataset.lens === lens ? "true" : "false"));
  $$(".lens-pane").forEach(p => { p.hidden = p.dataset.pane !== lens; });
  $(".filterbar").classList.toggle("rel-hidden", lens !== "map");
  if (APP.view === "map") Lenses.onShow(lens);
}

function toggleExpand() {
  const on = document.body.classList.toggle("is-expanded");
  $("#expand-btn").textContent = on ? "Restore" : "Expand";
  const el = $("#view-map");
  if (on && el.requestFullscreen) el.requestFullscreen().catch(() => { /* denied is fine */ });
  else if (!on && document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(() => {});
  requestAnimationFrame(() => requestAnimationFrame(() => Lenses.onResize()));
}

/* ---------------- legend ---------------- */

function buildLegend() {
  const types = Object.keys(APP.data.relationshipTypes);
  $("#legend-rels").innerHTML = types.map(t =>
    "<li>" + edgeSampleSvg(t) + "<span>" + esc(REL_LABELS[t] || t) + "</span></li>"
  ).join("");
  const cats = presentCategories();
  $("#legend-cats").innerHTML = cats.map(c =>
    '<li><span class="cat-swatch" style="background:' + catColor(c) + '"></span><span>' +
    esc(catLabel(c)) + "</span></li>"
  ).join("");
  if (window.matchMedia("(min-width: 701px)").matches) $("#legend").open = true;
}

function presentCategories() {
  const seen = [];
  APP.data.entities.forEach(e => { if (!seen.includes(e.category)) seen.push(e.category); });
  return seen;
}
function presentEras() {
  const seen = [];
  APP.data.entities.forEach(e => { if (!seen.includes(e.era)) seen.push(e.era); });
  return seen;
}

/* ---------------- filters ---------------- */

function filterItems(kind) {
  if (kind === "era") return presentEras().map(e => ({ value: e, label: eraLabel(e) }));
  if (kind === "category") return presentCategories().map(c => ({ value: c, label: catLabel(c), swatch: catColor(c) }));
  return Object.keys(APP.data.relationshipTypes).map(t => ({ value: t, label: REL_LABELS[t] || t, edge: t }));
}

function buildFilters() {
  ["era", "category", "rel"].forEach(k => buildFilterPop(k, filterItems(k)));
  buildFilterRow();
  applyFilterMode(readStore("hm-filtermode") === "inline" ? "inline" : "menus");

  const reset = $("#filter-reset");
  reset.onclick = () => {
    APP.filters.era.clear(); APP.filters.category.clear(); APP.filters.rel.clear();
    syncFilterControls();
    applyFilters();
  };
  applyFilters();
}

function buildFilterPop(kind, items) {
  const group = $('.filter-group[data-filter="' + kind + '"]');
  const btn = $(".filter-btn", group);
  const pop = $(".filter-pop", group);

  pop.innerHTML = items.map(it => {
    let deco = "";
    if (it.swatch) deco = '<span class="cat-swatch" style="background:' + it.swatch + '"></span>';
    if (it.edge) deco = edgeSampleSvg(it.edge, 30);
    return '<label><input type="checkbox" value="' + esc(it.value) + '">' + deco +
      "<span>" + esc(it.label) + "</span></label>";
  }).join("") +
  '<div class="pop-actions"><button type="button" data-act="all">Select all</button>' +
  '<button type="button" data-act="none">Clear</button></div>';

  btn.onclick = () => {
    const open = pop.hidden;
    closeFilterPops();
    if (open) { pop.hidden = false; btn.setAttribute("aria-expanded", "true"); }
  };
  pop.onchange = () => {
    const set = APP.filters[kind];
    set.clear();
    $$("input[type=checkbox]", pop).forEach(cb => { if (cb.checked) set.add(cb.value); });
    syncFilterControls();
    applyFilters();
  };
  pop.onclick = ev => {
    const act = ev.target.dataset && ev.target.dataset.act;
    if (!act) return;
    $$("input[type=checkbox]", pop).forEach(cb => { cb.checked = act === "all"; });
    pop.dispatchEvent(new Event("change"));
  };
}

function closeFilterPops() {
  $$(".filter-pop").forEach(p => { p.hidden = true; });
  $$(".filter-btn").forEach(b => b.setAttribute("aria-expanded", "false"));
}

/* ---- inline filter row: the same three filters as one row of buttons ---- */

const ROW_SECTIONS = [
  { kind: "era", label: "Era" },
  { kind: "category", label: "Category" },
  { kind: "rel", label: "Links" }
];

function buildFilterRow() {
  const row = $("#filterrow");
  row.innerHTML = ROW_SECTIONS.map(sec =>
    '<div class="frow-sec">' +
      '<span class="frow-label">' + esc(sec.label) + "</span>" +
      filterItems(sec.kind).map(it =>
        '<button type="button" class="frow-chip" data-kind="' + sec.kind + '" data-value="' +
        esc(it.value) + '" aria-pressed="false">' +
        (it.swatch ? '<span class="cat-swatch" style="background:' + it.swatch + '"></span>' : "") +
        esc(it.label) + "</button>"
      ).join("") +
    "</div>"
  ).join("");

  row.onclick = ev => {
    const chip = ev.target.closest(".frow-chip");
    if (!chip) return;
    const set = APP.filters[chip.dataset.kind];
    if (set.has(chip.dataset.value)) set.delete(chip.dataset.value);
    else set.add(chip.dataset.value);
    syncFilterControls();
    applyFilters();
  };
}

/* Keep menus and row showing the same state, whichever was used. */
function syncFilterControls() {
  $$(".filter-pop input[type=checkbox]").forEach(cb => {
    const kind = cb.closest(".filter-group").dataset.filter;
    cb.checked = APP.filters[kind].has(cb.value);
  });
  $$(".frow-chip").forEach(chip => {
    chip.setAttribute("aria-pressed",
      APP.filters[chip.dataset.kind].has(chip.dataset.value) ? "true" : "false");
  });
}

function applyFilterMode(mode) {
  const inline = mode === "inline";
  store("hm-filtermode", mode);
  $("#filterrow").hidden = !inline;
  $$(".filter-group").forEach(g => { g.hidden = inline; });
  const btn = $("#filter-mode");
  btn.setAttribute("aria-pressed", inline ? "true" : "false");
  btn.textContent = inline ? "Filter menus" : "Button row";
  if (inline) closeFilterPops();
  syncFilterControls();
}

function nodeVisible(e) {
  const f = APP.filters;
  if (f.era.size && !f.era.has(e.era)) return false;
  if (f.category.size && !f.category.has(e.category)) return false;
  return true;
}
function edgeVisible(l) {
  if (APP.filters.rel.size && !APP.filters.rel.has(l.type)) return false;
  return nodeVisible(entity(l.from)) && nodeVisible(entity(l.to));
}
function visibleEntities() { return APP.data.entities.filter(nodeVisible); }

function applyFilters() {
  const shown = visibleEntities().length;
  GraphLens.applyFilters();
  Lenses.applyFilters();

  ["era", "category", "rel"].forEach(kind => {
    const group = $('.filter-group[data-filter="' + kind + '"]');
    const badge = $(".filter-count", group);
    const n = APP.filters[kind].size;
    badge.hidden = n === 0;
    badge.textContent = n;
  });
  const active = APP.filters.era.size + APP.filters.category.size + APP.filters.rel.size > 0;
  $("#filter-reset").hidden = !active;
  $("#filter-status").textContent = active
    ? "Showing " + shown + " of " + APP.data.entities.length + " figures"
    : APP.data.entities.length + " figures, " + APP.data.links.length + " relationships";

  if (APP.selectedId && !nodeVisible(entity(APP.selectedId))) clearSelection(false);
  else GraphLens.refreshDimming();
}

/* ---------------- selection ---------------- */

function selectFigure(id) {
  APP.selectedId = id;
  GraphLens.refreshDimming();
  const e = entity(id);
  if (APP.lens === "figure") {
    Lenses.showFigure(id);
    return;
  }
  $("#panel-content").innerHTML = figureHtml(e, { panel: true });
  wireFigureBody($("#panel-content"), e);
  const panel = $("#panel");
  panel.hidden = false;
  if (APP.lens === "map") GraphLens.center(id);
  if (APP.lens === "mindmap") MindMapLens.focus(id);
  panel.focus({ preventScroll: true });
  $(".panel-scroll").scrollTop = 0;
}

function clearSelection(updateHash) {
  APP.selectedId = null;
  $("#panel").hidden = true;
  GraphLens.refreshDimming();
  if (updateHash && location.hash.indexOf("/figure/") > -1) {
    history.pushState({}, "", "/" + APP.pid + "/map");
  }
  if (APP.lastFocusEl && document.contains(APP.lastFocusEl)) {
    APP.lastFocusEl.focus();
    APP.lastFocusEl = null;
  }
}

/* ---------------- figure rendering (shared by panel and Figure lens) ---------------- */

function chipHtml(text, swatchColor) {
  const sw = swatchColor ? '<span class="cat-swatch" style="background:' + swatchColor + '"></span>' : "";
  return '<span class="chip">' + sw + esc(text) + "</span>";
}

function listSection(title, items) {
  if (!items || !items.length) return "";
  return '<section class="fig-section"><h3 class="fig-h">' + esc(title) + '</h3>' +
    '<ul class="fig-list">' + items.map(i => "<li>" + esc(i) + "</li>").join("") + "</ul></section>";
}

function collectRelations(id) {
  const out = {};
  APP.data.links.forEach(l => {
    if (l.from !== id && l.to !== id) return;
    const dirKey = l.from === id ? "out" : "in";
    const otherId = l.from === id ? l.to : l.from;
    const heading = (REL_GROUPS[l.type] || { out: l.type, in: l.type })[dirKey];
    out[l.type] = out[l.type] || {};
    out[l.type][heading] = out[l.type][heading] || [];
    out[l.type][heading].push({ id: otherId, note: l.note });
  });
  return out;
}

function figureHtml(e, opts) {
  opts = opts || {};
  const rels = collectRelations(e.id);
  const relHtml = REL_ORDER.concat(Object.keys(rels).filter(t => REL_ORDER.indexOf(t) < 0))
    .map(type => {
      const groups = rels[type];
      if (!groups) return "";
      return Object.keys(groups).map(heading => {
        const entries = groups[heading];
        return '<div class="rel-group">' +
          '<h4 class="rel-type-h">' + edgeSampleSvg(type, 30) + esc(heading) + "</h4>" +
          '<div class="rel-links">' + entries.map(en => {
            const o = entity(en.id);
            if (!o) return "";
            return '<a class="rel-chip" href="' + figureHash(o.id) + '">' +
              '<img src="' + esc(portraitPath(o)) + '" alt="" loading="lazy" width="24" height="24">' +
              "<span>" + esc(shortName(o)) + "</span>" +
              (en.note ? '<span class="rel-note">' + esc(en.note) + "</span>" : "") +
              "</a>";
          }).join("") + "</div></div>";
      }).join("");
    }).join("");

  const stories = (e.storyIds || []).map(id => APP.storyById.get(id)).filter(Boolean);
  const arch = (e.archetypes || []).map(k => {
    const a = APP.archetypes.find(x => x.key === k);
    return a ? a.label : k;
  });

  const quickFacts = [];
  if (e.mount) quickFacts.push(["Mount", e.mount]);
  if (e.abode) quickFacts.push(["Abode", e.abode]);
  if (quickFacts.length === 1) quickFacts[0][2] = true;
  if (e.festivals && e.festivals.length) quickFacts.push(["Festivals", e.festivals.join(", "), true]);

  const inChart = APP.chart.has(e.id);

  return '<header class="fig-hero">' +
      '<div class="fig-hero-text">' +
        '<h2 class="fig-name">' + esc(e.name) + "</h2>" +
        '<p class="fig-sanskrit" lang="sa">' + esc(e.sanskrit || "") + "</p>" +
        '<p class="fig-role">' + esc(e.role) + "</p>" +
        '<div class="fig-chips">' +
          chipHtml(catLabel(e.category), catColor(e.category)) +
          chipHtml(eraLabel(e.era) + " era") +
        "</div>" +
      "</div>" +
      '<button type="button" class="fig-portrait-btn" data-lightbox="' + esc(e.id) + '" aria-label="Expand the portrait of ' + esc(shortName(e)) + '">' +
        '<img class="fig-portrait" src="' + esc(portraitPath(e)) + '" alt="Portrait of ' + esc(shortName(e)) + '" width="120" height="120">' +
        '<span class="fig-expand-hint" aria-hidden="true">&#8599;</span>' +
      "</button>" +
    "</header>" +
    '<div class="fig-body">' +
      (e.bio ? '<p class="fig-lead">' + esc(e.bio) + "</p>" : "") +
      '<div class="chart-add-row">' +
        '<button type="button" class="chart-add' + (inChart ? " is-in" : "") + '" data-chart-add="' + esc(e.id) + '">' +
          (inChart ? "In your chart" : "Add to chart") + "</button>" +
        '<button type="button" class="ghost-btn small" data-chart-web="' + esc(e.id) + '">' +
          "Add with relations</button>" +
      "</div>" +
      (quickFacts.length
        ? '<dl class="fig-quickfacts">' + quickFacts.map(f =>
            '<div class="qf' + (f[2] ? " qf-wide" : "") + '"><dt>' + esc(f[0]) + "</dt><dd>" + esc(f[1]) + "</dd></div>"
          ).join("") + "</dl>"
        : "") +
      (relHtml
        ? '<section class="fig-section"><h3 class="fig-h">Connected to</h3>' + relHtml + "</section>"
        : "") +
      listSection("Epithets", e.epithets) +
      listSection("Domains", e.domains) +
      listSection("Symbols", e.symbols) +
      (e.longBio
        ? '<details class="fig-more"><summary class="fig-more-summary">Read the full account</summary>' +
          e.longBio.split(/\n+/).map(p => '<p class="fig-prose">' + esc(p) + "</p>").join("") + "</details>"
        : "") +
      (e.worship
        ? '<section class="fig-section"><h3 class="fig-h">Worship</h3><p class="fig-prose">' + esc(e.worship) + "</p></section>"
        : "") +
      (e.variantTraditions
        ? '<section class="fig-section"><h3 class="fig-h">Variant Traditions</h3><p class="fig-note">' + esc(e.variantTraditions) + "</p></section>"
        : "") +
      (stories.length
        ? '<section class="fig-section"><h3 class="fig-h">Appears In</h3><ul class="story-link-list">' +
          stories.map(s => '<li><a class="story-link" href="/' + esc(APP.pid) + '/story/' + esc(s.id) + '">' +
            esc(s.title) + "</a></li>").join("") + "</ul></section>"
        : "") +
      (arch.length
        ? '<section class="fig-section"><h3 class="fig-h">Archetypes</h3>' +
          '<div class="fig-chips left">' + arch.map(a => chipHtml(a)).join("") + "</div>" +
          '<p class="pane-note">Used by the <a href="/compare">comparative matrix</a> to line this figure up with its counterparts in other traditions.</p></section>'
        : "") +
      '<a class="fig-wiki" href="' + wikiUrl(e) + '" target="_blank" rel="noopener">Read more on Wikipedia <span aria-hidden="true">&#8599;</span></a>' +
    "</div>";
}

/* Attach handlers to a rendered figure body (panel or Figure lens). */
function wireFigureBody(root, e) {
  const lb = $(".fig-portrait-btn", root);
  if (lb) lb.addEventListener("click", () => openLightbox(e));
  const add = $("[data-chart-add]", root);
  if (add) add.addEventListener("click", () => {
    toggleChart(add.dataset.chartAdd);
    const on = APP.chart.has(add.dataset.chartAdd);
    add.classList.toggle("is-in", on);
    add.textContent = on ? "In your chart" : "Add to chart";
  });
  const web = $("[data-chart-web]", root);
  if (web) web.addEventListener("click", () => {
    const id = web.dataset.chartWeb;
    const ids = [id].concat(Array.from(APP.neighbors.get(id) || []));
    ChartBuilder.addMany(ids);
    web.textContent = "Added " + ids.length + " figures";
    setTimeout(() => { web.textContent = "Add with relations"; }, 2200);
  });
}

function openLightbox(e) {
  $("#lightbox-img").src = portraitPath(e);
  $("#lightbox-img").alt = "Portrait of " + shortName(e) + ", full illustration";
  $("#lightbox-caption").textContent = shortName(e) + " - original illustration, " +
    (APP.data.meta ? APP.data.meta.label : "") + " pantheon";
  $("#lightbox").showModal();
}

/* ---------------- search ---------------- */

let searchItems = [], searchActive = -1;

function closeSearchList() {
  const list = $("#search-list");
  if (!list) return;
  list.hidden = true;
  $("#search-combo").setAttribute("aria-expanded", "false");
  $("#search-input").removeAttribute("aria-activedescendant");
  searchActive = -1;
}

function wireSearch() {
  const input = $("#search-input");
  const list = $("#search-list");

  function pick(id) {
    closeSearchList();
    input.value = "";
    Lenses.clearQuery();
    goTo(figureHash(id));
  }

  function setActive(i) {
    searchActive = i;
    $$("li", list).forEach((li, j) => li.setAttribute("aria-selected", j === i ? "true" : "false"));
    if (i >= 0) {
      input.setAttribute("aria-activedescendant", "s-opt-" + i);
      const li = $("#s-opt-" + i);
      if (li) li.scrollIntoView({ block: "nearest" });
    }
  }

  input.addEventListener("input", () => {
    const q = input.value.trim().toLowerCase();
    Lenses.setQuery(q);
    if (!APP.data || q.length < 1) { closeSearchList(); return; }
    searchItems = matchEntities(q).slice(0, 8);
    if (!searchItems.length) {
      list.innerHTML = '<li class="s-empty" role="option" aria-disabled="true">No figures match</li>';
    } else {
      list.innerHTML = searchItems.map((e, i) =>
        '<li id="s-opt-' + i + '" role="option" data-id="' + esc(e.id) + '" aria-selected="false">' +
        '<img src="' + esc(portraitPath(e)) + '" alt="" loading="lazy" width="34" height="34">' +
        '<span><span class="s-name">' + esc(shortName(e)) + '</span><br><span class="s-role">' +
        esc(e.role) + "</span></span></li>"
      ).join("");
    }
    list.hidden = false;
    $("#search-combo").setAttribute("aria-expanded", "true");
    setActive(-1);
  });

  input.addEventListener("keydown", ev => {
    if (ev.key === "Enter") {
      ev.preventDefault();
      if (searchActive >= 0 && searchItems[searchActive]) { pick(searchItems[searchActive].id); return; }
      const q = input.value.trim().toLowerCase();
      if (!q) return;
      const first = matchEntities(q)[0];
      if (!first) return;
      /* per-lens Enter behavior */
      if (APP.view === "map" && APP.lens !== "map") { Lenses.gotoMatch(first.id); closeSearchList(); }
      else pick(first.id);
      return;
    }
    if (list.hidden) return;
    if (ev.key === "ArrowDown") { ev.preventDefault(); setActive(Math.min(searchItems.length - 1, searchActive + 1)); }
    else if (ev.key === "ArrowUp") { ev.preventDefault(); setActive(Math.max(0, searchActive - 1)); }
  });

  list.addEventListener("click", ev => {
    const li = ev.target.closest("li[data-id]");
    if (li) pick(li.dataset.id);
  });
}

function matchEntities(q) {
  if (!APP.data) return [];
  const scored = [];
  APP.data.entities.forEach(e => {
    const name = e.name.toLowerCase();
    let score = -1;
    if (name.startsWith(q)) score = 0;
    else if (name.includes(q)) score = 1;
    else if (e.role.toLowerCase().includes(q)) score = 2;
    else if ((e.epithets || []).some(ep => ep.toLowerCase().includes(q))) score = 3;
    else if ((e.domains || []).some(d => d.toLowerCase().includes(q))) score = 4;
    if (score >= 0) scored.push([score, e]);
  });
  scored.sort((a, b) => a[0] - b[0] || a[1].name.localeCompare(b[1].name));
  return scored.map(s => s[1]);
}

/* ---------------- stories ---------------- */

let storyEraFilter = null;

function buildStories() {
  storyEraFilter = null;
  const d = APP.data;
  $("#stories-lede").textContent = d.stories.length +
    " narratives, each with its cast and the primary texts that carry it.";
  const eras = presentEras().filter(e => d.stories.some(s => s.era === e));
  $("#story-eras").innerHTML =
    '<button type="button" class="era-chip" data-era="" aria-pressed="true">All eras</button>' +
    eras.map(e => '<button type="button" class="era-chip" data-era="' + esc(e) + '" aria-pressed="false">' +
      esc(eraLabel(e)) + "</button>").join("");
  $("#story-eras").onclick = ev => {
    const btn = ev.target.closest(".era-chip");
    if (!btn) return;
    storyEraFilter = btn.dataset.era || null;
    $$(".era-chip", $("#story-eras")).forEach(b => b.setAttribute("aria-pressed", b === btn ? "true" : "false"));
    renderStories();
  };
  renderStories();
}

function renderStories() {
  const list = APP.data.stories.filter(s => !storyEraFilter || s.era === storyEraFilter);
  $("#stories-grid").innerHTML = list.map(s => {
    const cast = s.cast.map(id => entity(id)).filter(Boolean);
    return '<article class="story-card" id="story-' + esc(s.id) + '" tabindex="-1" aria-labelledby="st-' + esc(s.id) + '">' +
      '<div class="story-card-h">' +
        '<h3 class="story-title" id="st-' + esc(s.id) + '">' + esc(s.title) + "</h3>" +
        '<span class="story-era">' + esc(eraLabel(s.era)) + "</span>" +
      "</div>" +
      '<p class="story-summary">' + esc(s.summary) + "</p>" +
      '<div class="story-cast" role="group" aria-label="Cast of ' + esc(s.title) + '">' +
        cast.map(c => '<a class="cast-chip" href="' + figureHash(c.id) + '">' +
          '<img src="' + esc(portraitPath(c)) + '" alt="" loading="lazy" decoding="async" width="26" height="26">' +
          "<span>" + esc(shortName(c)) + "</span></a>").join("") +
      "</div>" +
      '<div class="story-foot">' +
        '<button type="button" class="ghost-btn small" data-cast="' + esc(s.id) + '">Add this cast to the chart</button>' +
      "</div>" +
      '<div class="story-sources"><h4 class="story-sources-h">Sources</h4><ul>' +
        s.sources.map(src => '<li><a href="' + esc(src.url) + '" target="_blank" rel="noopener">' +
          esc(src.book) + "</a> " + '<span class="src-loc">' + esc(src.location) +
          " &middot; " + esc(src.translation) + "</span></li>").join("") +
      "</ul></div></article>";
  }).join("");

  $$("[data-cast]", $("#stories-grid")).forEach(btn => {
    btn.addEventListener("click", () => {
      const s = APP.storyById.get(btn.dataset.cast);
      s.cast.forEach(id => { if (APP.byId.has(id)) APP.chart.add(id); });
      saveChartSelection();
      updateTray();
      btn.textContent = "Added " + s.cast.length + " figures";
      setTimeout(() => { btn.textContent = "Add this cast to the chart"; }, 2200);
    });
  });
}

/* ---------------- chart selection tray ---------------- */

function chartKey() { return "hm-chart-" + APP.pid; }

function saveChartSelection() { store(chartKey(), JSON.stringify(Array.from(APP.chart))); }

function restoreChartSelection() {
  APP.chart = new Set();
  try {
    const raw = readStore(chartKey());
    if (raw) JSON.parse(raw).forEach(id => { if (APP.byId.has(id)) APP.chart.add(id); });
  } catch (e) { /* ignore malformed */ }
  updateTray();
}

function toggleChart(id) {
  if (APP.chart.has(id)) APP.chart.delete(id);
  else APP.chart.add(id);
  saveChartSelection();
  updateTray();
  if (APP.view === "chart") ChartBuilder.render();
}

function updateTray() {
  const n = APP.chart.size;
  const badge = $("#tray-count");
  badge.hidden = n === 0;
  badge.textContent = n;
  $$("[data-chart-add]").forEach(b => {
    const on = APP.chart.has(b.dataset.chartAdd);
    b.classList.toggle("is-in", on);
    if (b.classList.contains("chart-add")) b.textContent = on ? "In your chart" : "Add to chart";
  });
  $$(".card-add").forEach(b => b.setAttribute("aria-pressed", APP.chart.has(b.dataset.id) ? "true" : "false"));
  renderTray();
}

function renderTray() {
  const body = $("#tray-body");
  if (!APP.chart.size) {
    body.innerHTML = '<p class="tray-empty">Nothing chosen yet. Add figures from any panel, card or story, or open the Chart view and start from a preset.</p>';
    return;
  }
  body.innerHTML = '<ul class="tray-list">' + Array.from(APP.chart).map(id => {
    const e = entity(id);
    if (!e) return "";
    return '<li><img src="' + esc(portraitPath(e)) + '" alt="" loading="lazy" width="30" height="30">' +
      '<span class="tray-name">' + esc(shortName(e)) + "</span>" +
      '<button type="button" class="tray-remove" data-remove="' + esc(id) + '" aria-label="Remove ' +
      esc(shortName(e)) + ' from the chart">&times;</button></li>';
  }).join("") + "</ul>";
  $$("[data-remove]", body).forEach(b => b.addEventListener("click", () => toggleChart(b.dataset.remove)));
}

function openTray() { $("#chart-tray").hidden = false; document.body.classList.add("tray-open"); }
function closeTray() { $("#chart-tray").hidden = true; document.body.classList.remove("tray-open"); }

function wireTray() {
  $("#chart-tray-btn").addEventListener("click", () => {
    if ($("#chart-tray").hidden) openTray(); else closeTray();
  });
  $("#tray-close").addEventListener("click", closeTray);
  $("#tray-clear").addEventListener("click", () => {
    APP.chart.clear(); saveChartSelection(); updateTray();
    if (APP.view === "chart") ChartBuilder.render();
  });
  $("#tray-open").addEventListener("click", closeTray);
}

/* ---------------- about ---------------- */

/* Which About to show depends on where the reader is, and it is decided at
   the moment of opening. Building it eagerly when a pack loaded is what left
   the portal showing the last tradition visited. */
function openAbout() {
  if (document.body.classList.contains("on-hub") || !APP.data) {
    buildHubAbout();
  } else {
    buildAbout();
  }
  $("#about-dialog").showModal();
}

/* The site-level About, for the portal. Counts come from the manifest, so they
   stay true as traditions are added without anyone editing prose. */
function buildHubAbout() {
  const all = APP.manifest || [];
  const live = all.filter(p => p.status === "live");
  const planned = all.filter(p => p.status === "planned");
  const held = all.filter(p => p.status === "review");
  const sum = k => live.reduce((n, p) => n + (p[k] || 0), 0);

  const row = p =>
    '<li><b>' + esc(p.label) + "</b> " +
    '<span class="idx-muted">' + esc(p.sublabel || "") + "</span> &mdash; " +
    (p.figures || 0) + " figures, " + (p.stories || 0) + " stories " +
    '<a href="/' + esc(p.id) + '/map">open</a></li>';

  $("#about-content").innerHTML =
    "<h2 id='about-title'>World Mythologies</h2>" +
    "<p>Interactive relationship maps of the world's mythologies. Every tradition is " +
    "a fixed dataset of figures, the typed relationships between them, and the story " +
    "cycles they appear in &mdash; each one traced to a published primary text. " +
    "Nothing on this site is generated at read time.</p>" +
    '<div class="about-stats">' +
      '<div class="stat"><b>' + live.length + "</b><span>Traditions</span></div>" +
      '<div class="stat"><b>' + sum("figures") + "</b><span>Figures</span></div>" +
      '<div class="stat"><b>' + sum("links") + "</b><span>Relationships</span></div>" +
      '<div class="stat"><b>' + sum("stories") + "</b><span>Stories</span></div>" +
    "</div>" +
    "<h3>Traditions mapped</h3><ul>" + live.map(row).join("") + "</ul>" +
    (planned.length
      ? "<h3>In preparation</h3><p>" +
        planned.map(p => esc(p.label)).join(", ") + ".</p>" : "") +
    (held.length
      ? "<h3>Held back</h3><p>" +
        held.map(p => esc(p.label) + " &mdash; " + esc(p.blurb || "")).join(" ") + "</p>" : "") +
    "<h3>How each tradition is built</h3>" +
    "<p>Figures are included when there is enough attested material to say something " +
    "about them, which is why the packs differ in size: padding a thin tradition out " +
    "to match a rich one would mean inventing. Where the sources disagree, both " +
    "readings are kept rather than reconciled, and where a story was composed after " +
    "the fact to serve someone's interest, the entry says so.</p>" +
    "<h3>Private collections</h3>" +
    "<p>Some collections are private. They are encrypted in the browser and cannot be " +
    "read without the passphrase, which is never transmitted. An unlock word reveals " +
    "that a collection exists; an account and passphrase are needed to open it.</p>" +
    "<p>Open any tradition to see its own sources, primary texts and dataset notes. " +
    "Built by Quiddity Innovations.</p>";
}

function buildAbout() {
  const d = APP.data;
  const b = d.books || {};
  $("#about-content").innerHTML =
    "<h2 id='about-title'>" + esc(d.title) + "</h2>" +
    "<p>" + esc(d.description) + "</p>" +
    '<div class="about-stats">' +
      '<div class="stat"><b>' + d.entities.length + "</b><span>Figures</span></div>" +
      '<div class="stat"><b>' + d.links.length + "</b><span>Relationships</span></div>" +
      '<div class="stat"><b>' + d.stories.length + "</b><span>Stories</span></div>" +
      '<div class="stat"><b>' + Object.keys(b).length + "</b><span>Source books</span></div>" +
    "</div>" +
    "<h3>Primary texts</h3><ul>" +
    Object.keys(b).map(k => '<li><a href="' + esc(b[k].u) + '" target="_blank" rel="noopener">' +
      esc(b[k].t) + "</a> " + '<span class="idx-muted">' + esc(b[k].tr) + "</span></li>").join("") + "</ul>" +
    "<h3>General references</h3><ul>" +
    (d.sources || []).map(s => "<li>" + esc(s) + "</li>").join("") + "</ul>" +
    "<h3>Portraits</h3><p>" + esc(d.portraitNote) + "</p>" +
    "<p>Dataset compiled " + esc(d.generated || "") + ". Built by Quiddity Innovations.</p>";
}
