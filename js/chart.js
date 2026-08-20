/* ============================================================
   Chart Builder — a poster-style relationship chart generated
   from whichever figures the visitor selected.
   Deterministic tiered layout, so a chart is stable and printable.
   ============================================================ */
"use strict";

const ChartBuilder = (function () {
  const R = 34;              // medallion radius
  const CELL_W = 168;        // horizontal slot
  const TIER_H = 196;        // vertical distance between tiers
  const PAD = 64;            // frame padding
  const HEAD_H = 104;        // title cartouche band
  const MAX_COMFORT = 40;

  let lastSvg = "";

  /* ---------- theme ---------- */
  function themeVars() {
    const cs = getComputedStyle(document.documentElement);
    const v = n => (cs.getPropertyValue(n) || "").trim();
    return {
      bg: v("--bg-raised") || "#171a28",
      bg2: v("--bg-raised-2") || "#1d2133",
      ink: v("--ink-strong") || "#f6f1e5",
      inkMuted: v("--ink-muted") || "#b1a993",
      gold: v("--gold") || "#d4af6a",
      goldStrong: v("--gold-strong") || "#e8c987",
      hairline: v("--hairline") || "rgba(212,175,106,0.2)",
      edge: t => v("--edge-" + t) || "#888"
    };
  }

  const DASH = {
    parent: "", consort: "", sibling: "8 5", avatar: "", form: "3 6",
    enemy: "12 5", devotee: "2 6", mount: "10 4 3 4", guru: "6 5",
    foster: "3 8", ally: "14 7"
  };
  const WIDTH = { consort: 5, parent: 4.5, avatar: 4, form: 3, enemy: 3.5, ally: 3 };

  /* ---------- selection helpers ---------- */

  function selected() {
    return Array.from(APP.chart).map(id => entity(id)).filter(Boolean);
  }

  function addMany(ids) {
    ids.forEach(id => { if (APP.byId.has(id)) APP.chart.add(id); });
    saveChartSelection();
    updateTray();
    render();
  }

  function reset() {
    buildPresets();
    lastSvg = "";
  }

  function buildPresets() {
    const d = APP.data;
    const groups = d.groups || [];
    const levels = (d.hierarchy || []).map((lv, i) => ({
      label: lv.title, ids: lv.memberIds
    }));
    const top = d.entities.slice().sort((a, b) => degree(b.id) - degree(a.id)).slice(0, 24).map(e => e.id);
    const core = (d.hierarchy || []).slice(0, 3).reduce((acc, lv) => acc.concat(lv.memberIds), []);

    const presets = []
      .concat(core.length ? [{ label: "Core pantheon", ids: core }] : [])
      .concat(groups.map(g => ({ label: g.label, ids: g.memberIds })))
      .concat(levels.map(l => ({ label: l.label, ids: l.ids })))
      .concat([{ label: "24 most connected", ids: top }]);

    $("#chart-presets").innerHTML = presets.map((p, i) =>
      '<button type="button" class="era-chip" data-preset="' + i + '">' + esc(p.label) + "</button>"
    ).join("") + '<span class="preset-hint">Presets add to what you already picked.</span>';

    $("#chart-presets").onclick = ev => {
      const b = ev.target.closest("[data-preset]");
      if (!b) return;
      addMany(presets[+b.dataset.preset].ids);
    };

    ["chart-groups", "chart-notes", "chart-frame"].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.onchange = render;
    });
    $("#chart-clear").onclick = () => {
      APP.chart.clear(); saveChartSelection(); updateTray(); render();
    };
    $("#chart-svg").onclick = downloadSvg;
    $("#chart-png").onclick = downloadPng;
    $("#chart-print").onclick = () => window.print();
  }

  /* ---------- layout ---------- */

  function layout(list) {
    const ids = new Set(list.map(e => e.id));
    const edges = APP.data.links.filter(l => ids.has(l.from) && ids.has(l.to));

    /* tier by hierarchyLevel, compacted so unused tiers do not leave gaps */
    const usedLevels = Array.from(new Set(list.map(e => e.hierarchyLevel || 0))).sort((a, b) => a - b);
    const tierOf = new Map();
    list.forEach(e => tierOf.set(e.id, usedLevels.indexOf(e.hierarchyLevel || 0)));

    const tiers = usedLevels.map((_, i) => list.filter(e => tierOf.get(e.id) === i));

    /* barycenter ordering: two passes down, one up, to cut crossings */
    const orderIndex = new Map();
    tiers.forEach(t => t.forEach((e, i) => orderIndex.set(e.id, i)));

    function sweep(from, to, step) {
      for (let i = from; i !== to; i += step) {
        const prev = tiers[i - step];
        if (!prev) continue;
        const bary = new Map();
        tiers[i].forEach(e => {
          const linked = edges
            .filter(l => l.from === e.id || l.to === e.id)
            .map(l => (l.from === e.id ? l.to : l.from))
            .filter(o => tierOf.get(o) === i - step)
            .map(o => orderIndex.get(o));
          bary.set(e.id, linked.length
            ? linked.reduce((a, b) => a + b, 0) / linked.length
            : orderIndex.get(e.id));
        });
        tiers[i].sort((a, b) => bary.get(a.id) - bary.get(b.id) || a.name.localeCompare(b.name));
        tiers[i].forEach((e, k) => orderIndex.set(e.id, k));
      }
    }
    sweep(1, tiers.length, 1);
    sweep(tiers.length - 2, -1, -1);
    sweep(1, tiers.length, 1);

    /* positions, tiers centered on the widest one */
    const widest = Math.max(...tiers.map(t => t.length), 1);
    const innerW = widest * CELL_W;
    const pos = new Map();
    tiers.forEach((t, ti) => {
      const rowW = t.length * CELL_W;
      const x0 = (innerW - rowW) / 2 + CELL_W / 2;
      t.forEach((e, i) => pos.set(e.id, { x: x0 + i * CELL_W, y: ti * TIER_H + R + 26, tier: ti }));
    });

    return { pos, tiers, edges, innerW, innerH: tiers.length * TIER_H + 30 };
  }

  /* ---------- edge path ---------- */

  function edgePath(a, b, channel) {
    const dyDir = b.y > a.y ? 1 : -1;
    if (a.tier === b.tier) {
      /* same tier: a shallow arc that stays inside the group box above the row */
      const lift = 24 + Math.abs(channel) * 7;
      return "M" + a.x + "," + (a.y - R - 4) +
             "C" + a.x + "," + (a.y - R - lift) + " " + b.x + "," + (b.y - R - lift) +
             " " + b.x + "," + (b.y - R - 4);
    }
    const y1 = a.y + dyDir * (R + 6);
    const y2 = b.y - dyDir * (R + 12);
    const chY = y1 + (y2 - y1) * 0.5 + channel * 9;
    const r = 14;
    const dir = b.x > a.x ? 1 : (b.x < a.x ? -1 : 0);
    if (!dir) return "M" + a.x + "," + y1 + "L" + b.x + "," + y2;
    return "M" + a.x + "," + y1 +
      "L" + a.x + "," + (chY - dyDir * r) +
      "Q" + a.x + "," + chY + " " + (a.x + dir * r) + "," + chY +
      "L" + (b.x - dir * r) + "," + chY +
      "Q" + b.x + "," + chY + " " + b.x + "," + (chY + dyDir * r) +
      "L" + b.x + "," + y2;
  }

  /* ---------- render ---------- */

  function render() {
    const stage = $("#chart-stage");
    if (!stage) return;
    const list = selected();
    const warn = $("#chart-warn");

    if (!list.length) {
      warn.hidden = true;
      stage.innerHTML = '<div class="chart-empty">' +
        "<p>Your chart is empty. Pick a preset above, or add figures from any panel, card or story cycle.</p>" +
        "<p class='pane-note'>Whatever you choose is remembered on this device.</p></div>";
      lastSvg = "";
      return;
    }
    warn.hidden = list.length <= MAX_COMFORT;
    if (list.length > MAX_COMFORT) {
      warn.textContent = "This chart has " + list.length + " figures. Past about " + MAX_COMFORT +
        " the medallions get small; consider splitting it into two charts.";
    }

    lastSvg = svgMarkup(list);
    stage.innerHTML = lastSvg;
  }

  function svgMarkup(list) {
    const t = themeVars();
    const showGroups = $("#chart-groups").checked;
    const showNotes = $("#chart-notes").checked;
    const showFrame = $("#chart-frame").checked;
    const { pos, tiers, edges, innerW, innerH } = layout(list);

    const W = innerW + PAD * 2;
    const H = innerH + PAD * 2 + HEAD_H;
    const OY = PAD + HEAD_H;

    const P = id => {
      const p = pos.get(id);
      return { x: p.x + PAD, y: p.y + OY, tier: p.tier };
    };

    /* group boxes sit behind the edges; their labels are painted on top of them */
    let groupsSvg = "", groupLabelsSvg = "";
    if (showGroups && APP.data.groups) {
      APP.data.groups.forEach(g => {
        const members = g.memberIds.filter(id => pos.has(id));
        if (members.length < 2) return;
        const pts = members.map(P);
        const minX = Math.min(...pts.map(p => p.x)) - R - 16;
        const maxX = Math.max(...pts.map(p => p.x)) + R + 16;
        /* top padding clears the same-tier arcs, which lift at most 45px */
        const minY = Math.min(...pts.map(p => p.y)) - R - 62;
        const maxY = Math.max(...pts.map(p => p.y)) + R + 44;
        groupsSvg +=
          '<rect x="' + minX + '" y="' + minY + '" width="' + (maxX - minX) + '" height="' + (maxY - minY) +
          '" rx="20" fill="' + t.bg2 + '" stroke="' + t.gold + '" stroke-opacity="0.45" stroke-width="1.5"/>';
        groupLabelsSvg +=
          '<text x="' + ((minX + maxX) / 2) + '" y="' + (minY + 22) +
          '" text-anchor="middle" font-family="Cormorant Garamond, Georgia, serif" font-size="17" ' +
          'font-weight="600" letter-spacing="1.4" fill="' + t.goldStrong +
          '" paint-order="stroke" stroke="' + t.bg2 + '" stroke-width="7">' + esc(g.label) + "</text>";
      });
    }

    /* edges, with a per-pair channel offset so parallel runs stay apart */
    const chan = new Map();
    let edgesSvg = "", notesSvg = "";
    edges.forEach(l => {
      const a = P(l.from), b = P(l.to);
      const key = Math.min(a.tier, b.tier) + ":" + Math.max(a.tier, b.tier);
      const c = chan.get(key) || 0;
      chan.set(key, c + 1);
      const idx = c % 5 - 2;
      const d = edgePath(a, b, idx);
      const stroke = t.edge(l.type);
      edgesSvg += '<path d="' + d + '" fill="none" stroke="' + stroke +
        '" stroke-width="' + (WIDTH[l.type] || 2.6) + '" stroke-linecap="round" stroke-opacity="0.85"' +
        (DASH[l.type] ? ' stroke-dasharray="' + DASH[l.type] + '"' : "") +
        (REL_DIRECTIONAL.has(l.type) ? ' marker-end="url(#c-arrow-' + l.type + ')"' : "") +
        '><title>' + esc(relSentence(l)) + "</title></path>";

      if (showNotes && l.note && a.tier !== b.tier) {
        const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2 + idx * 9;
        notesSvg += '<text x="' + mx + '" y="' + my + '" text-anchor="middle" font-size="10.5" ' +
          'font-family="Inter, system-ui, sans-serif" fill="' + t.inkMuted + '" ' +
          'paint-order="stroke" stroke="' + t.bg + '" stroke-width="4">' + esc(l.note) + "</text>";
      }
    });

    /* medallions */
    let nodesSvg = "";
    list.forEach(e => {
      const p = P(e.id);
      const c = catColor(e.category);
      const nm = shortName(e);
      nodesSvg +=
        '<g class="cn">' +
        '<circle cx="' + p.x + '" cy="' + p.y + '" r="' + (R + 5) + '" fill="' + t.bg +
          '" stroke="' + c + '" stroke-width="3"/>' +
        '<clipPath id="cc-' + esc(e.id) + '"><circle cx="' + p.x + '" cy="' + p.y + '" r="' + R + '"/></clipPath>' +
        '<image href="' + esc(portraitPath(e)) + '" x="' + (p.x - R) + '" y="' + (p.y - R) +
          '" width="' + (R * 2) + '" height="' + (R * 2) + '" clip-path="url(#cc-' + esc(e.id) +
          ')" preserveAspectRatio="xMidYMid slice"><title>' + esc(nm) + "</title></image>" +
        '<text x="' + p.x + '" y="' + (p.y + R + 20) + '" text-anchor="middle" font-size="13" ' +
          'font-weight="600" font-family="Inter, system-ui, sans-serif" fill="' + t.ink +
          '" paint-order="stroke" stroke="' + t.bg + '" stroke-width="4">' + esc(nm) + "</text>" +
        '<text x="' + p.x + '" y="' + (p.y + R + 35) + '" text-anchor="middle" font-size="9.5" ' +
          'font-family="Inter, system-ui, sans-serif" fill="' + t.inkMuted +
          '" paint-order="stroke" stroke="' + t.bg + '" stroke-width="3.5">' +
          esc(truncate(e.role, 24)) + "</text>" +
        "</g>";
    });

    /* legend for the relationship types actually drawn */
    const usedTypes = Array.from(new Set(edges.map(l => l.type)));
    const legW = 210, legH = 26 + usedTypes.length * 19;
    const legX = W - PAD - legW, legY = H - PAD - legH;
    let legend = '<g><rect x="' + legX + '" y="' + legY + '" width="' + legW + '" height="' + legH +
      '" rx="12" fill="' + t.bg2 + '" stroke="' + t.gold + '" stroke-opacity="0.4"/>' +
      '<text x="' + (legX + 14) + '" y="' + (legY + 19) + '" font-size="10.5" letter-spacing="1.6" ' +
      'font-family="Inter, system-ui, sans-serif" fill="' + t.goldStrong + '">LEGEND</text>';
    usedTypes.forEach((ty, i) => {
      const y = legY + 36 + i * 19;
      legend += '<line x1="' + (legX + 14) + '" y1="' + y + '" x2="' + (legX + 54) + '" y2="' + y +
        '" stroke="' + t.edge(ty) + '" stroke-width="3" stroke-linecap="round"' +
        (DASH[ty] ? ' stroke-dasharray="' + DASH[ty] + '"' : "") + "/>" +
        '<text x="' + (legX + 64) + '" y="' + (y + 4) + '" font-size="11.5" ' +
        'font-family="Inter, system-ui, sans-serif" fill="' + t.inkMuted + '">' +
        esc(REL_LABELS[ty] || ty) + "</text>";
    });
    legend += "</g>";

    /* title cartouche */
    const meta = APP.data.meta || { label: "" };
    const title = meta.label + " Relationship Chart";
    const sub = list.length + " figures  ·  " + edges.length + " relationships";
    const cart =
      '<g><rect x="' + (W / 2 - 250) + '" y="' + (PAD - 6) + '" width="500" height="70" rx="16" fill="' + t.bg2 +
        '" stroke="' + t.gold + '" stroke-opacity="0.55" stroke-width="1.5"/>' +
      '<text x="' + (W / 2) + '" y="' + (PAD + 24) + '" text-anchor="middle" ' +
        'font-family="Cormorant Garamond, Georgia, serif" font-size="27" font-weight="600" fill="' + t.ink + '">' +
        esc(title) + "</text>" +
      '<text x="' + (W / 2) + '" y="' + (PAD + 48) + '" text-anchor="middle" font-size="12" ' +
        'letter-spacing="2" font-family="Inter, system-ui, sans-serif" fill="' + t.goldStrong + '">' +
        esc(sub.toUpperCase()) + "</text></g>";

    /* ornamental frame: two rules and corner flourishes, theme-matched */
    let frame = "";
    if (showFrame) {
      const m = 20, m2 = 30;
      frame =
        '<rect x="' + m + '" y="' + m + '" width="' + (W - m * 2) + '" height="' + (H - m * 2) +
          '" rx="14" fill="none" stroke="' + t.gold + '" stroke-opacity="0.55" stroke-width="2"/>' +
        '<rect x="' + m2 + '" y="' + m2 + '" width="' + (W - m2 * 2) + '" height="' + (H - m2 * 2) +
          '" rx="10" fill="none" stroke="' + t.gold + '" stroke-opacity="0.28" stroke-width="1"/>';
      [[m2, m2, 1, 1], [W - m2, m2, -1, 1], [m2, H - m2, 1, -1], [W - m2, H - m2, -1, -1]]
        .forEach(([x, y, sx, sy]) => {
          frame += '<path d="M' + x + "," + (y + sy * 34) + "L" + x + "," + (y + sy * 12) +
            "Q" + x + "," + y + " " + (x + sx * 12) + "," + y + "L" + (x + sx * 34) + "," + y +
            '" fill="none" stroke="' + t.goldStrong + '" stroke-opacity="0.85" stroke-width="2.5"/>' +
            '<circle cx="' + (x + sx * 12) + '" cy="' + (y + sy * 12) + '" r="3" fill="' + t.goldStrong + '"/>';
        });
    }

    let markers = "";
    Array.from(new Set(edges.filter(l => REL_DIRECTIONAL.has(l.type)).map(l => l.type))).forEach(ty => {
      markers += '<marker id="c-arrow-' + ty + '" viewBox="0 0 10 10" refX="8" refY="5" ' +
        'markerWidth="5" markerHeight="5" orient="auto-start-reverse">' +
        '<path d="M0,0 L10,5 L0,10 Z" fill="' + t.edge(ty) + '"/></marker>';
    });

    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + W + " " + H +
      '" width="' + W + '" height="' + H + '" role="img" aria-label="' +
      esc(title + ", " + sub) + '" class="chart-svg">' +
      "<defs>" + markers + "</defs>" +
      '<rect width="' + W + '" height="' + H + '" fill="' + t.bg + '"/>' +
      frame + cart + groupsSvg + edgesSvg + notesSvg + groupLabelsSvg + nodesSvg + legend +
      "</svg>";
  }

  function relSentence(l) {
    const a = entity(l.from), b = entity(l.to);
    const s = shortName(a), t2 = shortName(b);
    const base = (REL_LABELS[l.type] || l.type);
    return s + " - " + base.toLowerCase() + " - " + t2 + (l.note ? " (" + l.note + ")" : "");
  }

  function truncate(s, n) { return s.length > n ? s.slice(0, n - 1) + "…" : s; }

  /* ---------- export ---------- */

  function fileBase() {
    return ((APP.data.meta && APP.data.meta.id) || "chart") + "-relationship-chart";
  }

  /* portraits must be embedded, or a standalone SVG/PNG has no images */
  function inlinePortraits(svgText) {
    const list = selected();
    return Promise.all(list.map(e =>
      fetch(portraitPath(e)).then(r => r.blob()).then(b => new Promise(res => {
        const fr = new FileReader();
        fr.onload = () => res([portraitPath(e), fr.result]);
        fr.onerror = () => res([portraitPath(e), null]);
        fr.readAsDataURL(b);
      })).catch(() => [portraitPath(e), null])
    )).then(pairs => {
      let out = svgText;
      pairs.forEach(([path, uri]) => {
        if (!uri) return;
        out = out.split('href="' + path + '"').join('href="' + uri + '"');
      });
      return out;
    });
  }

  function triggerDownload(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  function downloadSvg() {
    if (!lastSvg) return;
    inlinePortraits(lastSvg).then(svgText => {
      triggerDownload(new Blob([svgText], { type: "image/svg+xml" }), fileBase() + ".svg");
    });
  }

  function downloadPng() {
    if (!lastSvg) return;
    const btn = $("#chart-png");
    btn.disabled = true;
    btn.textContent = "Rendering...";
    inlinePortraits(lastSvg).then(svgText => {
      const svgEl = $(".chart-svg", $("#chart-stage"));
      const w = +svgEl.getAttribute("width"), h = +svgEl.getAttribute("height");
      const img = new Image();
      img.onload = () => {
        const scale = 2;
        const cv = document.createElement("canvas");
        cv.width = w * scale; cv.height = h * scale;
        const ctx = cv.getContext("2d");
        ctx.scale(scale, scale);
        ctx.drawImage(img, 0, 0);
        cv.toBlob(b => {
          if (b) triggerDownload(b, fileBase() + ".png");
          btn.disabled = false; btn.textContent = "Download PNG";
        }, "image/png");
      };
      img.onerror = () => {
        btn.disabled = false; btn.textContent = "Download PNG";
        $("#chart-warn").hidden = false;
        $("#chart-warn").textContent = "The PNG could not be rendered in this browser. The SVG download works everywhere.";
      };
      img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svgText);
    });
  }

  return { reset, render, addMany };
})();
