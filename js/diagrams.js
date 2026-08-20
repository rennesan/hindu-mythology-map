/* ============================================================
   Hierarchy diagram (per pantheon) and the comparative matrix
   (across every pantheon in the manifest).
   ============================================================ */
"use strict";

/* Fetch and cache every pack without changing the active pantheon. */
function loadAllPacks() {
  return Promise.all(APP.manifest.filter(p => p.status === "live").map(p =>
    APP.packs[p.id]
      ? Promise.resolve(APP.packs[p.id])
      : fetch("/data/" + p.id + "/dataset.json").then(r => r.json())
          .then(d => { APP.packs[p.id] = d; return d; })
          .catch(() => null)
  )).then(list => list.filter(Boolean));
}

/* ---------------- Hierarchy ---------------- */

const Hierarchy = (function () {
  function build() {
    const d = APP.data;
    const levels = d.hierarchy || [];
    const meta = d.meta || {};
    $("#hier-title").textContent = meta.label + " Divine System Hierarchy";
    $("#hier-structure").textContent = levels.map(l => l.title).join("  →  ");
    $("#hier-mechanism").textContent = (d.profile && d.profile.systemMechanism) || "";
    $("#hier-print").onclick = () => window.print();

    $("#hier-levels").innerHTML = levels.map((lv, i) => {
      const members = lv.memberIds.map(id => entity(id)).filter(Boolean);
      return '<section class="hier-level">' +
        '<header class="hier-level-head">' +
          '<span class="hier-level-num">Level ' + (i + 1) + "</span>" +
          '<h3 class="hier-level-title">' + esc(lv.title) + "</h3>" +
        "</header>" +
        '<p class="hier-level-blurb">' + esc(lv.blurb) + "</p>" +
        '<div class="hier-cards">' + members.map(e =>
          '<a class="hier-card" href="' + figureHash(e.id) + '" style="--band:' + catColor(e.category) + '">' +
            '<img src="' + esc(portraitPath(e)) + '" alt="Portrait of ' + esc(shortName(e)) +
              '" loading="lazy" decoding="async" width="72" height="72">' +
            '<h4 class="hier-card-name">' + esc(shortName(e)) + "</h4>" +
            '<p class="hier-card-role">' + esc(e.role) + "</p>" +
            '<p class="hier-card-detail">' + esc(e.bio || "") + "</p>" +
          "</a>").join("") +
        "</div>" +
        (lv.connectorCaption
          ? '<p class="hier-connector"><span aria-hidden="true">&#9660;</span> ' +
            esc(lv.connectorCaption) + ' <span aria-hidden="true">&#9660;</span></p>'
          : "") +
      "</section>";
    }).join("");
  }
  return { build };
})();

/* ---------------- Comparative matrix ---------------- */

const Compare = (function () {
  const ROWS = [
    ["cosmicNature", "Cosmic nature & time"],
    ["natureOfDivinity", "Nature of divinity"],
    ["afterlife", "Afterlife & judgment"],
    ["systemMechanism", "System mechanism"],
    ["canonTexts", "Canonical texts"]
  ];

  function build() {
    loadAllPacks().then(packs => {
      packs.sort((a, b) => APP.manifest.findIndex(m => m.id === a.meta.id) -
                           APP.manifest.findIndex(m => m.id === b.meta.id));
      renderStructure(packs);
      renderArchetypes(packs);
      const note = $("#compare-note");
      if (packs.length < 2) {
        note.hidden = false;
        note.textContent = "One tradition is mapped so far, so this page reads as a single column. " +
          "Every mythology added to the site becomes another column here automatically, and the " +
          "archetype rows below are what line the pantheons up against each other.";
      } else note.hidden = true;
    });
  }

  function renderStructure(packs) {
    const head = "<thead><tr><th scope='col'>System aspect</th>" +
      packs.map(p => "<th scope='col'>" + esc(p.meta.label) +
        "<span class='col-sub'>" + esc(p.meta.sublabel || "") + "</span></th>").join("") +
      "</tr></thead>";
    const body = "<tbody>" + ROWS.map(([key, label]) =>
      "<tr><th scope='row'>" + esc(label) + "</th>" +
      packs.map(p => "<td>" + esc((p.profile && p.profile[key]) || "-") + "</td>").join("") +
      "</tr>").join("") + "</tbody>";
    $("#compare-structure").innerHTML = head + body;
  }

  function renderArchetypes(packs) {
    const used = APP.archetypes.filter(a =>
      packs.some(p => p.entities.some(e => (e.archetypes || []).includes(a.key))));

    const head = "<thead><tr><th scope='col'>Archetype</th>" +
      packs.map(p => "<th scope='col'>" + esc(p.meta.label) + "</th>").join("") + "</tr></thead>";

    const body = "<tbody>" + used.map(a =>
      "<tr><th scope='row'><span class='arch-name'>" + esc(a.label) + "</span>" +
      "<span class='arch-blurb'>" + esc(a.blurb) + "</span></th>" +
      packs.map(p => {
        const hits = p.entities.filter(e => (e.archetypes || []).includes(a.key));
        if (!hits.length) return "<td class='is-empty'>-</td>";
        return "<td>" + hits.map(e =>
          '<a class="cast-chip" href="/' + esc(p.meta.id) + '/figure/' + esc(e.id) + '">' +
          '<img src="' + esc(portraitPath(e)) + '" alt="" loading="lazy" decoding="async" width="26" height="26">' +
          "<span>" + esc(shortName(e)) + "</span></a>").join("") + "</td>";
      }).join("") + "</tr>").join("") + "</tbody>";

    $("#compare-archetypes").innerHTML = head + body;
  }

  return { build };
})();
