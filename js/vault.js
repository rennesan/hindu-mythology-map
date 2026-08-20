/* ============================================================
   Private collections.

   A private pack ships as ciphertext. There is no server check to
   bypass and no hidden URL to guess: without the passphrase the
   bytes are noise. Decryption happens here, in memory, and the
   plaintext is never written to storage.

   Two gates, doing two different jobs:
     1. an unlock word, which only reveals that the collection exists
     2. an account name and passphrase, which actually decrypt it

   Crypto matches packs/encrypt_pack.py: PBKDF2-HMAC-SHA256 at
   310,000 iterations derives a 256-bit key; AES-256-GCM decrypts,
   with the account name as additional authenticated data, so both
   the name and the passphrase must be right. A wrong value fails
   the GCM tag and throws - there is nothing to compare against and
   nothing to leak.
   ============================================================ */
"use strict";

const Vault = (function () {
  const open = {};        // pid -> { dataset, portraits: {file: objectURL} }
  const revealed = new Set();
  let vaultInfo = {};     // pid -> vault.json

  const enc = new TextEncoder();

  function b64ToBytes(s) {
    const bin = atob(s);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  async function sha256Hex(text) {
    const buf = await crypto.subtle.digest("SHA-256", enc.encode(text));
    return Array.from(new Uint8Array(buf))
      .map(b => b.toString(16).padStart(2, "0")).join("");
  }

  function loadVault(pid) {
    if (vaultInfo[pid]) return Promise.resolve(vaultInfo[pid]);
    return fetch("/data/" + pid + "/vault.json")
      .then(r => { if (!r.ok) throw new Error("no vault"); return r.json(); })
      .then(v => { vaultInfo[pid] = v; return v; });
  }

  /* ---- gate 1: the unlock word only reveals the card on the hub ---- */

  function isRevealed(pid) { return revealed.has(pid); }

  function restoreReveals() {
    try {
      const raw = readStore("hm-revealed");
      if (raw) JSON.parse(raw).forEach(p => revealed.add(p));
    } catch (e) { /* ignore */ }
  }

  function tryUnlockWord(word) {
    const privates = APP.manifest.filter(p => p.status === "private");
    return Promise.all(privates.map(p =>
      loadVault(p.id).then(v => sha256Hex(word.trim()).then(h =>
        (v.unlockHash && h === v.unlockHash) ? p.id : null
      )).catch(() => null)
    )).then(hits => {
      const found = hits.filter(Boolean);
      found.forEach(pid => revealed.add(pid));
      if (found.length) {
        store("hm-revealed", JSON.stringify(Array.from(revealed)));
        buildLanding();
      }
      return found;
    });
  }

  /* ---- gate 2: the credentials that actually decrypt ---- */

  function isOpen(pid) { return !!open[pid]; }

  async function unlock(pid, account, passphrase) {
    const v = await loadVault(pid);
    const salt = b64ToBytes(v.salt);
    const iv = b64ToBytes(v.iv);

    const baseKey = await crypto.subtle.importKey(
      "raw", enc.encode(passphrase), "PBKDF2", false, ["deriveKey"]);
    const key = await crypto.subtle.deriveKey(
      { name: "PBKDF2", salt: salt, iterations: v.iterations, hash: "SHA-256" },
      baseKey, { name: "AES-GCM", length: 256 }, false, ["decrypt"]);

    const ct = await fetch("/data/" + pid + "/pack.enc").then(r => r.arrayBuffer());

    /* throws on a wrong account name or passphrase: the GCM tag will not verify */
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: iv, additionalData: enc.encode(account) }, key, ct);

    const payload = JSON.parse(new TextDecoder().decode(plain));

    /* portraits become object URLs held only in memory */
    const urls = {};
    Object.keys(payload.portraits || {}).forEach(fn => {
      const bytes = b64ToBytes(payload.portraits[fn]);
      const type = fn.endsWith(".png") ? "image/png"
        : fn.endsWith(".jpg") || fn.endsWith(".jpeg") ? "image/jpeg" : "image/webp";
      urls[fn] = URL.createObjectURL(new Blob([bytes], { type: type }));
    });

    open[pid] = { dataset: payload.dataset, portraits: urls };
    revealed.add(pid);
    store("hm-revealed", JSON.stringify(Array.from(revealed)));
    return open[pid];
  }

  /* rewrite portrait paths to the in-memory blobs */
  function attach(pid) {
    const o = open[pid];
    if (!o) return null;
    const d = o.dataset;
    d.entities.forEach(e => {
      const file = e.portrait.split("/").pop();
      if (o.portraits[file]) e.portrait = o.portraits[file];
    });
    return d;
  }

  function close(pid) {
    const o = open[pid];
    if (!o) return;
    Object.keys(o.portraits).forEach(f => URL.revokeObjectURL(o.portraits[f]));
    delete open[pid];
    if (APP.pid === pid) { APP.pid = null; APP.data = null; }
  }

  function closeAll() { Object.keys(open).forEach(close); }

  return { isRevealed, isOpen, restoreReveals, tryUnlockWord, unlock, attach, close, closeAll };
})();

/* ---------------- the credential screen ---------------- */

const VaultGate = (function () {
  function show(pid, onDone) {
    const entry = APP.manifest.find(p => p.id === pid) || { label: pid };
    const view = $("#view-vault");
    $("#vault-title").textContent = entry.label + " - private collection";
    $("#vault-note").textContent =
      "This collection is encrypted. The account name and passphrase are the key: " +
      "they are not checked against a list, they decrypt the file. Nothing is stored " +
      "on this device and nothing is sent anywhere.";
    $("#vault-error").hidden = true;
    $("#vault-account").value = "";
    $("#vault-pass").value = "";
    showView("vault");
    $("#vault-account").focus();

    const form = $("#vault-form");
    form.onsubmit = ev => {
      ev.preventDefault();
      const btn = $("#vault-submit");
      btn.disabled = true;
      btn.textContent = "Opening...";
      $("#vault-error").hidden = true;
      /* the KDF is deliberately slow; let the button repaint first */
      setTimeout(() => {
        Vault.unlock(pid, $("#vault-account").value, $("#vault-pass").value)
          .then(() => {
            btn.disabled = false;
            btn.textContent = "Open";
            $("#vault-pass").value = "";
            onDone();
          })
          .catch(() => {
            btn.disabled = false;
            btn.textContent = "Open";
            const err = $("#vault-error");
            err.hidden = false;
            err.textContent = "That account name and passphrase do not open this collection.";
            $("#vault-pass").value = "";
            $("#vault-pass").focus();
          });
      }, 30);
    };
  }
  return { show };
})();
