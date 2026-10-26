/* Type Beat — scout YouTube for type beats, read descriptions for free downloads and license terms, keep a crate.
   Everything is stored in this browser (localStorage). The YouTube API key never leaves the device except to Google. */
(function () {
  "use strict";
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const API = "https://www.googleapis.com/youtube/v3/";

  /* ---------- small helpers ---------- */
  function ls(k, v) {
    try {
      if (v === undefined) return JSON.parse(localStorage.getItem(k) || "null");
      if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v));
    } catch (e) { return null; }
  }
  function toast(msg) { const t = $("#toast"); t.textContent = msg; t.hidden = false; clearTimeout(toast._t); toast._t = setTimeout(() => (t.hidden = true), 2400); }
  function getKey() { return ls("tb.key") || ""; }
  function fmtViews(n) { n = +n || 0; return n >= 1e6 ? (n / 1e6).toFixed(1) + "M" : n >= 1e3 ? Math.round(n / 1e3) + "K" : String(n); }
  function ago(iso) {
    const d = (Date.now() - new Date(iso)) / 864e5;
    if (d < 1) return "today"; if (d < 2) return "yesterday"; if (d < 30) return Math.floor(d) + " days ago";
    if (d < 365) return Math.floor(d / 30) + " mo ago"; return Math.floor(d / 365) + " yr ago";
  }
  function videoId(u) { const m = String(u).match(/(?:youtu\.be\/|v=|shorts\/|embed\/|live\/)([A-Za-z0-9_-]{11})/); return m ? m[1] : ""; }
  function thumb(id) { return "https://i.ytimg.com/vi/" + id + "/mqdefault.jpg"; }

  /* ---------- YouTube API ---------- */
  class ApiError extends Error {}
  async function yt(path, params) {
    const key = getKey();
    if (!key) throw new ApiError("Add your YouTube API key in Settings first.");
    const qs = new URLSearchParams({ ...params, key });
    let res;
    try { res = await fetch(API + path + "?" + qs); }
    catch (e) { throw new ApiError("Couldn't reach YouTube. Check your connection and try again."); }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = data.error || {};
      const reason = (err.errors && err.errors[0] && err.errors[0].reason) || (err.details && err.details[0] && err.details[0].reason) || "";
      const msg = String(err.message || "");
      if (/quota/i.test(reason)) throw new ApiError("You've used today's free YouTube quota. It resets at midnight Pacific time.");
      if (/keyInvalid|API_KEY_INVALID/i.test(reason) || /API key not valid/i.test(msg)) throw new ApiError("Google says this API key isn't valid. Copy it again from Google Cloud Console → Credentials.");
      if (/accessNotConfigured|SERVICE_DISABLED/i.test(reason) || /has not been used|is disabled/i.test(msg)) throw new ApiError("YouTube Data API v3 isn't turned on for this key's project. Enable it in Google Cloud Console → APIs & Services → Library.");
      if (/REFERRER|referer/i.test(reason + msg)) throw new ApiError("This key is restricted to other websites. In Credentials, add " + location.origin + "/* under Website restrictions.");
      throw new ApiError("YouTube refused the request" + (msg ? ": " + msg : "."));
    }
    return data;
  }
  async function videoDetails(ids) {
    if (!ids.length) return [];
    const d = await yt("videos", { part: "snippet,statistics", id: ids.join(","), maxResults: 50 });
    return d.items || [];
  }

  /* ---------- Description reader ---------- */
  const DL_HOSTS = /(hypeddit\.com|beatstars\.com|bsta\.rs|drive\.google\.com|dropbox\.com|mediafire\.com|wetransfer\.com|we\.tl|toneden\.io|gumroad\.com|payhip\.com|airbit\.com|traktrain\.com|bit\.ly|linktr\.ee|fanlink\.to|smarturl\.it|soundcloud\.com|mega\.nz|untitled\.stream|bandcamp\.com|show\.co|ffm\.to)/i;
  function readDescription(text, title) {
    text = String(text || ""); title = String(title || "");
    const out = { links: [], license: "unknown", credit: false, flags: [], producer: "", bpm: "", key: "" };
    if (!text.trim() && !title.trim()) return out;
    text.split(/\n/).forEach((line) => {
      (line.match(/https?:\/\/[^\s)>\]]+/g) || []).forEach((raw) => {
        const u = raw.replace(/[.,!]+$/, "");
        if (!DL_HOSTS.test(u)) return;
        const free = /free|download|\bdl\b|⬇|📥|📩/i.test(line) && !/purchase|buy|lease/i.test(line);
        if (!out.links.some((l) => l.url === u)) out.links.push({ url: u, free });
      });
    });
    out.links.sort((a, b) => b.free - a.free);
    const t = (title + "\n" + text).toLowerCase();
    const ffp = /free\s*(for|4)\s*profit/.test(t);
    const np = /(non[\s-]?profit|not\s*for\s*profit|free\s*for\s*non|no\s*profit|non[\s-]?commercial)/.test(t);
    const lease = /(lease|purchase|buy\s*(this|beat|now|here)|exclusive|licen[cs]e|for\s*profit\s*use|untagged)/.test(t);
    out.credit = /(credit|prod\.?\s*by|\(prod|tag\s*me|must\s*tag)/.test(t);
    if (ffp) { out.license = "ffp"; out.flags.push("Says free for profit"); }
    else if (np) { out.license = "nonprofit"; out.flags.push("Free only for non-profit use"); }
    else if (lease) { out.license = "lease"; out.flags.push("Mentions leases or purchase"); }
    if (np && lease && !ffp) out.flags.push("Lease needed if you earn money from it");
    if (out.credit) out.flags.push("Asks for producer credit");
    const prod = (title + "\n" + text).match(/prod\.?\s*(?:by)?\s*[:@]?\s*([^\n|()\[\]]{2,40})/i);
    out.producer = prod ? prod[1].trim().replace(/[.,]+$/, "") : "";
    const bpm = t.match(/(\d{2,3})\s*bpm/) || t.match(/bpm\s*[:\-]?\s*(\d{2,3})/);
    out.bpm = bpm ? bpm[1] : "";
    const key = (title + "\n" + text).match(/key\s*[:\-]?\s*([A-G][#b♯♭]?\s*(?:maj(?:or)?|min(?:or)?|m)?)\b/i);
    out.key = key ? key[1].trim() : "";
    out.freeDL = out.links.some((l) => l.free);
    return out;
  }
  const LIC = { ffp: ["Free for profit", "t-free"], nonprofit: ["Non-profit only", "t-np"], lease: ["Lease needed", "t-lease"], unknown: ["License unclear", "t-unk"] };
  window.TypeBeatReader = readDescription; // exposed for testing

  /* ---------- Crate storage ---------- */
  let beats = loadCrate();
  function loadCrate() { const o = ls("tb.crate") || {}; return Object.entries(o).map(([id, d]) => ({ id, ...d })); }
  function persist() { const o = {}; beats.forEach(({ id, ...d }) => (o[id] = d)); ls("tb.crate", o); renderCrate(); renderResults(); }
  function saveBeat(id, data) { const i = beats.findIndex((b) => b.id === id); if (i >= 0) beats[i] = { id, ...data }; else beats.push({ id, ...data }); persist(); }
  function removeBeat(id) { beats = beats.filter((b) => b.id !== id); persist(); }
  function newId() { return "b" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
  function savedByVideo(vid) { return vid && beats.find((b) => b.videoId === vid); }

  /* ---------- Tabs ---------- */
  function show(view) {
    const scout = view === "scout";
    $("#tab-scout").setAttribute("aria-selected", scout); $("#tab-crate").setAttribute("aria-selected", !scout);
    $("#view-scout").hidden = !scout; $("#view-crate").hidden = scout; ls("tb.tab", view);
  }
  $("#tab-scout").onclick = () => show("scout");
  $("#tab-crate").onclick = () => show("crate");
  if (location.hash === "#crate" || ls("tb.tab") === "crate") show("crate");

  /* ---------- Settings ---------- */
  const dlg = $("#settings");
  function openSettings() { $("#api-key").value = getKey(); $("#key-msg").textContent = ""; $("#backup-msg").textContent = ""; dlg.showModal(); }
  $("#open-settings").onclick = openSettings;
  $("#banner-settings").onclick = openSettings;
  $("#show-key").onclick = () => { const i = $("#api-key"); const s = i.type === "password"; i.type = s ? "text" : "password"; $("#show-key").textContent = s ? "Hide" : "Show"; };
  $("#save-key").onclick = async () => {
    const k = $("#api-key").value.trim(); const m = $("#key-msg"); m.className = "note";
    if (!k) { ls("tb.key", null); m.textContent = "Key removed from this device."; updateBanner(); return; }
    ls("tb.key", k); updateBanner(); m.innerHTML = '<span class="spinner"></span> Testing…';
    try { await yt("videos", { part: "id", id: "jNQXAC9IVRw" }); m.textContent = "Key works. You're ready to scout."; }
    catch (e) { m.className = "note err"; m.textContent = e.message; }
  };
  function updateBanner() { $("#key-banner").hidden = !!getKey(); }
  updateBanner();

  $("#export-btn").onclick = () => {
    const blob = new Blob([JSON.stringify({ app: "type-beat", exported: new Date().toISOString(), crate: ls("tb.crate") || {} }, null, 2)], { type: "application/json" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob);
    a.download = "type-beat-crate-" + new Date().toISOString().slice(0, 10) + ".json";
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    $("#backup-msg").textContent = "Exported " + beats.length + " beats.";
  };
  $("#import-file").onchange = async (e) => {
    const f = e.target.files[0]; if (!f) return; const m = $("#backup-msg");
    try {
      const j = JSON.parse(await f.text()); const crate = j.crate || j; let n = 0;
      Object.entries(crate).forEach(([id, d]) => { if (d && typeof d === "object" && (d.title || d.url)) { const i = beats.findIndex((b) => b.id === id); if (i >= 0) beats[i] = { id, ...d }; else beats.push({ id, ...d }); n++; } });
      persist(); m.textContent = "Imported " + n + " beats.";
    } catch (err) { m.textContent = "That file isn't a Type Beat backup."; }
    e.target.value = "";
  };

  /* ---------- Scout ---------- */
  let results = []; let nextToken = null; let lastQuery = null; let scouting = false;
  function mods() { const m = {}; document.querySelectorAll("#mods .chip").forEach((c) => (m[c.dataset.mod] = c.getAttribute("aria-pressed") === "true")); return m; }
  $("#mods").addEventListener("click", (e) => {
    const c = e.target.closest(".chip"); if (!c) return;
    const on = c.getAttribute("aria-pressed") !== "true"; c.setAttribute("aria-pressed", on);
    if (on && c.dataset.mod === "week") $('[data-mod="month"]').setAttribute("aria-pressed", "false");
    if (on && c.dataset.mod === "month") $('[data-mod="week"]').setAttribute("aria-pressed", "false");
  });
  function renderRecent() {
    const r = ls("tb.recent") || []; const el = $("#recent");
    el.innerHTML = r.length ? '<span class="lbl">Recent:</span>' + r.map((a) => `<button type="button" class="chip" data-recent="${esc(a)}">${esc(a)}</button>`).join("") : "";
  }
  $("#recent").addEventListener("click", (e) => { const c = e.target.closest("[data-recent]"); if (!c) return; $("#artist").value = c.dataset.recent; scout(false); });
  renderRecent();

  function buildQuery(artist, m) {
    const parts = [artist, "type beat"];
    if (m.ffp) parts.push("free for profit"); else if (m.free) parts.push("free download");
    const p = { part: "snippet", type: "video", maxResults: 25, q: parts.join(" "), order: m.new ? "date" : "relevance", safeSearch: "none" };
    if (m.week || m.month) p.publishedAfter = new Date(Date.now() - (m.week ? 7 : 30) * 864e5).toISOString();
    return p;
  }
  async function scout(more) {
    if (scouting) return;
    const artist = $("#artist").value.trim(); const msg = $("#scout-msg"); msg.className = "note";
    if (!more) {
      if (!artist) { msg.textContent = "Type an artist name to scout."; return; }
      if (!getKey()) { openSettings(); return; }
      lastQuery = { artist, params: buildQuery(artist, mods()) }; results = []; nextToken = null;
      let r = (ls("tb.recent") || []).filter((x) => x.toLowerCase() !== artist.toLowerCase()); r.unshift(artist); ls("tb.recent", r.slice(0, 8)); renderRecent();
    }
    scouting = true; const btn = more ? $("#more-btn") : $("#scout-btn"); const label = btn.textContent;
    btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Scouting';
    msg.textContent = more ? "" : "Searching YouTube and reading descriptions…";
    try {
      const params = { ...lastQuery.params }; if (more && nextToken) params.pageToken = nextToken;
      const s = await yt("search", params); nextToken = s.nextPageToken || null;
      const ids = (s.items || []).map((i) => i.id && i.id.videoId).filter(Boolean);
      const vids = await videoDetails(ids);
      const byId = Object.fromEntries(vids.map((v) => [v.id, v]));
      ids.forEach((id) => {
        const v = byId[id]; if (!v || results.some((r) => r.videoId === id)) return;
        const sn = v.snippet || {};
        results.push({
          videoId: id, title: sn.title || "", channel: sn.channelTitle || "", published: sn.publishedAt,
          views: (v.statistics || {}).viewCount, description: sn.description || "", artist: lastQuery.artist,
          read: readDescription(sn.description, sn.title), thumb: (sn.thumbnails && (sn.thumbnails.medium || sn.thumbnails.default) || {}).url || thumb(id)
        });
      });
      msg.textContent = results.length ? "" : "No beats found. Try fewer filters or a different spelling.";
    } catch (e) { msg.className = "note err"; msg.textContent = e.message; }
    finally { scouting = false; btn.disabled = false; btn.textContent = label; renderResults(); }
  }
  $("#scout-form").addEventListener("submit", (e) => { e.preventDefault(); scout(false); });
  $("#more-btn").onclick = () => scout(true);
  $("#only-free").onclick = (e) => { const c = e.currentTarget; c.setAttribute("aria-pressed", c.getAttribute("aria-pressed") !== "true"); renderResults(); };

  function licenseChips(read, credit) {
    const lic = LIC[read.license || read] || LIC.unknown;
    return `<span class="tag ${lic[1]}">${lic[0]}</span>` + (credit ? '<span class="tag t-credit">Credit producer</span>' : "");
  }
  function renderResults() {
    const box = $("#results"); const onlyFree = $("#only-free").getAttribute("aria-pressed") === "true";
    $("#resultbar").hidden = !results.length; $("#more-btn").hidden = !nextToken || !results.length;
    if (!results.length) { box.innerHTML = ""; return; }
    const freeCount = results.filter((r) => r.read.freeDL).length;
    $("#result-summary").textContent = results.length + " beats · " + freeCount + " with a free download link";
    const list = onlyFree ? results.filter((r) => r.read.freeDL) : results;
    if (!list.length) { box.innerHTML = '<div class="empty"><strong>No free download links yet</strong>Load more results or turn off the filter.</div>'; return; }
    box.innerHTML = list.map((r) => {
      const saved = savedByVideo(r.videoId);
      const links = r.read.links.slice(0, 3).map((l) => `<a href="${esc(l.url)}" target="_blank" rel="noopener">${l.free ? "⬇ " : ""}${esc(l.url.replace(/^https?:\/\//, "").slice(0, 60))}</a>`).join("");
      return `<article class="beat">
        <button class="thumb" data-play="${r.videoId}" aria-label="Preview ${esc(r.title)}"><img src="${esc(r.thumb)}" alt="" loading="lazy"><span class="play">▶ Preview</span></button>
        <div class="body">
          <h3>${esc(r.title)}</h3>
          <div class="meta"><span>${esc(r.channel)}</span><span>${fmtViews(r.views)} views</span><span>${ago(r.published)}</span>${r.read.bpm ? `<span>${esc(r.read.bpm)} BPM</span>` : ""}${r.read.key ? `<span>${esc(r.read.key)}</span>` : ""}</div>
          <div class="chips">${r.read.freeDL ? '<span class="tag t-dl">Free DL link</span>' : ""}${licenseChips(r.read, r.read.credit)}</div>
          ${links ? `<div class="links">${links}</div>` : ""}
          <div class="actions">${saved ? '<span class="tag t-free">In your crate</span>' : `<button class="btn small primary" data-save="${r.videoId}">Save to crate</button>`}<a class="btn small ghost" href="https://www.youtube.com/watch?v=${r.videoId}" target="_blank" rel="noopener">YouTube ↗</a></div>
        </div></article>`;
    }).join("");
  }
  $("#results").addEventListener("click", (e) => {
    const p = e.target.closest("[data-play]"); if (p) { play(p.dataset.play); return; }
    const s = e.target.closest("[data-save]"); if (!s) return;
    const r = results.find((x) => x.videoId === s.dataset.save); if (!r) return;
    saveBeat(newId(), {
      url: "https://www.youtube.com/watch?v=" + r.videoId, videoId: r.videoId, title: r.title,
      producer: r.read.producer || r.channel, channel: r.channel, artist: r.artist, bpm: parseInt(r.read.bpm, 10) || null, key: r.read.key,
      license: r.read.license, download: (r.read.links.find((l) => l.free) || {}).url || "", links: r.read.links,
      tags: [], project: "", notes: "", credit: r.read.credit, description: r.description.slice(0, 5000), rating: 0, savedAt: new Date().toISOString()
    });
    toast("Saved to crate");
  });

  /* ---------- Player ---------- */
  function play(id) {
    $("#player-frame").innerHTML = `<iframe src="https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}?autoplay=1&rel=0" allow="autoplay; encrypted-media; picture-in-picture" allowfullscreen title="Beat preview"></iframe>`;
    $("#player").showModal();
  }
  $("#player").addEventListener("close", () => ($("#player-frame").innerHTML = ""));

  /* ---------- Manual add / edit ---------- */
  let editingId = null; let lastRead = null;
  function applyDescription() {
    const desc = $("#f-desc").value; const r = readDescription(desc, $("#f-title").value); lastRead = r; const box = $("#detect");
    if (!desc.trim()) { box.hidden = true; return; }
    box.hidden = false;
    box.innerHTML = `<div class="chips">${licenseChips(r, r.credit)}${r.freeDL ? '<span class="tag t-dl">Free DL link</span>' : ""}</div>` +
      (r.flags.length ? `<div>${r.flags.map(esc).join(" · ")}</div>` : '<div class="note">No license wording found. Check the producer\'s page before you use it.</div>') +
      (r.links.length ? r.links.map((l, i) => `<div class="actions" style="justify-content:space-between"><a href="${esc(l.url)}" target="_blank" rel="noopener" style="min-width:0">${esc(l.url)}</a><button type="button" class="btn small" data-use="${i}">Use</button></div>`).join("") : '<div class="note">No download links in this description.</div>');
    if (!$("#f-dl").value && r.freeDL) $("#f-dl").value = r.links[0].url;
    $("#f-license").value = r.license; $("#f-credit").checked = r.credit;
    if (!$("#f-producer").value && r.producer) $("#f-producer").value = r.producer;
    if (!$("#f-bpm").value && r.bpm) $("#f-bpm").value = r.bpm;
    if (!$("#f-key").value && r.key) $("#f-key").value = r.key;
  }
  let descT; $("#f-desc").addEventListener("input", () => { clearTimeout(descT); descT = setTimeout(applyDescription, 250); });
  $("#detect").addEventListener("click", (e) => { const b = e.target.closest("[data-use]"); if (!b || !lastRead) return; $("#f-dl").value = lastRead.links[+b.dataset.use].url; toast("Download link set"); });
  $("#fetch-btn").onclick = async () => {
    const vid = videoId($("#f-url").value); const m = $("#form-msg"); m.className = "note";
    if (!vid) { m.textContent = "Paste a YouTube video link first."; return; }
    m.innerHTML = '<span class="spinner"></span> Getting details…';
    try {
      const [v] = await videoDetails([vid]); if (!v) { m.textContent = "YouTube couldn't find that video."; return; }
      $("#f-title").value = v.snippet.title; $("#f-desc").value = v.snippet.description;
      if (!$("#f-producer").value) $("#f-producer").value = v.snippet.channelTitle;
      applyDescription(); m.textContent = "Filled in. Check the details, then save.";
    } catch (e) { m.className = "note err"; m.textContent = e.message; }
  };
  const FIELDS = ["url", "desc", "title", "producer", "artist", "bpm", "key", "license", "dl", "tags", "project", "notes"];
  function clearForm() { FIELDS.forEach((f) => ($("#f-" + f).value = f === "license" ? "unknown" : "")); $("#f-credit").checked = false; $("#detect").hidden = true; editingId = null; $("#save-btn").textContent = "Save to crate"; $("#form-msg").textContent = ""; }
  $("#clear-btn").onclick = clearForm;
  $("#add-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const url = $("#f-url").value.trim(); const vid = videoId(url); const m = $("#form-msg"); m.className = "note";
    if (!url && !$("#f-title").value.trim()) { m.textContent = "Add a YouTube link or a title so you can find this beat again."; return; }
    if (url && !vid && /youtu/.test(url)) { m.textContent = "That link doesn't look like a YouTube video. Copy it from the Share button and try again."; return; }
    const old = editingId ? beats.find((b) => b.id === editingId) : null;
    saveBeat(editingId || newId(), {
      ...(old || {}),
      url, videoId: vid, title: $("#f-title").value.trim() || "Untitled beat", producer: $("#f-producer").value.trim(), artist: $("#f-artist").value.trim(),
      bpm: parseInt($("#f-bpm").value, 10) || null, key: $("#f-key").value.trim(), license: $("#f-license").value, download: $("#f-dl").value.trim(),
      tags: $("#f-tags").value.split(",").map((s) => s.trim()).filter(Boolean), project: $("#f-project").value.trim(), notes: $("#f-notes").value.trim(),
      credit: $("#f-credit").checked, description: $("#f-desc").value.slice(0, 5000), rating: old ? old.rating || 0 : 0, savedAt: old ? old.savedAt : new Date().toISOString()
    });
    toast(editingId ? "Beat updated" : "Saved to crate"); clearForm();
  });

  /* ---------- Crate ---------- */
  function hash(s) { let h = 2166136261; for (const c of String(s)) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; }
  function drawWave(cv, seed) {
    const r = cv.getBoundingClientRect(); const w = Math.max(60, r.width), h = Math.max(60, r.height); const d = window.devicePixelRatio || 1;
    cv.width = w * d; cv.height = h * d; const x = cv.getContext("2d"); x.scale(d, d);
    x.fillStyle = getComputedStyle(document.documentElement).getPropertyValue("--accent").trim() || "#2E47F0";
    let s = hash(seed) || 1; const rnd = () => ((s = Math.imul(s ^ (s >>> 15), 2246822507) >>> 0), (s % 1000) / 1000);
    const n = Math.floor(w / 5);
    for (let i = 0; i < n; i++) { const amp = 0.15 + 0.85 * Math.abs(Math.sin(i * 0.35 + rnd() * 2)) * (0.5 + rnd() * 0.5); const len = amp * (h - 12); x.globalAlpha = 0.35 + amp * 0.6; x.fillRect(i * 5 + 2, (h - len) / 2, 3, len); }
  }
  function filtered() {
    const q = $("#q").value.trim().toLowerCase(), lic = $("#fl-license").value, dl = $("#fl-dl").getAttribute("aria-pressed") === "true", sort = $("#fl-sort").value;
    const r = beats.filter((b) => (!lic || b.license === lic) && (!dl || b.download) && (!q || [b.title, b.producer, b.artist, b.notes, b.project, (b.tags || []).join(" "), b.key].join(" ").toLowerCase().includes(q)));
    const by = { new: (a, b) => String(b.savedAt).localeCompare(String(a.savedAt)), rating: (a, b) => (b.rating || 0) - (a.rating || 0), bpm: (a, b) => (a.bpm || 999) - (b.bpm || 999), artist: (a, b) => String(a.artist || "").localeCompare(String(b.artist || "")) };
    return r.sort(by[sort]);
  }
  let confirmId = null;
  function renderCrate() {
    $("#crate-count").textContent = beats.length;
    const list = $("#list"); const r = filtered();
    if (!beats.length) { list.innerHTML = '<div class="empty"><strong>Your crate is empty</strong>Scout an artist and tap “Save to crate” on beats you like. They show up here with their license and download link.</div>'; return; }
    if (!r.length) { list.innerHTML = '<div class="empty"><strong>No beats match</strong>Try clearing the search or filters.</div>'; return; }
    list.innerHTML = r.map((b) => {
      const yt = b.url ? `<a class="btn small ghost" href="${esc(b.url)}" target="_blank" rel="noopener">YouTube ↗</a>` : "";
      const dl = b.download ? `<a class="btn small primary" href="${esc(b.download)}" target="_blank" rel="noopener">Get download ↗</a>` : "";
      const stars = [1, 2, 3, 4, 5].map((n) => `<button class="star ${n <= (b.rating || 0) ? "on" : ""}" data-rate="${n}" data-id="${b.id}" aria-label="Rate ${n} of 5">★</button>`).join("");
      const meta = [b.producer && "prod. " + esc(b.producer), b.artist && esc(b.artist) + " type", b.bpm && b.bpm + " BPM", b.key && esc(b.key), b.project && "→ " + esc(b.project)].filter(Boolean).map((s) => `<span>${s}</span>`).join("");
      const art = b.videoId ? `<button class="thumb" data-play="${b.videoId}" aria-label="Preview"><img src="${thumb(b.videoId)}" alt="" loading="lazy"><span class="play">▶</span></button>` : `<div class="thumb"><canvas data-seed="${esc(b.id)}"></canvas></div>`;
      return `<article class="beat">${art}<div class="body">
        <div class="top"><h3>${esc(b.title)}</h3><div class="stars">${stars}</div></div>
        ${meta ? `<div class="meta">${meta}</div>` : ""}
        <div class="chips">${licenseChips(b.license, b.credit)}${(b.tags || []).map((t) => `<span class="tag t-unk">${esc(t)}</span>`).join("")}</div>
        ${b.notes ? `<p class="notes">${esc(b.notes)}</p>` : ""}
        <div class="actions">${dl}${yt}<button class="btn small ghost" data-edit="${b.id}">Edit</button>${confirmId === b.id ? `<span class="confirm">Remove? <button class="btn small danger" data-del="${b.id}">Remove</button><button class="btn small ghost" data-cancel="1">Keep</button></span>` : `<button class="btn small ghost" data-ask="${b.id}">Remove</button>`}</div>
      </div></article>`;
    }).join("");
    list.querySelectorAll("canvas").forEach((c) => drawWave(c, c.dataset.seed));
  }
  ["#q", "#fl-license", "#fl-sort"].forEach((s) => $(s).addEventListener("input", renderCrate));
  $("#fl-dl").onclick = (e) => { const c = e.currentTarget; c.setAttribute("aria-pressed", c.getAttribute("aria-pressed") !== "true"); renderCrate(); };
  $("#list").addEventListener("click", (e) => {
    const t = e.target.closest("button"); if (!t) return;
    if (t.dataset.play) play(t.dataset.play);
    else if (t.dataset.rate) { const b = beats.find((x) => x.id === t.dataset.id); if (!b) return; const n = +t.dataset.rate; const { id, ...rest } = b; saveBeat(id, { ...rest, rating: b.rating === n ? 0 : n }); }
    else if (t.dataset.ask) { confirmId = t.dataset.ask; renderCrate(); }
    else if (t.dataset.cancel) { confirmId = null; renderCrate(); }
    else if (t.dataset.del) { confirmId = null; removeBeat(t.dataset.del); toast("Removed"); }
    else if (t.dataset.edit) {
      const b = beats.find((x) => x.id === t.dataset.edit); if (!b) return; editingId = b.id;
      const map = { url: b.url, desc: b.description, title: b.title, producer: b.producer, artist: b.artist, bpm: b.bpm || "", key: b.key, license: b.license || "unknown", dl: b.download, tags: (b.tags || []).join(", "), project: b.project, notes: b.notes };
      Object.entries(map).forEach(([k, v]) => ($("#f-" + k).value = v ?? "")); $("#f-credit").checked = !!b.credit; $("#detect").hidden = true;
      $("#save-btn").textContent = "Update beat"; show("scout"); $(".manual").open = true; $(".manual").scrollIntoView({ behavior: "smooth" });
    }
  });
  window.addEventListener("storage", (e) => { if (e.key === "tb.crate") { beats = loadCrate(); renderCrate(); renderResults(); } });
  renderCrate();

  /* ---------- Offline shell ---------- */
  if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("sw.js").catch(() => {});
})();
