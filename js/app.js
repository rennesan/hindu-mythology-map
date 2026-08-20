/* ============================================================
   Hindu Mythology Relationship Map — v2 front end
   All content comes from data/dataset.json. Portraits are local.
   ============================================================ */
"use strict";

/* ---------------- constants ---------------- */

const CAT_COLORS = {
  cosmic: "#a78bfa", trimurti: "#eab308", tridevi: "#ec4899",
  deva: "#3b82f6", goddess: "#fb7185", avatar: "#2dd4bf",
  sage: "#a3e635", human: "#cd8b4a", asura: "#dc2626",
  naga: "#16a34a", celestial: "#67e8f9", vahana: "#f97316"
};
const CAT_LABELS = {
  cosmic: "Cosmic principle", trimurti: "Trimurti", tridevi: "Tridevi",
  deva: "Deva", goddess: "Goddess", avatar: "Avatar", sage: "Sage",
  human: "Human", asura: "Asura", naga: "Naga",
  celestial: "Celestial", vahana: "Vahana (mount)"
};
const ERAS = ["Cosmic", "Vedic", "Puranic", "Epic-Ramayana", "Epic-Mahabharata"];
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
/* Group headings in the figure panel, phrased from the selected figure's side.
   out = selected figure is the link's source, in = selected figure is the target. */
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
const REL_ORDER = ["avatar", "form", "consort", "parent", "foster", "sibling", "guru", "devotee", "mount", "ally", "enemy"];

/* ---------------- state ---------------- */

let DATA = null;
let byId = new Map();
let storyById = new Map();
let nodes = [], links = [];
let neighborSets = new Map();   // id -> Set of neighbor ids
let selectedId = null;
let currentView = "map";
let lastFocusEl = null;

const filters = {
  era: new Set(),        // empty = all
  category: new Set(),
  rel: new Set()
};

/* d3 handles */
let svg, gRoot, gLinks, gNodes, sim, zoomBehavior;
let nodeSel, edgeSel;

/* ---------------- utilities ---------------- */

const $ = (s, el) => (el || document).querySelector(s);
const $$ = (s, el) => Array.from((el || document).querySelectorAll(s));

function store(key, val) {
  try { localStorage.setItem(key, val); } catch (e) { /* private mode etc. */ }
}
function readStore(key) {
  try { return localStorage.getItem(key); } catch (e) { return null; }
}

function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function shortName(e) { return e.name.split(" (")[0]; }

function portraitPath(e) { return "portraits/" + e.id + ".webp"; }

function wikiUrl(e) {
  return "https://en.wikipedia.org/wiki/" + encodeURIComponent(e.wikipedia.replace(/ /g, "_"));
}

/* black or white letter depending on the disc color's luminance */
function letterInk(hex) {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return lum > 150 ? "#1c1608" : "#fdf8ec";
}

function nodeRadius(e) {
  const deg = neighborSets.get(e.id) ? neighborSets.get(e.id).size : 0;
  return Math.max(17, Math.min(34, 15 + deg * 1.15));
}

/* ---------------- boot ---------------- */

fetch("data/dataset.json")
  .then(r => {
    if (!r.ok) throw new Error("dataset fetch failed: " + r.status);
    return r.json();
  })
  .then(d => {
    DATA = d;
    indexData();
    buildLegend();
    buildFilters();
    buildGraph();
    buildStories();
    buildIndexTable();
    buildAbout();
    wireChrome();
    handleRoute();
    $("#graph-loading").remove();
  })
  .catch(err => {
    const el = $("#graph-loading");
    if (el) el.textContent = "The dataset could not be loaded. Please reload the page.";
    console.error(err);
  });

function indexData() {
  DATA.entities.forEach(e => byId.set(e.id, e));
  DATA.stories.forEach(s => storyById.set(s.id, s));
  nodes = DATA.entities.map(e => ({ ...e }));
  links = DATA.links.map(l => ({ ...l, source: l.from, target: l.to }));

  DATA.entities.forEach(e => neighborSets.set(e.id, new Set()));
  DATA.links.forEach(l => {
    neighborSets.get(l.from).add(l.to);
    neighborSets.get(l.to).add(l.from);
  });

  /* mark parallel edges between the same pair so they can curve apart */
  const pairCount = new Map();
  links.forEach(l => {
    const k = [l.from, l.to].sort().join("|");
    pairCount.set(k, (pairCount.get(k) || 0) + 1);
  });
  const pairSeen = new Map();
  links.forEach(l => {
    const k = [l.from, l.to].sort().join("|");
    const n = pairCount.get(k);
    if (n > 1) {
      const i = pairSeen.get(k) || 0;
      pairSeen.set(k, i + 1);
      l.curve = (i - (n - 1) / 2) * 22; /* perpendicular offset in px */
    } else {
      l.curve = 0;
    }
  });
}

/* ---------------- theme ---------------- */

function applyTheme(t) {
  document.documentElement.setAttribute("data-theme", t);
  store("hm-theme", t);
  $("#theme-toggle").setAttribute("aria-pressed", t === "light" ? "true" : "false");
}

/* ---------------- chrome: tabs, theme, about, esc ---------------- */

function wireChrome() {
  $("#theme-toggle").addEventListener("click", () => {
    const cur = document.documentElement.getAttribute("data-theme");
    applyTheme(cur === "dark" ? "light" : "dark");
  });
  $("#theme-toggle").setAttribute("aria-pressed",
    document.documentElement.getAttribute("data-theme") === "light" ? "true" : "false");

  $("#about-btn").addEventListener("click", () => $("#about-dialog").showModal());
  $("#about-close").addEventListener("click", () => $("#about-dialog").close());

  $("#lightbox-close").addEventListener("click", () => $("#lightbox").close());
  $("#lightbox").addEventListener("click", ev => {
    if (ev.target === $("#lightbox")) $("#lightbox").close();
  });

  $("#panel-close").addEventListener("click", () => clearSelection(true));

  document.addEventListener("keydown", ev => {
    if (ev.key === "Escape") {
      /* native <dialog> handles its own Escape; do not also close the panel */
      if ($("#lightbox").open || $("#about-dialog").open) return;
      if (!$("#search-list").hidden) { closeSearchList(); return; }
      const openPop = $$(".filter-pop").find(p => !p.hidden);
      if (openPop) { closeFilterPops(); return; }
      if (selectedId) clearSelection(true);
    }
  });

  window.addEventListener("hashchange", handleRoute);
  wireSearch();
}

/* ---------------- routing ---------------- */

function handleRoute() {
  const h = location.hash || "#/map";
  const parts = h.replace(/^#\/?/, "").split("/");
  const head = parts[0] || "map";

  if (head === "figure" && parts[1] && byId.has(parts[1])) {
    showView("map");
    selectFigure(parts[1], { fromRoute: true });
  } else if (head === "stories" || head === "story") {
    showView("stories");
    if (head === "story" && parts[1]) {
      const card = document.getElementById("story-" + parts[1]);
      if (card) {
        card.scrollIntoView({ block: "start", behavior: "smooth" });
        card.focus({ preventScroll: true });
      }
    }
  } else if (head === "index") {
    showView("index");
  } else {
    showView("map");
    if (selectedId) clearSelection(false);
  }
}

function showView(name) {
  currentView = name;
  ["map", "stories", "index"].forEach(v => {
    $("#view-" + v).hidden = v !== name;
  });
  $$(".tab[data-view]").forEach(t => {
    if (t.dataset.view === name) t.setAttribute("aria-current", "page");
    else t.removeAttribute("aria-current");
  });
  if (name === "map" && sim) sim.restart();
}

function goTo(hash) {
  if (location.hash === hash) handleRoute();
  else location.hash = hash;
}

/* ---------------- legend ---------------- */

function edgeSampleSvg(type, w) {
  const width = w || 44;
  const marker = REL_DIRECTIONAL.has(type)
    ? '<path class="m-' + type + '" d="M' + (width - 8) + ',3 L' + width + ',7 L' + (width - 8) + ',11 Z"></path>' : "";
  return '<svg width="' + width + '" height="14" aria-hidden="true">' +
    '<line class="edge ' + type + ' is-lit" x1="1" y1="7" x2="' + (width - (marker ? 9 : 1)) + '" y2="7"></line>' +
    marker + "</svg>";
}

function buildLegend() {
  $("#legend-rels").innerHTML = Object.keys(DATA.relationshipTypes).map(t =>
    "<li>" + edgeSampleSvg(t) + "<span>" + esc(REL_LABELS[t] || t) + "</span></li>"
  ).join("");
  $("#legend-cats").innerHTML = Object.keys(CAT_COLORS)
    .filter(c => DATA.entities.some(e => e.category === c))
    .map(c =>
      '<li><span class="cat-swatch" style="background:' + CAT_COLORS[c] + '"></span><span>' +
      esc(CAT_LABELS[c] || c) + "</span></li>"
    ).join("");
  if (window.matchMedia("(min-width: 701px)").matches) $("#legend").open = true;
}

/* ---------------- filters ---------------- */

function buildFilters() {
  buildFilterPop("era", ERAS.map(e => ({ value: e, label: ERA_LABELS[e] })));
  buildFilterPop("category",
    Object.keys(CAT_LABELS).filter(c => DATA.entities.some(e => e.category === c))
      .map(c => ({ value: c, label: CAT_LABELS[c], swatch: CAT_COLORS[c] })));
  buildFilterPop("rel",
    Object.keys(DATA.relationshipTypes).map(t => ({ value: t, label: REL_LABELS[t] || t, edge: t })));

  $("#filter-reset").addEventListener("click", () => {
    filters.era.clear(); filters.category.clear(); filters.rel.clear();
    $$(".filter-pop input[type=checkbox]").forEach(cb => { cb.checked = false; });
    applyFilters();
  });

  document.addEventListener("click", ev => {
    if (!ev.target.closest(".filter-group")) closeFilterPops();
  });
}

function buildFilterPop(kind, items) {
  const group = $('.filter-group[data-filter="' + kind + '"]');
  const btn = $(".filter-btn", group);
  const pop = $(".filter-pop", group);

  pop.innerHTML = items.map(it => {
    let deco = "";
    if (it.swatch) deco = '<span class="cat-swatch" style="background:' + it.swatch + '"></span>';
    if (it.edge) deco = edgeSampleSvg(it.edge, 30);
    return '<label>' +
      '<input type="checkbox" value="' + esc(it.value) + '">' + deco +
      "<span>" + esc(it.label) + "</span></label>";
  }).join("") +
  '<div class="pop-actions"><button type="button" data-act="all">Select all</button>' +
  '<button type="button" data-act="none">Clear</button></div>';

  btn.addEventListener("click", () => {
    const open = pop.hidden;
    closeFilterPops();
    if (open) { pop.hidden = false; btn.setAttribute("aria-expanded", "true"); }
  });

  pop.addEventListener("change", () => {
    const set = filters[kind];
    set.clear();
    $$("input[type=checkbox]", pop).forEach(cb => { if (cb.checked) set.add(cb.value); });
    applyFilters();
  });
  pop.addEventListener("click", ev => {
    const act = ev.target.dataset && ev.target.dataset.act;
    if (!act) return;
    $$("input[type=checkbox]", pop).forEach(cb => { cb.checked = act === "all"; });
    pop.dispatchEvent(new Event("change"));
  });
}

function closeFilterPops() {
  $$(".filter-pop").forEach(p => { p.hidden = true; });
  $$(".filter-btn").forEach(b => b.setAttribute("aria-expanded", "false"));
}

function nodeVisible(e) {
  if (filters.era.size && !filters.era.has(e.era)) return false;
  if (filters.category.size && !filters.category.has(e.category)) return false;
  return true;
}
function edgeVisible(l) {
  if (filters.rel.size && !filters.rel.has(l.type)) return false;
  return nodeVisible(byId.get(l.from)) && nodeVisible(byId.get(l.to));
}

function applyFilters() {
  let shown = 0;
  nodeSel.classed("is-hidden", d => {
    const v = nodeVisible(d);
    if (v) shown++;
    return !v;
  });
  edgeSel.classed("is-hidden", d => !edgeVisible(d));

  ["era", "category", "rel"].forEach(kind => {
    const group = $('.filter-group[data-filter="' + kind + '"]');
    const badge = $(".filter-count", group);
    const n = filters[kind].size;
    badge.hidden = n === 0;
    badge.textContent = n;
  });
  const active = filters.era.size + filters.category.size + filters.rel.size > 0;
  $("#filter-reset").hidden = !active;
  $("#filter-status").textContent = active
    ? "Showing " + shown + " of " + nodes.length + " figures"
    : nodes.length + " figures, " + links.length + " relationships";

  if (selectedId && !nodeVisible(byId.get(selectedId))) clearSelection(false);
  else refreshDimming();
}

/* ---------------- graph ---------------- */

function buildGraph() {
  const stage = $(".graph-stage");
  const W = () => stage.clientWidth;
  const H = () => stage.clientHeight;

  svg = d3.select("#graph");
  const defs = svg.append("defs");
  Object.keys(DATA.relationshipTypes).forEach(t => {
    if (!REL_DIRECTIONAL.has(t)) return;
    defs.append("marker")
      .attr("id", "arrow-" + t)
      .attr("viewBox", "0 0 10 10")
      .attr("refX", 9).attr("refY", 5)
      .attr("markerWidth", 7).attr("markerHeight", 7)
      .attr("orient", "auto-start-reverse")
      .append("path")
      .attr("class", "m-" + t)
      .attr("d", "M0,0 L10,5 L0,10 Z");
  });

  gRoot = svg.append("g");
  gLinks = gRoot.append("g").attr("aria-hidden", "true");
  gNodes = gRoot.append("g");

  /* zoom + pan */
  zoomBehavior = d3.zoom()
    .scaleExtent([0.2, 5])
    .on("zoom", ev => gRoot.attr("transform", ev.transform))
    .on("start", () => svg.classed("grabbing", true))
    .on("end", () => svg.classed("grabbing", false));
  svg.call(zoomBehavior).on("dblclick.zoom", null);

  $("#zoom-in").addEventListener("click", () => svg.transition().duration(200).call(zoomBehavior.scaleBy, 1.45));
  $("#zoom-out").addEventListener("click", () => svg.transition().duration(200).call(zoomBehavior.scaleBy, 1 / 1.45));
  $("#zoom-fit").addEventListener("click", () => fitView(450));

  /* edges as paths */
  edgeSel = gLinks.selectAll("path")
    .data(links)
    .join("path")
    .attr("class", d => "edge " + d.type)
    .attr("marker-end", d => REL_DIRECTIONAL.has(d.type) ? "url(#arrow-" + d.type + ")" : null);
  edgeSel.append("title").text(d => edgeDescription(d));

  /* nodes: portrait in a category-colored ring */
  nodeSel = gNodes.selectAll("g")
    .data(nodes, d => d.id)
    .join("g")
    .attr("class", "node")
    .attr("tabindex", 0)
    .attr("role", "button")
    .attr("aria-label", d => shortName(d) + ", " + d.role + ". Press Enter for details.");

  nodeSel.append("circle")
    .attr("class", "halo")
    .attr("r", d => nodeRadius(d) + 7);
  nodeSel.append("circle")
    .attr("class", "ring")
    .attr("r", d => nodeRadius(d) + 2.5)
    .attr("stroke", d => CAT_COLORS[d.category] || "#999");

  /* letter medallion: category-colored disc with the figure's initial */
  nodeSel.append("circle")
    .attr("class", "medallion")
    .attr("r", d => nodeRadius(d))
    .attr("fill", d => CAT_COLORS[d.category] || "#999");

  nodeSel.append("text")
    .attr("class", "initial")
    .attr("dy", "0.36em")
    .attr("fill", d => letterInk(CAT_COLORS[d.category] || "#999"))
    .style("font-size", d => Math.round(nodeRadius(d) * 1.05) + "px")
    .text(d => shortName(d).charAt(0));

  nodeSel.append("circle")
    .attr("class", "focus-ring")
    .attr("r", d => nodeRadius(d) + 11);

  nodeSel.append("text")
    .attr("class", "nlabel")
    .attr("y", d => nodeRadius(d) + 15)
    .text(d => shortName(d));

  /* interactions */
  nodeSel.on("click", (ev, d) => {
    if (ev.defaultPrevented) return;
    lastFocusEl = ev.currentTarget;
    goTo("#/figure/" + d.id);
  });
  nodeSel.on("keydown", (ev, d) => {
    if (ev.key === "Enter" || ev.key === " ") {
      ev.preventDefault();
      lastFocusEl = ev.currentTarget;
      goTo("#/figure/" + d.id);
    }
  });

  nodeSel.call(d3.drag()
    .on("start", (ev, d) => {
      if (!ev.active) sim.alphaTarget(0.25).restart();
      d.fx = d.x; d.fy = d.y;
    })
    .on("drag", (ev, d) => { d.fx = ev.x; d.fy = ev.y; })
    .on("end", (ev, d) => {
      if (!ev.active) sim.alphaTarget(0);
      d.fx = null; d.fy = null;
    }));

  /* simulation: tuned from the v1 mechanics that worked, scaled for portraits */
  sim = d3.forceSimulation(nodes)
    .force("link", d3.forceLink(links).id(d => d.id)
      .distance(l => l.type === "avatar" ? 130 : (l.type === "parent" ? 112 : 100))
      .strength(0.3))
    .force("charge", d3.forceManyBody().strength(-520))
    .force("center", d3.forceCenter(W() / 2, H() / 2))
    .force("collide", d3.forceCollide().radius(d => nodeRadius(d) + 20))
    .force("x", d3.forceX(W() / 2).strength(0.05))
    .force("y", d3.forceY(H() / 2).strength(0.06))
    .on("tick", tick);

  /* settle the layout before first paint so it does not fly around */
  sim.stop();
  for (let i = 0; i < 180; i++) sim.tick();
  tick();
  sim.alpha(0.15).restart();
  fitView(0);

  window.addEventListener("resize", () => {
    sim.force("center", d3.forceCenter(W() / 2, H() / 2));
    sim.force("x", d3.forceX(W() / 2).strength(0.05));
    sim.force("y", d3.forceY(H() / 2).strength(0.06));
    sim.alpha(0.12).restart();
  });

  applyFilters();
}

function tick() {
  edgeSel.attr("d", d => {
    const sx = d.source.x, sy = d.source.y, tx = d.target.x, ty = d.target.y;
    const dx = tx - sx, dy = ty - sy;
    const dist = Math.hypot(dx, dy) || 1;
    const ux = dx / dist, uy = dy / dist;
    const rs = nodeRadius(d.source) + 3;
    const rt = nodeRadius(d.target) + (REL_DIRECTIONAL.has(d.type) ? 10 : 3);
    const x1 = sx + ux * rs, y1 = sy + uy * rs;
    const x2 = tx - ux * rt, y2 = ty - uy * rt;
    if (!d.curve) return "M" + x1 + "," + y1 + "L" + x2 + "," + y2;
    const mx = (x1 + x2) / 2 - uy * d.curve;
    const my = (y1 + y2) / 2 + ux * d.curve;
    return "M" + x1 + "," + y1 + "Q" + mx + "," + my + " " + x2 + "," + y2;
  });
  nodeSel.attr("transform", d => "translate(" + d.x + "," + d.y + ")");
}

function edgeDescription(l) {
  const s = shortName(byId.get(l.from)), t = shortName(byId.get(l.to));
  const map = {
    parent: s + " is a parent of " + t,
    consort: s + " and " + t + " are consorts",
    sibling: s + " and " + t + " are siblings",
    avatar: t + " is an avatar of " + s,
    form: t + " is a form of " + s,
    enemy: s + " and " + t + " are adversaries",
    devotee: s + " is a devotee of " + t,
    mount: s + " is the mount of " + t,
    guru: s + " is the guru of " + t,
    foster: s + " is a foster parent of " + t,
    ally: s + " and " + t + " are allies"
  };
  let out = map[l.type] || (s + " - " + l.type + " - " + t);
  if (l.note) out += " (" + l.note + ")";
  return out;
}

function fitView(duration) {
  const stage = $(".graph-stage");
  const vis = nodes.filter(nodeVisible);
  if (!vis.length) return;
  const pad = 60;
  const xs = vis.map(d => d.x), ys = vis.map(d => d.y);
  const minX = Math.min(...xs) - pad, maxX = Math.max(...xs) + pad;
  const minY = Math.min(...ys) - pad, maxY = Math.max(...ys) + pad;
  const w = stage.clientWidth, h = stage.clientHeight;
  const k = Math.min(2, 0.95 / Math.max((maxX - minX) / w, (maxY - minY) / h));
  const tx = w / 2 - k * (minX + maxX) / 2;
  const ty = h / 2 - k * (minY + maxY) / 2;
  const t = d3.zoomIdentity.translate(tx, ty).scale(k);
  (duration ? svg.transition().duration(duration) : svg).call(zoomBehavior.transform, t);
}

function centerOnNode(d) {
  const stage = $(".graph-stage");
  const w = stage.clientWidth, h = stage.clientHeight;
  const isMobile = window.matchMedia("(max-width: 700px)").matches;
  /* leave room for the panel: right side on desktop, bottom sheet on mobile */
  const cx = isMobile ? w / 2 : Math.max(w * 0.32, (w - 430) / 2);
  const cy = isMobile ? h * 0.3 : h / 2;
  const k = Math.max(1.05, d3.zoomTransform(svg.node()).k);
  const t = d3.zoomIdentity.translate(cx - k * d.x, cy - k * d.y).scale(k);
  svg.transition().duration(500).call(zoomBehavior.transform, t);
}

/* ---------------- selection / focus mode ---------------- */

function selectFigure(id, opts) {
  opts = opts || {};
  selectedId = id;
  refreshDimming();
  renderPanel(byId.get(id));
  const panel = $("#panel");
  panel.hidden = false;
  const d = nodes.find(n => n.id === id);
  if (d && currentView === "map") centerOnNode(d);
  panel.focus({ preventScroll: true });
  $(".panel-scroll").scrollTop = 0;
}

function clearSelection(updateHash) {
  selectedId = null;
  $("#panel").hidden = true;
  refreshDimming();
  if (updateHash && location.hash.startsWith("#/figure/")) {
    history.pushState("", document.title, location.pathname + "#/map");
  }
  if (lastFocusEl && document.contains(lastFocusEl)) {
    lastFocusEl.focus();
    lastFocusEl = null;
  }
}

function refreshDimming() {
  if (!selectedId) {
    nodeSel.classed("is-dim", false).classed("is-selected", false);
    edgeSel.classed("is-dim", false).classed("is-lit", false);
    return;
  }
  const nb = neighborSets.get(selectedId) || new Set();
  nodeSel
    .classed("is-selected", d => d.id === selectedId)
    .classed("is-dim", d => d.id !== selectedId && !nb.has(d.id));
  edgeSel
    .classed("is-lit", d => d.from === selectedId || d.to === selectedId)
    .classed("is-dim", d => d.from !== selectedId && d.to !== selectedId);
}

/* ---------------- figure panel ---------------- */

function chipHtml(text, swatchColor) {
  const sw = swatchColor ? '<span class="cat-swatch" style="background:' + swatchColor + '"></span>' : "";
  return '<span class="chip">' + sw + esc(text) + "</span>";
}

function listSection(title, items) {
  if (!items || !items.length) return "";
  return '<section class="fig-section"><h3 class="fig-h">' + esc(title) + '</h3>' +
    '<ul class="fig-list">' + items.map(i => "<li>" + esc(i) + "</li>").join("") + "</ul></section>";
}

function renderPanel(e) {
  const rels = collectRelations(e.id);
  const relHtml = REL_ORDER.map(type => {
    const groups = rels[type];
    if (!groups) return "";
    return Object.keys(groups).map(heading => {
      const entries = groups[heading];
      return '<div class="rel-group">' +
        '<h4 class="rel-type-h">' + edgeSampleSvg(type, 30) + esc(heading) + "</h4>" +
        '<div class="rel-links">' + entries.map(en => {
          const o = byId.get(en.id);
          return '<a class="rel-chip" href="#/figure/' + esc(o.id) + '">' +
            '<img src="' + portraitPath(o) + '" alt="" loading="lazy" width="24" height="24">' +
            "<span>" + esc(shortName(o)) + "</span>" +
            (en.note ? '<span class="rel-note">' + esc(en.note) + "</span>" : "") +
            "</a>";
        }).join("") + "</div></div>";
    }).join("");
  }).join("");

  const stories = (e.storyIds || []).map(id => storyById.get(id)).filter(Boolean);

  const quickFacts = [];
  if (e.mount) quickFacts.push(["Mount", e.mount]);
  if (e.abode) quickFacts.push(["Abode", e.abode]);
  if (quickFacts.length === 1) quickFacts[0][2] = true;
  if (e.festivals && e.festivals.length) quickFacts.push(["Festivals", e.festivals.join(", "), true]);

  $("#panel-content").innerHTML =
    '<header class="fig-hero">' +
      '<div class="fig-hero-text">' +
        '<h2 class="fig-name">' + esc(e.name) + "</h2>" +
        '<p class="fig-sanskrit" lang="sa">' + esc(e.sanskrit || "") + "</p>" +
        '<p class="fig-role">' + esc(e.role) + "</p>" +
        '<div class="fig-chips">' +
          chipHtml(CAT_LABELS[e.category] || e.category, CAT_COLORS[e.category]) +
          chipHtml(ERA_LABELS[e.era] || e.era) +
        "</div>" +
      "</div>" +
      '<button type="button" class="fig-portrait-btn" aria-label="Expand the portrait of ' + esc(shortName(e)) + '">' +
        '<img class="fig-portrait" src="' + portraitPath(e) + '" alt="Portrait of ' + esc(shortName(e)) + '" width="120" height="120">' +
        '<span class="fig-expand-hint" aria-hidden="true">&#8599;</span>' +
      "</button>" +
    "</header>" +
    '<div class="fig-body">' +
      (quickFacts.length
        ? '<dl class="fig-quickfacts">' + quickFacts.map(f =>
            '<div class="qf' + (f[2] ? " qf-wide" : "") + '"><dt>' + esc(f[0]) + "</dt><dd>" + esc(f[1]) + "</dd></div>"
          ).join("") + "</dl>"
        : "") +
      listSection("Epithets", e.epithets) +
      listSection("Domains", e.domains) +
      listSection("Symbols", e.symbols) +
      (e.longBio
        ? '<section class="fig-section"><h3 class="fig-h">The Figure</h3>' +
          e.longBio.split(/\n+/).map(p => '<p class="fig-prose">' + esc(p) + "</p>").join("") + "</section>"
        : "") +
      (e.worship
        ? '<section class="fig-section"><h3 class="fig-h">Worship</h3><p class="fig-prose">' + esc(e.worship) + "</p></section>"
        : "") +
      (e.variantTraditions
        ? '<section class="fig-section"><h3 class="fig-h">Variant Traditions</h3><p class="fig-note">' + esc(e.variantTraditions) + "</p></section>"
        : "") +
      (relHtml
        ? '<section class="fig-section"><h3 class="fig-h">Relationships</h3>' + relHtml + "</section>"
        : "") +
      (stories.length
        ? '<section class="fig-section"><h3 class="fig-h">Appears In</h3><ul class="story-link-list">' +
          stories.map(s =>
            '<li><button type="button" class="story-link" data-story="' + esc(s.id) + '">' + esc(s.title) + "</button></li>"
          ).join("") + "</ul></section>"
        : "") +
      '<a class="fig-wiki" href="' + wikiUrl(e) + '" target="_blank" rel="noopener">Read more on Wikipedia <span aria-hidden="true">&#8599;</span></a>' +
    "</div>";

  $$(".story-link", $("#panel-content")).forEach(btn => {
    btn.addEventListener("click", () => goTo("#/story/" + btn.dataset.story));
  });

  $(".fig-portrait-btn", $("#panel-content")).addEventListener("click", () => openLightbox(e));
}

/* ---------------- portrait lightbox ---------------- */

function openLightbox(e) {
  const lb = $("#lightbox");
  $("#lightbox-img").src = portraitPath(e);
  $("#lightbox-img").alt = "Portrait of " + shortName(e) + ", full illustration";
  $("#lightbox-caption").textContent = shortName(e) + " - original illustration in classical Indian miniature style";
  lb.showModal();
}

/* Group this figure's links: type -> heading -> [{id, note}] */
function collectRelations(id) {
  const out = {};
  DATA.links.forEach(l => {
    if (l.from !== id && l.to !== id) return;
    const dirKey = l.from === id ? "out" : "in";
    const otherId = l.from === id ? l.to : l.from;
    const heading = REL_GROUPS[l.type][dirKey];
    out[l.type] = out[l.type] || {};
    out[l.type][heading] = out[l.type][heading] || [];
    out[l.type][heading].push({ id: otherId, note: l.note });
  });
  return out;
}

/* ---------------- search ---------------- */

function wireSearch() {
  const input = $("#search-input");
  const list = $("#search-list");
  const combo = $("#search-combo");
  let items = [];
  let active = -1;

  function closeList() {
    list.hidden = true;
    combo.setAttribute("aria-expanded", "false");
    input.removeAttribute("aria-activedescendant");
    active = -1;
  }
  window.closeSearchList = closeList;

  function pick(id) {
    closeList();
    input.value = "";
    goTo("#/figure/" + id);
  }

  function render(matches) {
    items = matches;
    if (!matches.length) {
      list.innerHTML = '<li class="s-empty" role="option" aria-disabled="true">No figures match</li>';
    } else {
      list.innerHTML = matches.map((e, i) =>
        '<li id="s-opt-' + i + '" role="option" data-id="' + esc(e.id) + '" aria-selected="false">' +
        '<img src="' + portraitPath(e) + '" alt="" loading="lazy" width="34" height="34">' +
        '<span><span class="s-name">' + esc(shortName(e)) + '</span><br><span class="s-role">' + esc(e.role) + "</span></span></li>"
      ).join("");
    }
    list.hidden = false;
    combo.setAttribute("aria-expanded", "true");
  }

  function setActive(i) {
    active = i;
    $$("li", list).forEach((li, j) => li.setAttribute("aria-selected", j === i ? "true" : "false"));
    if (i >= 0) {
      input.setAttribute("aria-activedescendant", "s-opt-" + i);
      const li = $("#s-opt-" + i);
      if (li) li.scrollIntoView({ block: "nearest" });
    }
  }

  input.addEventListener("input", () => {
    const q = input.value.trim().toLowerCase();
    if (q.length < 1) { closeList(); return; }
    const scored = [];
    DATA.entities.forEach(e => {
      const name = e.name.toLowerCase();
      let score = -1;
      if (name.startsWith(q)) score = 0;
      else if (name.includes(q)) score = 1;
      else if (e.role.toLowerCase().includes(q)) score = 2;
      else if ((e.epithets || []).some(ep => ep.toLowerCase().includes(q))) score = 3;
      if (score >= 0) scored.push([score, e]);
    });
    scored.sort((a, b) => a[0] - b[0] || a[1].name.localeCompare(b[1].name));
    render(scored.slice(0, 8).map(s => s[1]));
    setActive(-1);
  });

  input.addEventListener("keydown", ev => {
    if (list.hidden) return;
    if (ev.key === "ArrowDown") { ev.preventDefault(); setActive(Math.min(items.length - 1, active + 1)); }
    else if (ev.key === "ArrowUp") { ev.preventDefault(); setActive(Math.max(0, active - 1)); }
    else if (ev.key === "Enter") {
      ev.preventDefault();
      if (active >= 0 && items[active]) pick(items[active].id);
      else if (items.length === 1) pick(items[0].id);
    }
  });

  list.addEventListener("click", ev => {
    const li = ev.target.closest("li[data-id]");
    if (li) pick(li.dataset.id);
  });

  document.addEventListener("click", ev => {
    if (!ev.target.closest(".search")) closeList();
  });
}

/* ---------------- stories view ---------------- */

let storyEraFilter = null;

function buildStories() {
  const eras = Array.from(new Set(DATA.stories.map(s => s.era)));
  const eraOrder = ERAS.filter(e => eras.includes(e));
  $("#story-eras").innerHTML =
    '<button type="button" class="era-chip" data-era="" aria-pressed="true">All eras</button>' +
    eraOrder.map(e =>
      '<button type="button" class="era-chip" data-era="' + esc(e) + '" aria-pressed="false">' + esc(ERA_LABELS[e] || e) + "</button>"
    ).join("");

  $("#story-eras").addEventListener("click", ev => {
    const btn = ev.target.closest(".era-chip");
    if (!btn) return;
    storyEraFilter = btn.dataset.era || null;
    $$(".era-chip", $("#story-eras")).forEach(b =>
      b.setAttribute("aria-pressed", b === btn ? "true" : "false"));
    renderStories();
  });

  renderStories();
}

function renderStories() {
  const list = DATA.stories.filter(s => !storyEraFilter || s.era === storyEraFilter);
  $("#stories-grid").innerHTML = list.map(s => {
    const cast = s.cast.map(id => byId.get(id)).filter(Boolean);
    return '<article class="story-card" id="story-' + esc(s.id) + '" tabindex="-1" aria-labelledby="st-' + esc(s.id) + '">' +
      '<div class="story-card-h">' +
        '<h3 class="story-title" id="st-' + esc(s.id) + '">' + esc(s.title) + "</h3>" +
        '<span class="story-era">' + esc(ERA_LABELS[s.era] || s.era) + "</span>" +
      "</div>" +
      '<p class="story-summary">' + esc(s.summary) + "</p>" +
      '<div class="story-cast" role="group" aria-label="Cast of ' + esc(s.title) + '">' +
        cast.map(c =>
          '<a class="cast-chip" href="#/figure/' + esc(c.id) + '">' +
          '<img src="' + portraitPath(c) + '" alt="" loading="lazy" decoding="async" width="26" height="26">' +
          "<span>" + esc(shortName(c)) + "</span></a>"
        ).join("") +
      "</div>" +
      '<div class="story-sources"><h4 class="story-sources-h">Sources</h4><ul>' +
        s.sources.map(src =>
          '<li><a href="' + esc(src.url) + '" target="_blank" rel="noopener">' + esc(src.book) + "</a>" +
          ' <span class="src-loc">' + esc(src.location) + " &middot; " + esc(src.translation) + "</span></li>"
        ).join("") +
      "</ul></div></article>";
  }).join("");
}

/* ---------------- index view ---------------- */

let sortKey = "name", sortAsc = true;

function buildIndexTable() {
  renderIndexRows();
  $$(".sort-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const key = btn.dataset.sort;
      if (sortKey === key) sortAsc = !sortAsc;
      else { sortKey = key; sortAsc = true; }
      renderIndexRows();
    });
  });
}

function renderIndexRows() {
  const rows = DATA.entities.slice().sort((a, b) => {
    const av = (a[sortKey] || "").toLowerCase(), bv = (b[sortKey] || "").toLowerCase();
    return (av < bv ? -1 : av > bv ? 1 : 0) * (sortAsc ? 1 : -1);
  });
  $$("th", $("#index-table")).forEach(th => th.removeAttribute("aria-sort"));
  const activeBtn = $('.sort-btn[data-sort="' + sortKey + '"]');
  if (activeBtn) activeBtn.closest("th").setAttribute("aria-sort", sortAsc ? "ascending" : "descending");

  $("#index-tbody").innerHTML = rows.map(e =>
    "<tr>" +
    '<td><img class="idx-portrait" src="' + portraitPath(e) + '" alt="" loading="lazy" decoding="async" width="40" height="40"></td>' +
    '<th scope="row"><button type="button" class="idx-name-btn" data-id="' + esc(e.id) + '">' + esc(e.name) + '</button>' +
      '<div class="idx-sanskrit" lang="sa">' + esc(e.sanskrit || "") + "</div></th>" +
    '<td><span class="idx-cat"><span class="cat-swatch" style="background:' + (CAT_COLORS[e.category] || "#999") + '"></span>' +
      esc(CAT_LABELS[e.category] || e.category) + "</span></td>" +
    "<td>" + esc(ERA_LABELS[e.era] || e.era) + "</td>" +
    '<td class="idx-muted">' + esc(e.role) + "</td>" +
    '<td class="idx-muted">' + esc(e.mount || "-") + "</td>" +
    '<td class="idx-muted">' + esc(e.abode || "-") + "</td>" +
    "</tr>"
  ).join("");

  $$(".idx-name-btn", $("#index-tbody")).forEach(btn => {
    btn.addEventListener("click", () => goTo("#/figure/" + btn.dataset.id));
  });
}

/* ---------------- about ---------------- */

function buildAbout() {
  const b = DATA.books || {};
  $("#about-content").innerHTML =
    "<h2>" + esc(DATA.title) + "</h2>" +
    "<p>" + esc(DATA.description) + "</p>" +
    '<div class="about-stats">' +
      '<div class="stat"><b>' + DATA.entities.length + "</b><span>Figures</span></div>" +
      '<div class="stat"><b>' + DATA.links.length + "</b><span>Relationships</span></div>" +
      '<div class="stat"><b>' + DATA.stories.length + "</b><span>Stories</span></div>" +
      '<div class="stat"><b>' + Object.keys(b).length + "</b><span>Source books</span></div>" +
    "</div>" +
    "<h3>Primary texts</h3><ul>" +
    Object.keys(b).map(k =>
      '<li><a href="' + esc(b[k].u) + '" target="_blank" rel="noopener">' + esc(b[k].t) + "</a> " +
      '<span class="idx-muted">' + esc(b[k].tr) + "</span></li>"
    ).join("") + "</ul>" +
    "<h3>General references</h3><ul>" +
    (DATA.sources || []).map(s => "<li>" + esc(s) + "</li>").join("") + "</ul>" +
    "<h3>Portraits</h3><p>" + esc(DATA.portraitNote) + "</p>" +
    "<p>Dataset compiled " + esc(DATA.generated || "") + ". Built by Quiddity Innovations.</p>";
}
