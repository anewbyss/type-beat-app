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

  /* ---------- Google sign-in (token lives in this tab's session only) ---------- */
  const SCOPE = "https://www.googleapis.com/auth/youtube";
  const DEFAULT_CLIENT_ID = "117832122780-ea8f6vhegjdbb8r1d0m7m12ulnl30oat.apps.googleusercontent.com"; // public OAuth client ID (not a secret)
  function clientId() { return ls("tb.clientId") || DEFAULT_CLIENT_ID; }
  function getToken() {
    try { const t = JSON.parse(sessionStorage.getItem("tb.token") || "null"); return t && t.exp > Date.now() + 60000 ? t.value : ""; } catch (e) { return ""; }
  }
  function setToken(value, secs) {
    try { if (value) sessionStorage.setItem("tb.token", JSON.stringify({ value, exp: Date.now() + secs * 1000 })); else sessionStorage.removeItem("tb.token"); } catch (e) {}
  }
  let tokenClient = null; let pendingSignIn = null;
  function gisReady() { return !!(window.google && google.accounts && google.accounts.oauth2); }
  function waitForGis(ms = 8000) {
    return new Promise((res, rej) => { const t0 = Date.now(); (function poll() { if (gisReady()) return res(); if (Date.now() - t0 > ms) return rej(new ApiError("Google sign-in didn't load. Check your connection or turn off content blockers for this site.")); setTimeout(poll, 150); })(); });
  }
  async function signIn(silent) {
    const id = clientId();
    if (!id) { openSettings(); throw new ApiError("Add your OAuth client ID in Settings first."); }
    await waitForGis();
    if (!tokenClient || tokenClient._id !== id) {
      tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: id, scope: SCOPE,
        callback: (r) => {
          const p = pendingSignIn; pendingSignIn = null; if (!p) return;
          if (r && r.access_token) { setToken(r.access_token, +r.expires_in || 3600); p.res(r.access_token); }
          else p.rej(new ApiError("Sign-in didn't finish" + (r && r.error ? " (" + r.error + ")." : ".")));
        },
        error_callback: (e) => {
          const p = pendingSignIn; pendingSignIn = null; if (!p) return;
          p.rej(new ApiError(e && e.type === "popup_closed" ? "Sign-in window was closed." : e && e.type === "popup_failed_to_open" ? "Your browser blocked the sign-in window. Allow pop-ups for this site and try again." : "Sign-in failed. Try again."));
        }
      });
      tokenClient._id = id;
    }
    return new Promise((res, rej) => { pendingSignIn = { res, rej }; tokenClient.requestAccessToken(silent ? { prompt: "" } : {}); });
  }
  function signOut() {
    const t = getToken(); setToken(null); ls("tb.me", null);
    if (t && gisReady()) try { google.accounts.oauth2.revoke(t, () => {}); } catch (e) {}
    updateAuthUI(); toast("Signed out");
  }

  /* ---------- YouTube API ---------- */
  class ApiError extends Error {}
  async function yt(path, params, opts = {}) {
    const token = getToken(); const key = getKey();
    if (opts.auth && !token) throw new ApiError("Sign in with Google first.");
    if (!token && !key) throw new ApiError("Sign in with Google or add a YouTube API key in Settings first.");
    const qs = new URLSearchParams(params || {}); if (!token) qs.set("key", key);
    const init = { method: opts.method || "GET", headers: {} };
    if (token) init.headers.Authorization = "Bearer " + token;
    if (opts.body) { init.headers["Content-Type"] = "application/json"; init.body = JSON.stringify(opts.body); }
    let res;
    try { res = await fetch(API + path + "?" + qs, init); }
    catch (e) { throw new ApiError("Couldn't reach YouTube. Check your connection and try again."); }
    const data = res.status === 204 ? {} : await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = data.error || {};
      const reason = (err.errors && err.errors[0] && err.errors[0].reason) || (err.details && err.details[0] && err.details[0].reason) || "";
      const msg = String(err.message || "");
      if (res.status === 401) { setToken(null); updateAuthUI(); throw new ApiError("Your Google sign-in expired. Tap “Sign in with Google” again."); }
      if (/quota/i.test(reason)) throw new ApiError("You've used today's free YouTube quota. It resets at midnight Pacific time.");
      if (/insufficientPermissions|ACCESS_TOKEN_SCOPE_INSUFFICIENT/i.test(reason)) throw new ApiError("Google didn't grant YouTube access. Sign out, sign in again, and tick the YouTube box when asked.");
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
  function openSettings() {
    $("#api-key").value = getKey(); $("#client-id").value = clientId(); $("#auto-sync").checked = ls("tb.autoSync") !== false;
    $("#key-msg").textContent = ""; $("#backup-msg").textContent = ""; $("#client-msg").textContent = "";
    if (!dlg.open) dlg.showModal();
  }
  $("#auto-sync").onchange = (e) => ls("tb.autoSync", e.target.checked);
  $("#save-client").onclick = async () => {
    const id = $("#client-id").value.trim(); const m = $("#client-msg"); m.className = "note";
    if (id && !/\.apps\.googleusercontent\.com$/.test(id)) { m.className = "note err"; m.textContent = "That doesn't look like a client ID. It ends in .apps.googleusercontent.com."; return; }
    ls("tb.clientId", id || null);
    if (!id) { m.textContent = "Client ID removed."; updateAuthUI(); return; }
    m.innerHTML = '<span class="spinner"></span> Opening Google sign-in…';
    try { await doSignIn(); m.textContent = "Signed in. You're ready to scout."; }
    catch (e) { m.className = "note err"; m.textContent = e.message; }
  };

  /* ---------- Auth UI ---------- */
  async function doSignIn() {
    await signIn(false);
    try {
      const d = await yt("channels", { part: "snippet,contentDetails", mine: "true" }, { auth: true });
      const ch = (d.items || [])[0];
      ls("tb.me", ch ? { name: ch.snippet.title, likes: ((ch.contentDetails || {}).relatedPlaylists || {}).likes || "LL" } : { name: "your account", likes: "LL" });
    } catch (e) { ls("tb.me", { name: "your account", likes: "LL" }); }
    updateAuthUI(); loadMine(); toast("Signed in");
  }
  function updateAuthUI() {
    const signed = !!getToken(); const me = ls("tb.me");
    $("#signin-btn").hidden = signed || !clientId(); $("#signout-btn").hidden = !signed;
    $("#who").hidden = !signed; $("#who").textContent = signed && me ? me.name : "";
    $("#mine").hidden = !signed; $("#sync-bar").hidden = !signed;
    updateBanner(); updateSyncText();
  }
  $("#signin-btn").onclick = async () => { try { await doSignIn(); } catch (e) { toast(e.message); } };
  $("#signout-btn").onclick = signOut;
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
  function updateBanner() { $("#key-banner").hidden = !!getKey() || !!getToken(); }

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
      if (!getKey() && !getToken()) { openSettings(); return; }
      lastQuery = { kind: "search", artist, params: buildQuery(artist, mods()) }; results = []; nextToken = null;
      let r = (ls("tb.recent") || []).filter((x) => x.toLowerCase() !== artist.toLowerCase()); r.unshift(artist); ls("tb.recent", r.slice(0, 8)); renderRecent();
    }
    await runQuery(more, more ? $("#more-btn") : $("#scout-btn"), "Searching YouTube and reading descriptions…");
  }
  async function runQuery(more, btn, busyText) {
    const msg = $("#scout-msg"); msg.className = "note";
    scouting = true; const label = btn.textContent;
    btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> ' + (lastQuery.kind === "search" ? "Scouting" : "Scanning");
    msg.textContent = more ? "" : busyText;
    try {
      let ids;
      if (lastQuery.kind === "search") {
        const params = { ...lastQuery.params }; if (more && nextToken) params.pageToken = nextToken;
        const s = await yt("search", params); nextToken = s.nextPageToken || null;
        ids = (s.items || []).map((i) => i.id && i.id.videoId).filter(Boolean);
      } else {
        const params = { part: "contentDetails", playlistId: lastQuery.playlistId, maxResults: 50 }; if (more && nextToken) params.pageToken = nextToken;
        const s = await yt("playlistItems", params, { auth: true }); nextToken = s.nextPageToken || null;
        ids = (s.items || []).map((i) => i.contentDetails && i.contentDetails.videoId).filter(Boolean);
      }
      addResults(await videoDetails(ids), ids);
      msg.textContent = results.length ? "" : lastQuery.kind === "search" ? "No beats found. Try fewer filters or a different spelling." : "Nothing in " + lastQuery.label + " yet.";
    } catch (e) { msg.className = "note err"; msg.textContent = /404|not found/i.test(e.message) ? "YouTube couldn't open " + (lastQuery.label || "that list") + ". It may be private or empty." : e.message; }
    finally { scouting = false; btn.disabled = false; btn.textContent = label; renderResults(); }
  }
  function addResults(vids, order) {
    const byId = Object.fromEntries(vids.map((v) => [v.id, v]));
    order.forEach((id) => {
      const v = byId[id]; if (!v || results.some((r) => r.videoId === id)) return;
      const sn = v.snippet || {};
      results.push({
        videoId: id, title: sn.title || "", channel: sn.channelTitle || "", published: sn.publishedAt,
        views: (v.statistics || {}).viewCount, description: sn.description || "", artist: lastQuery.artist || "",
        read: readDescription(sn.description, sn.title), thumb: (sn.thumbnails && (sn.thumbnails.medium || sn.thumbnails.default) || {}).url || thumb(id)
      });
    });
  }
  $("#scout-form").addEventListener("submit", (e) => { e.preventDefault(); scout(false); });
  $("#more-btn").onclick = () => { if (!scouting && lastQuery) runQuery(true, $("#more-btn"), ""); };

  /* ---------- From my YouTube ---------- */
  async function scanList(playlistId, label, btn) {
    if (scouting) return;
    if (!getToken()) { toast("Sign in with Google first."); updateAuthUI(); return; }
    lastQuery = { kind: "playlist", playlistId, label, artist: "" }; results = []; nextToken = null;
    $("#only-beats").setAttribute("aria-pressed", "true");
    await runQuery(false, btn, "Reading " + label + "…");
    $("#resultbar").scrollIntoView({ behavior: "smooth", block: "start" });
  }
  $("#scan-likes").onclick = (e) => { const me = ls("tb.me") || {}; scanList(me.likes || "LL", "your liked videos", e.currentTarget); };
  $("#my-playlists").onchange = (e) => { const s = e.target; if (!s.value) return; scanList(s.value, s.options[s.selectedIndex].text, $("#scan-likes")); s.value = ""; };
  $("#my-subs").onchange = (e) => { const s = e.target; if (!s.value) return; scanList("UU" + s.value.slice(2), s.options[s.selectedIndex].text + "'s uploads", $("#scan-likes")); s.value = ""; };
  async function loadMine() {
    if (!getToken()) return;
    try {
      const pl = await yt("playlists", { part: "snippet", mine: "true", maxResults: 50 }, { auth: true });
      const own = ls("tb.playlistId");
      $("#my-playlists").innerHTML = '<option value="">Choose a playlist…</option>' + (pl.items || []).filter((p) => p.id !== own).map((p) => `<option value="${esc(p.id)}">${esc(p.snippet.title)}</option>`).join("");
      let subs = [], tok = "";
      for (let i = 0; i < 4; i++) {
        const s = await yt("subscriptions", { part: "snippet", mine: "true", maxResults: 50, order: "alphabetical", ...(tok ? { pageToken: tok } : {}) }, { auth: true });
        subs = subs.concat(s.items || []); tok = s.nextPageToken; if (!tok) break;
      }
      $("#my-subs").innerHTML = '<option value="">Choose a channel…</option>' + subs.map((s) => `<option value="${esc(s.snippet.resourceId.channelId)}">${esc(s.snippet.title)}</option>`).join("");
    } catch (e) { $("#scout-msg").className = "note err"; $("#scout-msg").textContent = e.message; }
  }
  const BEATY = /beat|instrumental|\bprod\b|prod\.|type\s*beat|freestyle|\binstru\b|riddim|bpm/i;
  $("#only-beats").onclick = (e) => { const c = e.currentTarget; c.setAttribute("aria-pressed", c.getAttribute("aria-pressed") !== "true"); renderResults(); };
  $("#only-free").onclick = (e) => { const c = e.currentTarget; c.setAttribute("aria-pressed", c.getAttribute("aria-pressed") !== "true"); renderResults(); };

  function licenseChips(read, credit) {
    const lic = LIC[read.license || read] || LIC.unknown;
    return `<span class="tag ${lic[1]}">${lic[0]}</span>` + (credit ? '<span class="tag t-credit">Credit producer</span>' : "");
  }
  function renderResults() {
    const box = $("#results"); const onlyFree = $("#only-free").getAttribute("aria-pressed") === "true";
    $("#resultbar").hidden = !results.length; $("#more-btn").hidden = !nextToken || !results.length;
    const fromAccount = lastQuery && lastQuery.kind === "playlist";
    $("#only-beats").hidden = !fromAccount;
    if (!results.length) { box.innerHTML = ""; return; }
    const onlyBeats = fromAccount && $("#only-beats").getAttribute("aria-pressed") === "true";
    const pool = onlyBeats ? results.filter((r) => BEATY.test(r.title + " " + r.description.slice(0, 300))) : results;
    const freeCount = pool.filter((r) => r.read.freeDL).length;
    $("#result-summary").textContent = (fromAccount ? lastQuery.label + ": " : "") + pool.length + (onlyBeats ? " beats" : " videos") + " · " + freeCount + " with a free download link";
    const list = onlyFree ? pool.filter((r) => r.read.freeDL) : pool;
    if (!list.length) { box.innerHTML = '<div class="empty"><strong>Nothing matches yet</strong>' + (nextToken ? "Load more results or turn off a filter." : "Turn off a filter to see everything.") + '</div>'; return; }
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
    const r = results.find((x) => x.videoId === s.dataset.save); if (r) saveResult(r, {});
  });
  function saveResult(r, extra) {
    if (savedByVideo(r.videoId)) { toast("Already in your crate"); return; }
    saveBeat(newId(), {
      url: "https://www.youtube.com/watch?v=" + r.videoId, videoId: r.videoId, title: r.title,
      producer: r.read.producer || r.channel, channel: r.channel, artist: r.artist, bpm: parseInt(r.read.bpm, 10) || null, key: r.read.key,
      license: r.read.license, download: (r.read.links.find((l) => l.free) || {}).url || "", links: r.read.links,
      tags: [], project: "", notes: "", credit: r.read.credit, description: r.description.slice(0, 5000), rating: 0, savedAt: new Date().toISOString(), ...extra
    });
    toast("Saved to crate" + (extra.bpmTapped ? " at " + r.read.bpm + " BPM" : "")); autoAdd(r.videoId);
  }

  /* ---------- Sync crate to a YouTube playlist ---------- */
  const PLAYLIST_TITLE = "Type Beat Crate";
  async function ensurePlaylist() {
    let id = ls("tb.playlistId");
    if (id) {
      const d = await yt("playlists", { part: "id", id }, { auth: true });
      if ((d.items || []).length) return id;
    }
    const mine = await yt("playlists", { part: "snippet", mine: "true", maxResults: 50 }, { auth: true });
    const found = (mine.items || []).find((p) => p.snippet.title === PLAYLIST_TITLE);
    if (found) { ls("tb.playlistId", found.id); return found.id; }
    const created = await yt("playlists", { part: "snippet,status" }, { auth: true, method: "POST", body: {
      snippet: { title: PLAYLIST_TITLE, description: "Beats saved in the Type Beat app." }, status: { privacyStatus: "private" } } });
    ls("tb.playlistId", created.id); return created.id;
  }
  async function playlistVideoIds(pid) {
    const ids = new Set(); let tok = "";
    for (let i = 0; i < 20; i++) {
      const d = await yt("playlistItems", { part: "contentDetails", playlistId: pid, maxResults: 50, ...(tok ? { pageToken: tok } : {}) }, { auth: true });
      (d.items || []).forEach((it) => ids.add(it.contentDetails.videoId)); tok = d.nextPageToken; if (!tok) break;
    }
    return ids;
  }
  async function insertIntoPlaylist(pid, vid) {
    await yt("playlistItems", { part: "snippet" }, { auth: true, method: "POST", body: { snippet: { playlistId: pid, resourceId: { kind: "youtube#video", videoId: vid } } } });
  }
  function updateSyncText() {
    const s = ls("tb.lastSync"); const el = $("#sync-text");
    el.textContent = s ? `Crate playlist “${PLAYLIST_TITLE}” · last synced ${ago(s.at)} · ${s.count} beats` : "Keep your crate as a private YouTube playlist.";
  }
  let syncing = false;
  async function syncCrate() {
    if (syncing) return; syncing = true; const btn = $("#sync-btn"); btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Syncing';
    try {
      const pid = await ensurePlaylist(); const have = await playlistVideoIds(pid);
      const missing = [...new Set(beats.map((b) => b.videoId).filter(Boolean))].filter((v) => !have.has(v));
      let added = 0;
      for (const v of missing) {
        try { await insertIntoPlaylist(pid, v); have.add(v); added++; btn.innerHTML = `<span class="spinner"></span> ${added}/${missing.length}`; }
        catch (e) { if (/quota|expired|Sign in/i.test(e.message)) throw e; }
      }
      ls("tb.lastSync", { at: new Date().toISOString(), count: have.size }); updateSyncText();
      toast(added ? `Added ${added} beat${added > 1 ? "s" : ""} to your YouTube playlist` : "Playlist already up to date");
    } catch (e) { toast(e.message); }
    finally { syncing = false; btn.disabled = false; btn.textContent = "Sync to YouTube"; }
  }
  $("#sync-btn").onclick = syncCrate;
  async function autoAdd(vid) {
    if (!vid || !getToken() || ls("tb.autoSync") === false) return;
    try { const pid = await ensurePlaylist(); await insertIntoPlaylist(pid, vid); const s = ls("tb.lastSync"); ls("tb.lastSync", { at: new Date().toISOString(), count: s ? s.count + 1 : 1 }); updateSyncText(); }
    catch (e) { toast("Saved here, but not added to YouTube: " + e.message); }
  }

  /* ---------- Player + BPM tracker ---------- */
  // target says where a tapped BPM gets saved: a crate beat, a search result, the add form, or the crate filter.
  let tapTarget = null; let taps = []; let tapBpm = 0;
  function play(id) {
    const inCrate = savedByVideo(id);
    openPlayer(id, inCrate ? { kind: "crate", id: inCrate.id } : { kind: "result", videoId: id });
  }
  function openPlayer(videoId, target) {
    tapTarget = target; resetTaps();
    const frame = $("#player-frame");
    frame.hidden = !videoId;
    frame.innerHTML = videoId ? `<iframe src="https://www.youtube-nocookie.com/embed/${encodeURIComponent(videoId)}?autoplay=1&rel=0&playsinline=1" allow="autoplay; encrypted-media; picture-in-picture" allowfullscreen title="Beat preview"></iframe>` : "";
    const forText = { crate: "Saves to this beat in your crate", result: "Saves this beat to your crate with its BPM", form: "Fills in the BPM on the form", filter: "Sets the crate's BPM range around it" }[target.kind];
    $("#tap-for").textContent = videoId ? forText : "Play the beat anywhere, then tap along. " + forText + ".";
    $("#tap-save").textContent = target.kind === "result" ? "Save beat with BPM" : target.kind === "filter" ? "Find beats near this BPM" : "Save BPM";
    $("#player").showModal();
  }
  function resetTaps() { taps = []; tapBpm = 0; $("#tap-bpm").textContent = "—"; $("#tap-hint").textContent = "Tap here on every beat"; $("#tap-save").disabled = true; }
  function showBpm() {
    $("#tap-bpm").textContent = tapBpm ? Math.round(tapBpm) : "—";
    $("#tap-save").disabled = !tapBpm;
  }
  function tap() {
    const now = performance.now();
    if (taps.length && now - taps[taps.length - 1] > 2500) taps = []; // a long pause starts a fresh count
    taps.push(now); if (taps.length > 16) taps.shift();
    const pad = $("#tap-pad"); pad.classList.add("flash"); setTimeout(() => pad.classList.remove("flash"), 80);
    if (taps.length < 4) { $("#tap-hint").textContent = "Keep tapping… " + (4 - taps.length) + " more"; return; }
    // Median interval ignores the odd early or late tap.
    const gaps = taps.slice(1).map((t, i) => t - taps[i]).sort((a, b) => a - b);
    const mid = gaps[Math.floor(gaps.length / 2)];
    const good = gaps.filter((g) => Math.abs(g - mid) < mid * 0.25);
    const avg = good.reduce((a, b) => a + b, 0) / good.length;
    tapBpm = 60000 / avg;
    $("#tap-hint").textContent = taps.length < 8 ? "Getting steadier… keep going" : "Locked in. Keep tapping to fine-tune";
    showBpm();
  }
  $("#tap-pad").addEventListener("pointerdown", (e) => { e.preventDefault(); tap(); });
  $("#tap-pad").addEventListener("keydown", (e) => { if (e.key === " " || e.key === "Enter") { e.preventDefault(); tap(); } });
  $("#tap-pad").addEventListener("click", (e) => { if (e.detail === 0) tap(); }); // keyboard activation without pointer
  $("#tap-half").onclick = () => { if (tapBpm) { tapBpm /= 2; showBpm(); } };
  $("#tap-double").onclick = () => { if (tapBpm) { tapBpm *= 2; showBpm(); } };
  $("#tap-reset").onclick = resetTaps;
  $("#tap-save").onclick = () => {
    const bpm = Math.round(tapBpm); if (!bpm || !tapTarget) return; const t = tapTarget;
    if (t.kind === "crate") { const b = beats.find((x) => x.id === t.id); if (b) { const { id, ...rest } = b; saveBeat(id, { ...rest, bpm, bpmTapped: true }); toast("Saved " + bpm + " BPM"); } }
    else if (t.kind === "result") { const r = results.find((x) => x.videoId === t.videoId); if (r) { r.read.bpm = String(bpm); saveResult(r, { bpmTapped: true }); } }
    else if (t.kind === "form") { $("#f-bpm").value = bpm; toast("BPM set to " + bpm); }
    else if (t.kind === "filter") { $("#fl-bpm-min").value = bpm - 5; $("#fl-bpm-max").value = bpm + 5; renderCrate(); toast("Showing beats from " + (bpm - 5) + " to " + (bpm + 5) + " BPM"); }
    $("#player").close();
  };
  $("#player").addEventListener("close", () => { $("#player-frame").innerHTML = ""; tapTarget = null; });
  $("#f-tap").onclick = () => { const vid = videoId($("#f-url").value); openPlayer(vid, { kind: "form" }); };
  $("#fl-bpm-tap").onclick = () => openPlayer("", { kind: "filter" });

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
    const wasNew = !old || old.videoId !== vid;
    toast(editingId ? "Beat updated" : "Saved to crate"); clearForm();
    if (wasNew) autoAdd(vid);
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
    const lo = parseInt($("#fl-bpm-min").value, 10), hi = parseInt($("#fl-bpm-max").value, 10);
    const inRange = (b) => (isNaN(lo) && isNaN(hi)) || (b.bpm && (isNaN(lo) || b.bpm >= lo) && (isNaN(hi) || b.bpm <= hi));
    const r = beats.filter((b) => (!lic || b.license === lic) && (!dl || b.download) && inRange(b) && (!q || [b.title, b.producer, b.artist, b.notes, b.project, (b.tags || []).join(" "), b.key].join(" ").toLowerCase().includes(q)));
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
        <div class="actions">${dl}${yt}<button class="btn small ghost" data-tapbpm="${b.id}">${b.bpm ? "Re-tap BPM" : "Tap BPM"}</button><button class="btn small ghost" data-edit="${b.id}">Edit</button>${confirmId === b.id ? `<span class="confirm">Remove? <button class="btn small danger" data-del="${b.id}">Remove</button><button class="btn small ghost" data-cancel="1">Keep</button></span>` : `<button class="btn small ghost" data-ask="${b.id}">Remove</button>`}</div>
      </div></article>`;
    }).join("");
    list.querySelectorAll("canvas").forEach((c) => drawWave(c, c.dataset.seed));
  }
  ["#q", "#fl-license", "#fl-sort", "#fl-bpm-min", "#fl-bpm-max"].forEach((s) => $(s).addEventListener("input", renderCrate));
  $("#fl-dl").onclick = (e) => { const c = e.currentTarget; c.setAttribute("aria-pressed", c.getAttribute("aria-pressed") !== "true"); renderCrate(); };
  $("#list").addEventListener("click", (e) => {
    const t = e.target.closest("button"); if (!t) return;
    if (t.dataset.play) play(t.dataset.play);
    else if (t.dataset.tapbpm) { const b = beats.find((x) => x.id === t.dataset.tapbpm); if (b) openPlayer(b.videoId || "", { kind: "crate", id: b.id }); }
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
  updateAuthUI();
  if (getToken()) loadMine();

  /* ---------- Offline shell ---------- */
  if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("sw.js").catch(() => {});
})();
