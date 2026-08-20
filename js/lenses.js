/* ============================================================
   The non-graph lenses: Mind Map, Outline, Cards, Table, Figure.
   All five read the same model the Map lens reads.
   Mind Map and Outline draw a spanning tree, so cross-links are
   not visible in those two; the Map lens shows every relationship.
   ============================================================ */
"use strict";

/* ---------------- shared spanning tree ---------------- */

function buildTree(visibleOnly) {
  const ok = id => {
    const e = entity(id);
    return e && (!visibleOnly || nodeVisible(e));
  };
  const rootId = (APP.data.meta && APP.data.meta.root) || APP.data.entities[0].id;
  const parent = new Map(), children = new Map(), depth = new Map();
  const all = APP.data.entities.filter(e => !visibleOnly || nodeVisible(e)).map(e => e.id);
  const inTree = new Set();

  const start = ok(rootId) ? rootId : all[0];
  if (!start) return { root: null, parent, children, depth, order: [] };

  const queue = [start];
  inTree.add(start);
  depth.set(start, 0);
  children.set(start, []);

  while (queue.length) {
    const cur = queue.shift();
    const nb = Array.from(APP.neighbors.get(cur) || []).filter(ok).sort((a, b) => {
      const ea = entity(a), eb = entity(b);
      return (ea.hierarchyLevel || 0) - (eb.hierarchyLevel || 0) ||
             degree(b) - degree(a) || ea.name.localeCompare(eb.name);
    });
    nb.forEach(n => {
      if (inTree.has(n)) return;
      inTree.add(n);
      parent.set(n, cur);
      depth.set(n, depth.get(cur) + 1);
      children.set(cur, (children.get(cur) || []).concat(n));
      children.set(n, children.get(n) || []);
      queue.push(n);
    });
  }
  /* anything disconnected hangs directly off the root */
  all.forEach(id => {
    if (inTree.has(id)) return;
    inTree.add(id);
    parent.set(id, start);
    depth.set(id, 1);
    children.set(start, (children.get(start) || []).concat(id));
    children.set(id, []);
  });

  const order = [];
  (function walk(id) { order.push(id); (children.get(id) || []).forEach(walk); })(start);
  return { root: start, parent, children, depth, order };
}

function ancestorsOf(tree, id) {
  const out = [];
  let cur = tree.parent.get(id);
  while (cur) { out.push(cur); cur = tree.parent.get(cur); }
  return out;
}

/* ---------------- Mind Map ---------------- */

const MindMapLens = (function () {
  const DX = 210, DY = 26;
  let svg, gRoot, zoomB, tree, pos = new Map(), focusId = null, wired = false;

  function stageEl() { return $("#mm-stage"); }

  function layout() {
    tree = buildTree(true);
    pos = new Map();
    let y = 0;
    (function place(id) {
      const kids = tree.children.get(id) || [];
      if (!kids.length) {
        pos.set(id, { x: tree.depth.get(id) * DX, y: y });
        y += DY;
        return;
      }
      kids.forEach(place);
      const first = pos.get(kids[0]).y, last = pos.get(kids[kids.length - 1]).y;
      pos.set(id, { x: tree.depth.get(id) * DX, y: (first + last) / 2 });
    })(tree.root);
  }

  function render() {
    if (!tree || !tree.root) return;
    svg = d3.select("#mindmap");
    svg.selectAll("*").remove();
    gRoot = svg.append("g");

    if (!wired) {
      zoomB = d3.zoom().scaleExtent([0.15, 4]).on("zoom", ev => gRoot.attr("transform", ev.transform));
      $("#mm-in").addEventListener("click", () => svg.transition().duration(180).call(zoomB.scaleBy, 1.4));
      $("#mm-out").addEventListener("click", () => svg.transition().duration(180).call(zoomB.scaleBy, 1 / 1.4));
      $("#mm-fit").addEventListener("click", () => { focusId = null; paintState(); fit(400); });
      wired = true;
    }
    svg.call(zoomB).on("dblclick.zoom", null);

    const gEdges = gRoot.append("g");
    const gNodes = gRoot.append("g");

    tree.order.forEach(id => {
      const p = tree.parent.get(id);
      if (!p) return;
      const a = pos.get(p), b = pos.get(id);
      const mx = (a.x + b.x) / 2;
      gEdges.append("path")
        .attr("class", "mm-edge")
        .attr("data-id", id)
        .attr("d", "M" + a.x + "," + a.y + "C" + mx + "," + a.y + " " + mx + "," + b.y + " " + b.x + "," + b.y);
    });

    tree.order.forEach(id => {
      const e = entity(id), p = pos.get(id);
      const g = gNodes.append("g")
        .attr("class", "mm-node")
        .attr("data-id", id)
        .attr("transform", "translate(" + p.x + "," + p.y + ")")
        .attr("tabindex", 0)
        .attr("role", "button")
        .attr("aria-label", shortName(e) + ", " + e.role);
      g.append("circle").attr("class", "mm-dot").attr("r", 5).attr("fill", catColor(e.category));
      g.append("text").attr("class", "mm-label").attr("x", 10).attr("dy", "0.33em").text(shortName(e));
      g.on("click", () => { focusId = id; paintState(); centerOn(id); selectFigure(id); });
      g.on("dblclick", () => { setLens("figure"); Lenses.showFigure(id); });
      g.on("keydown", ev => {
        if (ev.key === "Enter" || ev.key === " ") {
          ev.preventDefault(); focusId = id; paintState(); centerOn(id); goTo(figureHash(id));
        }
      });
    });
    paintState();
  }

  function paintState() {
    if (!gRoot) return;
    const lit = new Set();
    if (focusId) {
      lit.add(focusId);
      (tree.children.get(focusId) || []).forEach(c => lit.add(c));
      ancestorsOf(tree, focusId).forEach(a => lit.add(a));
    }
    gRoot.selectAll(".mm-node")
      .classed("is-dim", function () { return focusId ? !lit.has(this.dataset.id) : false; })
      .classed("is-focus", function () { return this.dataset.id === focusId; });
    gRoot.selectAll(".mm-edge")
      .classed("is-dim", function () { return focusId ? !lit.has(this.dataset.id) : false; });
  }

  function setQuery(q) {
    if (!gRoot) return;
    const hits = q ? new Set(matchEntities(q).map(e => e.id)) : null;
    gRoot.selectAll(".mm-node")
      .classed("is-search-dim", function () { return hits ? !hits.has(this.dataset.id) : false; })
      .classed("is-search-hit", function () { return hits ? hits.has(this.dataset.id) : false; });
  }

  function fit(duration) {
    if (!svg || !pos.size) return;
    const st = stageEl();
    const w = st.clientWidth || 900, h = st.clientHeight || 600;
    const xs = [], ys = [];
    pos.forEach(p => { xs.push(p.x); ys.push(p.y); });
    const pad = 80;
    const minX = Math.min(...xs) - pad, maxX = Math.max(...xs) + pad + 120;
    const minY = Math.min(...ys) - pad, maxY = Math.max(...ys) + pad;
    const k = Math.min(1.2, 0.95 / Math.max((maxX - minX) / w, (maxY - minY) / h));
    const t = d3.zoomIdentity
      .translate(w / 2 - k * (minX + maxX) / 2, h / 2 - k * (minY + maxY) / 2).scale(k);
    (duration ? svg.transition().duration(duration) : svg).call(zoomB.transform, t);
  }

  function centerOn(id) {
    const p = pos.get(id);
    if (!p || !svg) return;
    const st = stageEl();
    const w = st.clientWidth || 900, h = st.clientHeight || 600;
    const k = Math.max(0.9, d3.zoomTransform(svg.node()).k);
    svg.transition().duration(450).call(zoomB.transform,
      d3.zoomIdentity.translate(w * 0.35 - k * p.x, h / 2 - k * p.y).scale(k));
  }

  function build() { layout(); render(); fit(0); }
  function focus(id) { if (!pos.has(id)) return; focusId = id; paintState(); centerOn(id); }

  return { build, focus, setQuery, fit, paintState };
})();

/* ---------------- Outline ---------------- */

const OutlineLens = (function () {
  let tree = null;

  function build() {
    tree = buildTree(true);
    if (!tree.root) { $("#outline-root").innerHTML = ""; return; }
    $("#outline-root").innerHTML = rowHtml(tree.root, 0);
    wire();
  }

  function rowHtml(id, depth) {
    const e = entity(id);
    const kids = tree.children.get(id) || [];
    const open = depth < 2;
    return '<div class="ol-item" data-id="' + esc(id) + '">' +
      '<div class="ol-row" style="--ol-depth:' + depth + '">' +
        (kids.length
          ? '<button type="button" class="ol-toggle" aria-expanded="' + (open ? "true" : "false") +
            '" aria-label="Toggle ' + esc(shortName(e)) + '">' + "</button>"
          : '<span class="ol-leaf" aria-hidden="true"></span>') +
        '<span class="cat-swatch" style="background:' + catColor(e.category) + '"></span>' +
        '<a class="ol-name" href="' + figureHash(id) + '">' + esc(shortName(e)) + "</a>" +
        '<span class="ol-role">' + esc(e.role) + "</span>" +
      "</div>" +
      '<p class="ol-bio" style="--ol-depth:' + depth + '">' + esc(e.bio || "") + "</p>" +
      (kids.length
        ? '<div class="ol-kids"' + (open ? "" : " hidden") + ">" +
          kids.map(k => rowHtml(k, depth + 1)).join("") + "</div>"
        : "") +
      "</div>";
  }

  function wire() {
    const root = $("#outline-root");
    root.onclick = ev => {
      const t = ev.target.closest(".ol-toggle");
      if (!t) return;
      const kids = t.closest(".ol-item").querySelector(".ol-kids");
      const open = t.getAttribute("aria-expanded") === "true";
      t.setAttribute("aria-expanded", open ? "false" : "true");
      if (kids) kids.hidden = open;
    };
    $("#outline-expand").onclick = () => setAll(true);
    $("#outline-collapse").onclick = () => setAll(false);
  }

  function setAll(open) {
    $$(".ol-toggle").forEach(t => t.setAttribute("aria-expanded", open ? "true" : "false"));
    $$(".ol-kids").forEach(k => { k.hidden = !open; });
  }

  function setQuery(q) {
    const root = $("#outline-root");
    if (!q) {
      $$(".ol-item", root).forEach(i => { i.hidden = false; i.classList.remove("is-hit"); });
      return;
    }
    const hits = new Set(matchEntities(q).map(e => e.id));
    $$(".ol-item", root).forEach(i => {
      const hit = hits.has(i.dataset.id);
      i.classList.toggle("is-hit", hit);
      i.hidden = !hit;
    });
    /* reveal each hit's ancestor path */
    hits.forEach(id => {
      const el = $('.ol-item[data-id="' + CSS.escape(id) + '"]', root);
      let p = el && el.parentElement;
      while (p && p !== root) {
        if (p.classList.contains("ol-item")) p.hidden = false;
        if (p.classList.contains("ol-kids")) p.hidden = false;
        p = p.parentElement;
      }
    });
  }

  function scrollTo(id) {
    const el = $('.ol-item[data-id="' + CSS.escape(id) + '"]');
    if (el) el.scrollIntoView({ block: "center", behavior: "smooth" });
  }

  return { build, setQuery, scrollTo };
})();

/* ---------------- Cards ---------------- */

const CardsLens = (function () {
  let catFilter = null, sort = "category", query = "";

  function build() {
    catFilter = null;
    $("#cards-cats").innerHTML =
      '<button type="button" class="era-chip" data-cat="" aria-pressed="true">All</button>' +
      presentCategories().map(c =>
        '<button type="button" class="era-chip" data-cat="' + esc(c) + '" aria-pressed="false">' +
        '<span class="cat-swatch" style="background:' + catColor(c) + '"></span>' + esc(catLabel(c)) + "</button>"
      ).join("");
    $("#cards-cats").onclick = ev => {
      const b = ev.target.closest(".era-chip");
      if (!b) return;
      catFilter = b.dataset.cat || null;
      $$(".era-chip", $("#cards-cats")).forEach(x => x.setAttribute("aria-pressed", x === b ? "true" : "false"));
      render();
    };
    $("#cards-sort").onchange = ev => { sort = ev.target.value; render(); };
    render();
  }

  function render() {
    let list = APP.data.entities.filter(nodeVisible);
    if (catFilter) list = list.filter(e => e.category === catFilter);
    if (query) {
      const hits = new Set(matchEntities(query).map(e => e.id));
      list = list.filter(e => hits.has(e.id));
    }
    list = list.slice().sort((a, b) => {
      if (sort === "name") return a.name.localeCompare(b.name);
      if (sort === "era") return a.era.localeCompare(b.era) || a.name.localeCompare(b.name);
      if (sort === "links") return degree(b.id) - degree(a.id) || a.name.localeCompare(b.name);
      return a.category.localeCompare(b.category) || a.name.localeCompare(b.name);
    });

    $("#cards-grid").innerHTML = list.map(e =>
      '<article class="fig-card" id="card-' + esc(e.id) + '" style="--band:' + catColor(e.category) + '">' +
        '<a class="fig-card-main" href="' + figureHash(e.id) + '">' +
          '<img src="' + esc(portraitPath(e)) + '" alt="Portrait of ' + esc(shortName(e)) +
            '" loading="lazy" decoding="async" width="62" height="62">' +
          "<div>" +
            '<h3 class="fig-card-name">' + esc(shortName(e)) + "</h3>" +
            '<p class="fig-card-native" lang="sa">' + esc(e.sanskrit || "") + "</p>" +
            '<p class="fig-card-role">' + esc(e.role) + "</p>" +
          "</div>" +
        "</a>" +
        '<div class="fig-card-meta">' +
          '<span class="mini-chip"><span class="cat-swatch" style="background:' + catColor(e.category) + '"></span>' +
            esc(catLabel(e.category)) + "</span>" +
          '<span class="mini-chip">' + esc(eraLabel(e.era)) + "</span>" +
          '<span class="mini-chip">' + degree(e.id) + " links</span>" +
        "</div>" +
        '<button type="button" class="card-add" data-id="' + esc(e.id) + '" aria-pressed="' +
          (APP.chart.has(e.id) ? "true" : "false") + '">Add to chart</button>' +
      "</article>"
    ).join("") || '<p class="pane-note">No figures match the current filters.</p>';

    $$(".card-add", $("#cards-grid")).forEach(b =>
      b.addEventListener("click", () => toggleChart(b.dataset.id)));
  }

  function setQuery(q) { query = q; render(); }
  function scrollTo(id) {
    const el = document.getElementById("card-" + id);
    if (el) el.scrollIntoView({ block: "center", behavior: "smooth" });
  }
  return { build, render, setQuery, scrollTo };
})();

/* ---------------- Table ---------------- */

const TableLens = (function () {
  let sortKey = "name", asc = true, query = "";

  function build() {
    $$(".sort-btn").forEach(btn => {
      btn.onclick = () => {
        const key = btn.dataset.sort;
        if (sortKey === key) asc = !asc; else { sortKey = key; asc = true; }
        render();
      };
    });
    render();
  }

  function render() {
    let rows = APP.data.entities.filter(nodeVisible);
    if (query) {
      const hits = new Set(matchEntities(query).map(e => e.id));
      rows = rows.filter(e => hits.has(e.id));
    }
    rows = rows.slice().sort((a, b) => {
      const av = String(a[sortKey] || "").toLowerCase(), bv = String(b[sortKey] || "").toLowerCase();
      return (av < bv ? -1 : av > bv ? 1 : 0) * (asc ? 1 : -1);
    });

    $$("#index-table th").forEach(th => th.removeAttribute("aria-sort"));
    const activeBtn = $('.sort-btn[data-sort="' + sortKey + '"]');
    if (activeBtn) activeBtn.closest("th").setAttribute("aria-sort", asc ? "ascending" : "descending");

    $("#index-tbody").innerHTML = rows.map(e =>
      '<tr id="row-' + esc(e.id) + '">' +
      '<td><img class="idx-portrait" src="' + esc(portraitPath(e)) + '" alt="" loading="lazy" decoding="async" width="40" height="40"></td>' +
      '<th scope="row"><a class="idx-name-btn" href="' + figureHash(e.id) + '">' + esc(e.name) + "</a>" +
        '<div class="idx-sanskrit" lang="sa">' + esc(e.sanskrit || "") + "</div></th>" +
      '<td><span class="idx-cat"><span class="cat-swatch" style="background:' + catColor(e.category) + '"></span>' +
        esc(catLabel(e.category)) + "</span></td>" +
      "<td>" + esc(eraLabel(e.era)) + "</td>" +
      '<td class="idx-muted">' + esc(e.role) + "</td>" +
      '<td class="idx-muted">' + esc(e.mount || "-") + "</td>" +
      '<td class="idx-muted">' + esc(e.abode || "-") + "</td>" +
      "</tr>"
    ).join("");
  }

  function setQuery(q) { query = q; render(); }
  function scrollTo(id) {
    const el = document.getElementById("row-" + id);
    if (el) el.scrollIntoView({ block: "center", behavior: "smooth" });
  }
  return { build, render, setQuery, scrollTo };
})();

/* ---------------- Figure lens ---------------- */

const FigureLens = (function () {
  function build() {
    const sel = $("#figure-picker");
    const cats = presentCategories();
    sel.innerHTML = cats.map(c =>
      '<optgroup label="' + esc(catLabel(c)) + '">' +
      APP.data.entities.filter(e => e.category === c)
        .sort((a, b) => a.name.localeCompare(b.name))
        .map(e => '<option value="' + esc(e.id) + '">' + esc(shortName(e)) + "</option>").join("") +
      "</optgroup>"
    ).join("");
    sel.onchange = () => show(sel.value);
    show(APP.selectedId || (APP.data.meta && APP.data.meta.root) || APP.data.entities[0].id);
  }

  function show(id) {
    const e = entity(id);
    if (!e) return;
    APP.selectedId = id;
    $("#figure-picker").value = id;
    const root = $("#figure-full");
    root.innerHTML = figureHtml(e, { full: true });
    wireFigureBody(root, e);
    root.scrollIntoView({ block: "nearest" });
  }

  return { build, show };
})();

/* ---------------- coordinator ---------------- */

const Lenses = (function () {
  let query = "";

  function reset() {
    APP.built = {};
    TableLens.build();
    if (APP.view === "map") onShow(APP.lens);
  }

  function onShow(lens) {
    if (lens === "mindmap" && !APP.built.mindmap) { MindMapLens.build(); APP.built.mindmap = true; }
    else if (lens === "outline" && !APP.built.outline) { OutlineLens.build(); APP.built.outline = true; }
    else if (lens === "cards" && !APP.built.cards) { CardsLens.build(); APP.built.cards = true; }
    else if (lens === "figure" && !APP.built.figure) { FigureLens.build(); APP.built.figure = true; }
    /* a lens that first laid out inside a hidden pane needs a re-fit */
    if (lens === "map") requestAnimationFrame(() => GraphLens.fit(0));
    if (lens === "mindmap") requestAnimationFrame(() => MindMapLens.fit(0));
    /* the side panel belongs to the graph lenses only */
    const wantsPanel = (lens === "map" || lens === "mindmap") && APP.selectedId;
    $("#panel").hidden = !wantsPanel;
    if (lens === "figure" && APP.selectedId && APP.built.figure) FigureLens.show(APP.selectedId);
  }

  function applyFilters() {
    if (APP.built.mindmap) MindMapLens.build();
    if (APP.built.outline) OutlineLens.build();
    if (APP.built.cards) CardsLens.render();
    TableLens.render();
  }

  function setQuery(q) {
    query = q;
    GraphLens.setQuery(q);
    if (APP.built.mindmap) MindMapLens.setQuery(q);
    if (APP.built.outline) OutlineLens.setQuery(q);
    if (APP.built.cards) CardsLens.setQuery(q);
    TableLens.setQuery(q);
  }
  function clearQuery() { if (query) setQuery(""); }

  /* Enter in the search box, per lens */
  function gotoMatch(id) {
    if (APP.lens === "mindmap") { MindMapLens.focus(id); selectFigure(id); }
    else if (APP.lens === "outline") OutlineLens.scrollTo(id);
    else if (APP.lens === "cards") CardsLens.scrollTo(id);
    else if (APP.lens === "table") TableLens.scrollTo(id);
    else if (APP.lens === "figure") FigureLens.show(id);
  }

  function showFigure(id) {
    if (!APP.built.figure) { FigureLens.build(); APP.built.figure = true; }
    FigureLens.show(id);
  }

  function onResize() {
    if (APP.lens === "map") GraphLens.resize();
    if (APP.lens === "mindmap") MindMapLens.fit(200);
  }

  return { reset, onShow, applyFilters, setQuery, clearQuery, gotoMatch, showFigure, onResize };
})();
