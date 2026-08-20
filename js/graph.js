/* ============================================================
   Map lens — force-directed relationship graph (D3 v7).
   Nodes are category-colored medallions carrying the figure's initial.
   ============================================================ */
"use strict";

const GraphLens = (function () {
  let svg, gRoot, gLinks, gNodes, defs, sim, zoomBehavior;
  let nodeSel = null, edgeSel = null;
  let built = false;

  function stage() { return $("#view-map .graph-stage"); }
  function W() { const s = stage(); return s ? s.clientWidth || 900 : 900; }
  function H() { const s = stage(); return s ? s.clientHeight || 600 : 600; }

  function build() {
    const nodes = APP.nodes, links = APP.links;
    svg = d3.select("#graph");
    svg.selectAll("*").remove();
    if (sim) sim.stop();

    defs = svg.append("defs");
    Object.keys(APP.data.relationshipTypes).forEach(t => {
      if (!REL_DIRECTIONAL.has(t)) return;
      defs.append("marker")
        .attr("id", "arrow-" + t)
        .attr("viewBox", "0 0 10 10")
        .attr("refX", 9).attr("refY", 5)
        .attr("markerWidth", 7).attr("markerHeight", 7)
        .attr("orient", "auto-start-reverse")
        .append("path").attr("class", "m-" + t).attr("d", "M0,0 L10,5 L0,10 Z");
    });

    gRoot = svg.append("g");
    gLinks = gRoot.append("g").attr("aria-hidden", "true");
    gNodes = gRoot.append("g");

    zoomBehavior = d3.zoom()
      .scaleExtent([0.2, 5])
      .on("zoom", ev => gRoot.attr("transform", ev.transform))
      .on("start", () => svg.classed("grabbing", true))
      .on("end", () => svg.classed("grabbing", false));
    svg.call(zoomBehavior).on("dblclick.zoom", null);

    if (!built) {
      $("#zoom-in").addEventListener("click", () => svg.transition().duration(200).call(zoomBehavior.scaleBy, 1.45));
      $("#zoom-out").addEventListener("click", () => svg.transition().duration(200).call(zoomBehavior.scaleBy, 1 / 1.45));
      $("#zoom-fit").addEventListener("click", () => fit(450));
      window.addEventListener("resize", () => {
        if (!sim) return;
        sim.force("center", d3.forceCenter(W() / 2, H() / 2));
        sim.force("x", d3.forceX(W() / 2).strength(0.05));
        sim.force("y", d3.forceY(H() / 2).strength(0.06));
        sim.alpha(0.12).restart();
      });
      built = true;
    }

    edgeSel = gLinks.selectAll("path").data(links).join("path")
      .attr("class", d => "edge " + d.type)
      .attr("marker-end", d => REL_DIRECTIONAL.has(d.type) ? "url(#arrow-" + d.type + ")" : null);
    edgeSel.append("title").text(edgeDescription);

    nodeSel = gNodes.selectAll("g").data(nodes, d => d.id).join("g")
      .attr("class", "node")
      .attr("tabindex", 0)
      .attr("role", "button")
      .attr("aria-label", d => shortName(d) + ", " + d.role + ". Press Enter for details.");

    nodeSel.append("circle").attr("class", "halo").attr("r", d => nodeRadius(d) + 7);
    nodeSel.append("circle").attr("class", "ring")
      .attr("r", d => nodeRadius(d) + 2.5)
      .attr("stroke", d => catColor(d.category));
    nodeSel.append("circle").attr("class", "medallion")
      .attr("r", d => nodeRadius(d))
      .attr("fill", d => catColor(d.category));
    nodeSel.append("text").attr("class", "initial")
      .attr("dy", "0.36em")
      .attr("fill", d => letterInk(catColor(d.category)))
      .style("font-size", d => Math.round(nodeRadius(d) * 1.05) + "px")
      .text(d => shortName(d).charAt(0));
    nodeSel.append("circle").attr("class", "focus-ring").attr("r", d => nodeRadius(d) + 11);
    nodeSel.append("text").attr("class", "nlabel")
      .attr("y", d => nodeRadius(d) + 15)
      .text(d => shortName(d));

    nodeSel.on("click", (ev, d) => {
      if (ev.defaultPrevented) return;
      APP.lastFocusEl = ev.currentTarget;
      goTo(figureHash(d.id));
    });
    nodeSel.on("keydown", (ev, d) => {
      if (ev.key === "Enter" || ev.key === " ") {
        ev.preventDefault();
        APP.lastFocusEl = ev.currentTarget;
        goTo(figureHash(d.id));
      }
    });
    nodeSel.call(d3.drag()
      .on("start", (ev, d) => { if (!ev.active) sim.alphaTarget(0.25).restart(); d.fx = d.x; d.fy = d.y; })
      .on("drag", (ev, d) => { d.fx = ev.x; d.fy = ev.y; })
      .on("end", (ev, d) => { if (!ev.active) sim.alphaTarget(0); d.fx = null; d.fy = null; }));

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

    sim.stop();
    for (let i = 0; i < 180; i++) sim.tick();
    tick();
    sim.alpha(0.15).restart();
    fit(0);

    const loading = $("#graph-loading");
    if (loading) loading.remove();
  }

  function tick() {
    if (!edgeSel) return;
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
    const a = entity(l.from), b = entity(l.to);
    if (!a || !b) return "";
    const s = shortName(a), t = shortName(b);
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

  function applyFilters() {
    if (!nodeSel) return;
    nodeSel.classed("is-hidden", d => !nodeVisible(d));
    edgeSel.classed("is-hidden", d => !edgeVisible(d));
  }

  function refreshDimming() {
    if (!nodeSel) return;
    const id = APP.selectedId;
    if (!id) {
      nodeSel.classed("is-dim", false).classed("is-selected", false);
      edgeSel.classed("is-dim", false).classed("is-lit", false);
      return;
    }
    const nb = APP.neighbors.get(id) || new Set();
    nodeSel
      .classed("is-selected", d => d.id === id)
      .classed("is-dim", d => d.id !== id && !nb.has(d.id));
    edgeSel
      .classed("is-lit", d => d.from === id || d.to === id)
      .classed("is-dim", d => d.from !== id && d.to !== id);
  }

  /* search: dim non-matches while typing */
  function setQuery(q) {
    if (!nodeSel) return;
    if (!q) { nodeSel.classed("is-search-dim", false).classed("is-search-hit", false); return; }
    const hits = new Set(matchEntities(q).map(e => e.id));
    nodeSel.classed("is-search-dim", d => !hits.has(d.id))
           .classed("is-search-hit", d => hits.has(d.id));
  }

  function fit(duration) {
    const vis = APP.nodes.filter(nodeVisible);
    if (!vis.length || !svg) return;
    const pad = 60;
    const xs = vis.map(d => d.x), ys = vis.map(d => d.y);
    const minX = Math.min(...xs) - pad, maxX = Math.max(...xs) + pad;
    const minY = Math.min(...ys) - pad, maxY = Math.max(...ys) + pad;
    const w = W(), h = H();
    const k = Math.min(2, 0.95 / Math.max((maxX - minX) / w, (maxY - minY) / h));
    const t = d3.zoomIdentity
      .translate(w / 2 - k * (minX + maxX) / 2, h / 2 - k * (minY + maxY) / 2)
      .scale(k);
    (duration ? svg.transition().duration(duration) : svg).call(zoomBehavior.transform, t);
  }

  function center(id) {
    const d = APP.nodes.find(n => n.id === id);
    if (!d || !svg) return;
    const w = W(), h = H();
    const isMobile = window.matchMedia("(max-width: 700px)").matches;
    const cx = isMobile ? w / 2 : Math.max(w * 0.32, (w - 430) / 2);
    const cy = isMobile ? h * 0.3 : h / 2;
    const k = Math.max(1.05, d3.zoomTransform(svg.node()).k);
    const t = d3.zoomIdentity.translate(cx - k * d.x, cy - k * d.y).scale(k);
    svg.transition().duration(500).call(zoomBehavior.transform, t);
  }

  function resize() {
    if (!sim) return;
    sim.force("center", d3.forceCenter(W() / 2, H() / 2));
    sim.alpha(0.1).restart();
    fit(300);
  }

  return { build, applyFilters, refreshDimming, setQuery, fit, center, resize };
})();
