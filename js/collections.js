/* ============================================================
   Collections — gather figures and story cycles from ANY tradition
   on the site, then export the set as PDF, Word, Markdown or text.

   Deliberately not the same thing as the chart builder. The chart is
   one tradition's figures arranged as a poster; a collection crosses
   traditions and exists to be read or printed somewhere else.

   Everything is per-device and local: the selection lives in
   localStorage under hm-collection, nothing is uploaded, and the
   exports are generated in the browser.
   ============================================================ */
"use strict";

const Collections = (function () {
  const KEY = "hm-collection";
  const MAX = 200;                 // a soft cap; the exports stay readable

  let items = [];                  // [{pack, id, kind}] in the order added

  /* ---------- storage ---------- */

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      items = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(items)) items = [];
    } catch (e) { items = []; }
    items = items.filter(it => it && it.pack && it.id &&
                               (it.kind === "figure" || it.kind === "story"));
    return items;
  }

  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(items)); } catch (e) { /* private mode */ }
    paintButtons();
    paintCount();
  }

  const keyOf = (pack, id, kind) => pack + "|" + kind + "|" + id;
  const has = (pack, id, kind) =>
    items.some(it => keyOf(it.pack, it.id, it.kind) === keyOf(pack, id, kind));

  function toggle(pack, id, kind) {
    const k = keyOf(pack, id, kind);
    const at = items.findIndex(it => keyOf(it.pack, it.id, it.kind) === k);
    if (at >= 0) items.splice(at, 1);
    else if (items.length < MAX) items.push({ pack: pack, id: id, kind: kind });
    save();
    return at < 0;
  }

  function remove(pack, id, kind) {
    const k = keyOf(pack, id, kind);
    items = items.filter(it => keyOf(it.pack, it.id, it.kind) !== k);
    save();
  }

  function move(pack, id, kind, dir) {
    const k = keyOf(pack, id, kind);
    const i = items.findIndex(it => keyOf(it.pack, it.id, it.kind) === k);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= items.length) return;
    const tmp = items[i]; items[i] = items[j]; items[j] = tmp;
    save();
  }

  function clear() { items = []; save(); }
  const count = () => items.length;
  const list = () => items.slice();

  /* ---------- data ---------- */

  /* A collection can span traditions the visitor never opened, so pull the
     datasets it needs. APP.packs is already the site's dataset cache, so this
     costs nothing for packs that are loaded and one fetch for those that are
     not. Vault-gated packs are only available if this device unlocked them. */
  function hydrate() {
    const need = [];
    items.forEach(it => {
      if (!APP.packs[it.pack] && need.indexOf(it.pack) === -1) need.push(it.pack);
    });
    return Promise.all(need.map(pid => {
      if (window.Vault && Vault.isOpen && Vault.isOpen(pid)) {
        try { APP.packs[pid] = Vault.attach(pid); return Promise.resolve(); }
        catch (e) { /* fall through to the fetch, which will fail cleanly */ }
      }
      return fetch("/data/" + pid + "/dataset.json")
        .then(r => (r.ok ? r.json() : null))
        .then(d => { if (d) APP.packs[pid] = d; })
        .catch(() => { /* reported as unavailable at render time */ });
    }));
  }

  function packMeta(pid) {
    const m = (APP.manifest || []).filter(p => p.id === pid)[0];
    return m || { id: pid, label: pid, sublabel: "" };
  }

  function resolve(it) {
    const d = APP.packs[it.pack];
    if (!d) return null;
    if (it.kind === "figure") {
      const e = d.entities.filter(x => x.id === it.id)[0];
      return e ? { kind: "figure", pack: it.pack, data: e, dataset: d } : null;
    }
    const s = (d.stories || []).filter(x => x.id === it.id)[0];
    return s ? { kind: "story", pack: it.pack, data: s, dataset: d } : null;
  }

  /* Resolved items, grouped by tradition but keeping the visitor's order. */
  function resolved() {
    const out = [];
    items.forEach(it => { const r = resolve(it); if (r) out.push(r); });
    return out;
  }

  function grouped() {
    const order = [];
    const byPack = {};
    resolved().forEach(r => {
      if (!byPack[r.pack]) { byPack[r.pack] = []; order.push(r.pack); }
      byPack[r.pack].push(r);
    });
    return order.map(pid => ({ pack: pid, meta: packMeta(pid), entries: byPack[pid] }));
  }

  /* ---------- the shape every export shares ----------
     One structure, rendered four ways, so a PDF and a Markdown file carry the
     same sections in the same order and read as the same document. */

  function figureFields(e) {
    const f = [];
    if (e.role) f.push(["Role", e.role]);
    if (e.sanskrit && e.sanskrit !== e.name) f.push(["Also written", e.sanskrit]);
    if (e.era) f.push(["Era", e.era]);
    if (e.epithets && e.epithets.length) f.push(["Epithets", e.epithets.join("; ")]);
    if (e.domains && e.domains.length) f.push(["Domains", e.domains.join("; ")]);
    if (e.symbols && e.symbols.length) f.push(["Symbols", e.symbols.join("; ")]);
    if (e.mount) f.push(["Mount", e.mount]);
    if (e.abode) f.push(["Abode", e.abode]);
    if (e.festivals && e.festivals.length) f.push(["Festivals", e.festivals.join("; ")]);
    return f;
  }

  function relationsOf(e, d) {
    const nm = id => {
      const x = d.entities.filter(y => y.id === id)[0];
      return x ? x.name : id;
    };
    const labels = d.relationshipTypes || {};
    return (d.links || [])
      .filter(l => l.from === e.id || l.to === e.id)
      .map(l => {
        const other = l.from === e.id ? l.to : l.from;
        const lab = labels[l.type] || l.type;
        return (l.from === e.id ? lab : lab + " of") + " " + nm(other) +
               (l.note ? " — " + l.note : "");
      });
  }

  function doc() {
    const groups = grouped();
    const now = new Date();
    const stamp = now.getFullYear() + "-" +
      String(now.getMonth() + 1).padStart(2, "0") + "-" +
      String(now.getDate()).padStart(2, "0");
    const nFig = groups.reduce((n, g) =>
      n + g.entries.filter(e => e.kind === "figure").length, 0);
    const nSt = groups.reduce((n, g) =>
      n + g.entries.filter(e => e.kind === "story").length, 0);
    /* One summary sentence, built once and used by all four exports, so a PDF
       and a Markdown file cannot drift apart on wording or on plurals. */
    const s = (n, one, many) => n + " " + (n === 1 ? one : many);
    return {
      title: "A Collection from World Mythologies",
      stamp: stamp,
      counts: { figures: nFig, stories: nSt, traditions: groups.length },
      summary: s(nFig, "figure", "figures") + " and " +
               s(nSt, "story cycle", "story cycles") + " across " +
               s(groups.length, "tradition", "traditions"),
      groups: groups,
      source: "mythology.quiddityinnovations.com"
    };
  }

  /* ---------- exports ---------- */

  function fileStamp(d) { return "mythology-collection-" + d.stamp; }

  /* The byte-order mark is per-format, not blanket. Windows Notepad needs it to
     read .txt as UTF-8, but at byte 0 of a Markdown file it stops `---` being
     recognised as frontmatter and shows as a stray  in parsers that do not
     strip it. Word does not need one at all. */
  function download(name, mime, text, bom) {
    const blob = new Blob([(bom ? "﻿" : "") + text], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  /* --- Markdown --- */
  function toMarkdown() {
    const d = doc();
    const L = [];
    L.push("# " + d.title, "");
    L.push("*" + d.summary + ". Compiled " + d.stamp +
           " from " + d.source + ".*", "");
    d.groups.forEach(g => {
      L.push("---", "");
      L.push("## " + g.meta.label + (g.meta.sublabel ? " — " + g.meta.sublabel : ""), "");
      g.entries.forEach(en => {
        if (en.kind === "figure") {
          const e = en.data;
          L.push("### " + e.name, "");
          if (e.bio) L.push("**" + e.bio + "**", "");
          figureFields(e).forEach(f => L.push("- **" + f[0] + ":** " + f[1]));
          L.push("");
          if (e.longBio) L.push(e.longBio, "");
          if (e.variantTraditions) L.push("> " + e.variantTraditions, "");
          const rel = relationsOf(e, en.dataset);
          if (rel.length) {
            L.push("**Connected to**", "");
            rel.forEach(r => L.push("- " + r));
            L.push("");
          }
        } else {
          const s = en.data;
          L.push("### " + s.title + "  *(story)*", "");
          if (s.era) L.push("*" + s.era + "*", "");
          L.push(s.summary, "");
          if (s.cast && s.cast.length) {
            const nm = id => {
              const x = en.dataset.entities.filter(y => y.id === id)[0];
              return x ? x.name : id;
            };
            L.push("**Cast:** " + s.cast.map(nm).join(", "), "");
          }
          if (s.sources && s.sources.length) {
            L.push("**Sources**", "");
            s.sources.forEach(src => L.push("- " + src.book +
              (src.translation ? ", " + src.translation : "") +
              (src.location ? " — " + src.location : "")));
            L.push("");
          }
        }
      });
      const ds = APP.packs[g.pack];
      if (ds && ds.sources && ds.sources.length) {
        L.push("**Sources for " + g.meta.label + "**", "");
        ds.sources.forEach(s => L.push("- " + s));
        L.push("");
      }
    });
    return L.join("\n");
  }

  /* --- plain text: the same document, unstyled --- */
  function toText() {
    const d = doc();
    const L = [];
    const rule = ch => new Array(72).join(ch);
    L.push(rule("="), d.title.toUpperCase(), rule("="), "");
    L.push(d.summary + ".");
    L.push("Compiled " + d.stamp + " from " + d.source + ".", "");
    d.groups.forEach(g => {
      L.push("", rule("="),
             (g.meta.label + (g.meta.sublabel ? " - " + g.meta.sublabel : "")).toUpperCase(),
             rule("="), "");
      g.entries.forEach(en => {
        if (en.kind === "figure") {
          const e = en.data;
          L.push(e.name, rule("-"));
          if (e.bio) L.push(e.bio, "");
          figureFields(e).forEach(f => L.push("  " + f[0] + ": " + f[1]));
          L.push("");
          if (e.longBio) L.push(wrap(e.longBio), "");
          if (e.variantTraditions) L.push("  Note: " + wrap(e.variantTraditions, 4), "");
          const rel = relationsOf(e, en.dataset);
          if (rel.length) {
            L.push("  Connected to:");
            rel.forEach(r => L.push("    - " + r));
            L.push("");
          }
        } else {
          const s = en.data;
          L.push(s.title + " (story)", rule("-"));
          if (s.era) L.push(s.era, "");
          L.push(wrap(s.summary), "");
          if (s.sources && s.sources.length) {
            L.push("  Sources:");
            s.sources.forEach(src => L.push("    - " + src.book +
              (src.translation ? ", " + src.translation : "")));
            L.push("");
          }
        }
      });
    });
    return L.join("\n");
  }

  function wrap(text, indent) {
    const pad = new Array((indent || 0) + 1).join(" ");
    const words = String(text).split(/\s+/);
    const out = [];
    let line = pad;
    words.forEach(w => {
      if ((line + " " + w).length > 76) { out.push(line); line = pad + w; }
      else line = line === pad ? pad + w : line + " " + w;
    });
    if (line.trim()) out.push(line);
    return out.join("\n");
  }

  /* Word will not fetch a remote image out of a downloaded .doc, so the Word
     export has to carry its portraits inline as data URIs. The print/PDF path
     is same-origin and can just use the real paths, which keeps it fast. */
  function portraitMap() {
    const srcs = [];
    grouped().forEach(g => g.entries.forEach(en => {
      if (en.kind === "figure" && en.data.portrait) {
        const u = en.data.portrait.charAt(0) === "/" ? en.data.portrait : "/" + en.data.portrait;
        if (srcs.indexOf(u) === -1) srcs.push(u);
      }
    }));

    /* The portraits are WebP, and Word's HTML import does not render WebP
       dependably across versions - so they are decoded and re-encoded as JPEG
       on a canvas first. The browser is already displaying these images, so the
       decode is free, and it also stops the data URI inheriting whatever
       content-type the server happened to send. */
    const map = {};
    return Promise.all(srcs.map(u => new Promise(res => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => {
        try {
          const c = document.createElement("canvas");
          c.width = img.naturalWidth || 260;
          c.height = img.naturalHeight || 260;
          const ctx = c.getContext("2d");
          ctx.fillStyle = "#ffffff";              // JPEG has no alpha
          ctx.fillRect(0, 0, c.width, c.height);
          ctx.drawImage(img, 0, 0);
          map[u] = c.toDataURL("image/jpeg", 0.85);
        } catch (e) { /* tainted or unsupported; entry simply has no portrait */ }
        res();
      };
      img.onerror = () => res();
      img.src = u;
    }))).then(() => map);
  }

  /* --- the shared HTML body, used for both print/PDF and Word --- */
  function bodyHtml(imgMap) {
    const d = doc();
    const esc = s => String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const H = [];
    H.push('<div class="coll-doc">');
    H.push('<header class="coll-cover">');
    H.push('<p class="coll-kicker">Quiddity Innovations &middot; World Mythologies</p>');
    H.push("<h1>" + esc(d.title) + "</h1>");
    H.push('<p class="coll-sub">' + esc(d.summary) + "</p>");
    H.push('<p class="coll-meta">Compiled ' + esc(d.stamp) + " &middot; " +
           esc(d.source) + "</p>");
    H.push("</header>");

    d.groups.forEach(g => {
      H.push('<section class="coll-part">');
      H.push('<h2 class="coll-part-h">' + esc(g.meta.label) +
             (g.meta.sublabel ? ' <span class="coll-part-sub">' +
              esc(g.meta.sublabel) + "</span>" : "") + "</h2>");
      g.entries.forEach(en => {
        if (en.kind === "figure") {
          const e = en.data;
          const raw = e.portrait
            ? (e.portrait.charAt(0) === "/" ? e.portrait : "/" + e.portrait) : "";
          const src = imgMap ? (imgMap[raw] || "") : raw;
          H.push('<article class="coll-entry">');
          H.push('<div class="coll-figrow">');
          if (src) H.push('<img class="coll-portrait" src="' + src + '" alt="">');
          H.push('<div class="coll-figtext">');
          H.push("<h3>" + esc(e.name) + "</h3>");
          if (e.bio) H.push('<p class="coll-lead">' + esc(e.bio) + "</p>");
          const ff = figureFields(e);
          if (ff.length) {
            H.push('<table class="coll-facts"><tbody>');
            ff.forEach(f => H.push("<tr><th>" + esc(f[0]) + "</th><td>" +
                                   esc(f[1]) + "</td></tr>"));
            H.push("</tbody></table>");
          }
          if (e.longBio) H.push("<p>" + esc(e.longBio) + "</p>");
          if (e.variantTraditions)
            H.push('<p class="coll-note">' + esc(e.variantTraditions) + "</p>");
          const rel = relationsOf(e, en.dataset);
          if (rel.length) {
            H.push('<p class="coll-h4">Connected to</p><ul class="coll-rel">');
            rel.forEach(r => H.push("<li>" + esc(r) + "</li>"));
            H.push("</ul>");
          }
          H.push("</div></div>");
          H.push("</article>");
        } else {
          const s = en.data;
          H.push('<article class="coll-entry coll-story">');
          H.push("<h3>" + esc(s.title) + '<span class="coll-tag">story</span></h3>');
          if (s.era) H.push('<p class="coll-era">' + esc(s.era) + "</p>");
          H.push("<p>" + esc(s.summary) + "</p>");
          if (s.sources && s.sources.length) {
            H.push('<p class="coll-h4">Sources</p><ul class="coll-rel">');
            s.sources.forEach(src => H.push("<li>" + esc(src.book) +
              (src.translation ? ", " + esc(src.translation) : "") +
              (src.location ? " &mdash; " + esc(src.location) : "") + "</li>"));
            H.push("</ul>");
          }
          H.push("</article>");
        }
      });
      const ds = APP.packs[g.pack];
      if (ds && ds.sources && ds.sources.length) {
        H.push('<div class="coll-sources"><p class="coll-h4">Sources for ' +
               esc(g.meta.label) + "</p><ul>");
        ds.sources.forEach(s => H.push("<li>" + esc(s) + "</li>"));
        H.push("</ul></div>");
      }
      H.push("</section>");
    });
    H.push('<footer class="coll-foot">Compiled from ' + esc(d.source) +
           " on " + esc(d.stamp) + ".</footer>");
    H.push("</div>");
    return H.join("\n");
  }

  /* The one stylesheet both the printed page and the Word file use, so the
     four exports are recognisably the same document. Word understands a
     usable subset of CSS; everything here is inside it. */
  function docCss(forWord) {
    return [
      "body{font-family:Georgia,'Times New Roman',serif;color:#1a1712;",
      "line-height:1.55;font-size:11.5pt;margin:0;}",
      ".coll-doc{max-width:44em;margin:0 auto;padding:0 8pt;}",
      ".coll-cover{border-bottom:2px solid #9a7a2e;padding-bottom:14pt;margin-bottom:22pt;}",
      ".coll-kicker{font-size:8.5pt;letter-spacing:.22em;text-transform:uppercase;",
      "color:#9a7a2e;margin:0 0 6pt;}",
      ".coll-cover h1{font-size:26pt;margin:0 0 6pt;font-weight:600;color:#5a4a22;}",
      ".coll-sub{font-size:12pt;margin:0 0 4pt;color:#3a332a;}",
      ".coll-meta{font-size:9.5pt;color:#6b6353;margin:0;}",
      ".coll-part{margin-top:24pt;}",
      ".coll-part-h{font-size:16pt;color:#5a4a22;border-bottom:1px solid #d8c9a4;",
      "padding-bottom:5pt;margin:0 0 12pt;page-break-after:avoid;}",
      ".coll-part-sub{font-size:9.5pt;letter-spacing:.14em;text-transform:uppercase;",
      "color:#9a7a2e;font-weight:normal;}",
      ".coll-entry{margin:0 0 18pt;page-break-inside:avoid;}",
      // Word's CSS support stops well short of flexbox, so the portrait is
      // floated - which behaves identically in the print path.
      ".coll-portrait{float:left;width:78pt;height:78pt;margin:2pt 12pt 6pt 0;",
      "border:1pt solid #c9b47a;border-radius:50%;}",
      ".coll-figrow:after{content:'';display:block;clear:both;}",
      ".coll-entry h3{font-size:13.5pt;margin:0 0 3pt;color:#2b2418;page-break-after:avoid;}",
      ".coll-tag{font-size:8pt;letter-spacing:.16em;text-transform:uppercase;",
      "color:#9a7a2e;margin-left:8pt;}",
      ".coll-lead{font-style:italic;color:#4a4235;margin:0 0 8pt;}",
      ".coll-era{font-size:9.5pt;color:#6b6353;margin:0 0 6pt;}",
      ".coll-facts{border-collapse:collapse;margin:0 0 9pt;width:100%;}",
      ".coll-facts th{text-align:left;vertical-align:top;width:8.5em;font-size:9.5pt;",
      "letter-spacing:.04em;text-transform:uppercase;color:#9a7a2e;font-weight:600;",
      "padding:2pt 10pt 2pt 0;}",
      ".coll-facts td{vertical-align:top;padding:2pt 0;font-size:10.5pt;}",
      ".coll-note{font-size:10pt;color:#4a4235;border-left:2px solid #d8c9a4;",
      "padding-left:9pt;margin:8pt 0;}",
      ".coll-h4{font-size:9.5pt;letter-spacing:.12em;text-transform:uppercase;",
      "color:#9a7a2e;margin:10pt 0 4pt;}",
      ".coll-rel{margin:0 0 6pt;padding-left:16pt;font-size:10pt;}",
      ".coll-rel li{margin:0 0 2pt;}",
      ".coll-sources{margin-top:12pt;border-top:1px solid #e2d7bd;padding-top:8pt;",
      "font-size:9.5pt;color:#4a4235;}",
      ".coll-sources ul{margin:0;padding-left:16pt;}",
      ".coll-foot{margin-top:26pt;border-top:1px solid #d8c9a4;padding-top:8pt;",
      "font-size:9pt;color:#6b6353;text-align:center;}"
    ].join("");
  }

  /* --- Word --- */
  function toWord() {
    const d = doc();
    return portraitMap().then(map => buildWord(d, map));
  }

  function buildWord(d, map) {
    const html =
      '<html xmlns:o="urn:schemas-microsoft-com:office:office" ' +
      'xmlns:w="urn:schemas-microsoft-com:office:word" ' +
      'xmlns="http://www.w3.org/TR/REC-html40"><head><meta charset="utf-8">' +
      "<title>" + d.title + "</title>" +
      "<!--[if gte mso 9]><xml><w:WordDocument>" +
      "<w:View>Print</w:View><w:Zoom>100</w:Zoom></w:WordDocument></xml><![endif]-->" +
      "<style>@page{size:A4;margin:2cm;}" + docCss(true) + "</style></head><body>" +
      bodyHtml(map) + "</body></html>";
    download(fileStamp(d) + ".doc", "application/msword", html);
  }

  /* --- PDF, via the browser's own print dialogue --- */
  function toPdf() {
    const d = doc();
    const win = window.open("", "_blank");
    if (!win) {
      alert("Your browser blocked the print window. Allow pop-ups for this " +
            "site, or use the Word or Markdown export instead.");
      return;
    }
    win.document.write(
      '<!doctype html><html><head><meta charset="utf-8"><title>' + d.title +
      "</title><style>@page{size:A4;margin:18mm;}" + docCss(false) +
      "</style></head><body>" + bodyHtml(null) + "</body></html>");
    win.document.close();
    win.focus();
    /* let the fonts settle before the dialogue opens */
    setTimeout(() => { try { win.print(); } catch (e) { /* user can print manually */ } }, 350);
  }

  /* ---------- buttons scattered through the site ---------- */

  function paintButtons() {
    const nodes = document.querySelectorAll("[data-coll-add]");
    Array.prototype.forEach.call(nodes, b => {
      const pack = b.getAttribute("data-coll-pack") || (APP && APP.pid);
      const kind = b.getAttribute("data-coll-kind") || "figure";
      const on = has(pack, b.getAttribute("data-coll-add"), kind);
      b.classList.toggle("is-in", on);
      b.setAttribute("aria-pressed", on ? "true" : "false");
      if (b.dataset.collLabel !== "icon")
        b.textContent = on ? "In your collection" : "Add to collection";
      else
        b.title = on ? "Remove from collection" : "Add to collection";
    });
  }

  function paintCount() {
    const n = count();
    const tab = document.getElementById("tab-collection");
    if (tab) {
      const b = tab.querySelector(".coll-badge");
      if (b) { b.textContent = n; b.hidden = n === 0; }
    }
  }

  /* one delegated listener for every add button on the site */
  function wire() {
    document.addEventListener("click", ev => {
      const b = ev.target.closest && ev.target.closest("[data-coll-add]");
      if (!b) return;
      ev.preventDefault();
      const pack = b.getAttribute("data-coll-pack") || APP.pid;
      const kind = b.getAttribute("data-coll-kind") || "figure";
      toggle(pack, b.getAttribute("data-coll-add"), kind);
    });
    load();
    paintCount();
  }

  return {
    load: load, list: list, count: count, has: has, toggle: toggle,
    remove: remove, move: move, clear: clear,
    hydrate: hydrate, grouped: grouped, packMeta: packMeta,
    toMarkdown: toMarkdown, toText: toText, toWord: toWord, toPdf: toPdf,
    download: download, fileStamp: fileStamp, doc: doc,
    paintButtons: paintButtons, paintCount: paintCount, wire: wire
  };
})();
