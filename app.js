(() => {
  const $ = (id) => document.getElementById(id);
  const LS = { key: "wl.key", cache: "wl.cache", outbox: "wl.outbox", prefs: "wl.prefs" };
  const load = (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } };
  const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };
  const drop = (k) => { try { localStorage.removeItem(k); } catch {} };

  const ACCENTS = ["#8b7cff", "#ff6b8b", "#3fbf9b", "#4b9dff", "#f5a524", "#8b8b95"];
  const SORTS = { new: "новые", prio: "важные", exp: "дороже", cheap: "дешевле" };
  const rub = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 });
  const money = (n) => rub.format(n) + " ₽";
  const CHECK = '<svg viewBox="0 0 24 24" fill="none" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';

  let key = load(LS.key, null);
  let server = load(LS.cache, {});   // id -> item, as last seen on the server
  let outbox = load(LS.outbox, []);  // pending writes, applied on top of `server`
  const prefs = Object.assign({ accent: ACCENTS[0], theme: "auto", sort: "new" }, load(LS.prefs, {}));

  let prio = 2, openId = null, showDone = false;
  let pushing = false, pulling = false, offline = false, writeSeq = 0, retryTimer = null;

  const newId = () => Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
  const view = () => {
    const m = { ...server };
    for (const op of outbox) op.t === "put" ? (m[op.item.id] = op.item) : delete m[op.id];
    return m;
  };

  // ---------- parsing one line: title + link + price ----------
  function parse(raw) {
    let s = raw.trim(), url = "", price = null;
    const m = s.match(/https?:\/\/\S+/i);
    if (m) { url = m[0].replace(/[),.]+$/, ""); s = (s.slice(0, m.index) + " " + s.slice(m.index + m[0].length)).trim(); }
    const p = s.match(/(?:^|\s)(\d{1,3}(?:[\s ]\d{3})+(?:[.,]\d+)?|\d+(?:[.,]\d+)?)\s*(к|k|тыс\.?|₽|р\.?|руб\.?|rub)?\s*$/i);
    if (p) {
      let n = parseFloat(p[1].replace(/\s/g, "").replace(",", "."));
      const suf = (p[2] || "").toLowerCase();
      if (/^(к|k|тыс)/.test(suf)) n *= 1000;
      if (Number.isFinite(n) && (suf || n >= 100)) { price = Math.round(n * 100) / 100; s = s.slice(0, p.index).trim(); }
    }
    s = s.replace(/[\s,—–-]+$/, "").trim();
    if (!s && url) s = host(url);
    return { title: s, url, price };
  }
  function host(u) { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return ""; } }
  function safeUrl(u) { try { const x = new URL(u); return /^https?:$/.test(x.protocol) ? x.href : ""; } catch { return ""; } }
  function toPrice(v) { const n = parseFloat(String(v).replace(/\s/g, "").replace(",", ".")); return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null; }

  // ---------- network ----------
  async function api(method, body, qs = "") {
    const r = await fetch("/api/wishes" + qs, {
      method, cache: "no-store",
      headers: { "content-type": "application/json", "x-wishlist-key": key || "" },
      body: body ? JSON.stringify(body) : undefined,
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { const e = new Error(j.error || "http " + r.status); e.status = r.status; e.body = j; throw e; }
    return j;
  }

  async function pull() {
    if (!key || pulling) return;
    pulling = true; setSync();
    const seq = writeSeq;
    try {
      const { items } = await api("GET");
      if (seq === writeSeq) {  // ignore a read that started before our latest write landed
        server = {};
        for (const it of items) server[it.id] = it;
        save(LS.cache, server);
      }
      offline = false;
    } catch (e) {
      if (e.status === 401) return logout("ключ больше не подходит");
      offline = true;
    } finally { pulling = false; setSync(); render(); }
  }

  async function flush() {
    if (!key || pushing || !outbox.length) return;
    pushing = true; setSync();
    clearTimeout(retryTimer);
    while (outbox.length) {
      const op = outbox[0];
      try {
        if (op.t === "put") server[op.item.id] = (await api("POST", op.item)).item;
        else { await api("DELETE", null, "?id=" + encodeURIComponent(op.id)); delete server[op.id]; }
        writeSeq++;
      } catch (e) {
        if (e.status === 401) { pushing = false; return logout("ключ больше не подходит"); }
        if (!e.status || e.status >= 500) { offline = true; retryTimer = setTimeout(flush, 5000); break; }
        // 4xx: the server rejected this write for good, drop it
      }
      outbox.shift();
      save(LS.outbox, outbox); save(LS.cache, server);
    }
    pushing = false;
    if (!outbox.length) { offline = false; pull(); }
    setSync(); render();
  }

  function mutate(op) {
    outbox.push(op); save(LS.outbox, outbox);
    render(); flush();
  }
  const putItem = (item) => mutate({ t: "put", item: { ...item, updatedAt: Date.now() } });

  function setSync() {
    const s = offline ? "off" : pushing || pulling ? "busy" : "ok";
    const dot = $("sync"); dot.dataset.s = s;
    const info = offline
      ? outbox.length ? `нет связи · ждут отправки: ${outbox.length}` : "нет связи"
      : pushing ? "сохраняю…" : "синхронизировано";
    dot.title = info; $("syncInfo").textContent = info;
  }

  // ---------- render ----------
  const plural = (n, f) => { const a = n % 10, b = n % 100; return f[a === 1 && b !== 11 ? 0 : a >= 2 && a <= 4 && (b < 12 || b > 14) ? 1 : 2]; };

  function render(force = false) {
    const all = Object.values(view());
    const want = all.filter((x) => !x.done), done = all.filter((x) => x.done);
    const sum = want.reduce((s, x) => s + (x.price || 0), 0);

    const total = $("total"); total.textContent = "";
    if (want.length) {
      total.append(`${want.length} ${plural(want.length, ["желание", "желания", "желаний"])} · `);
      const b = document.createElement("b"); b.textContent = money(sum); total.append(b);
    }
    $("sortBtn").textContent = "сначала " + SORTS[prefs.sort];
    $("empty").hidden = want.length > 0;
    $("fold").hidden = !done.length;
    $("fold").textContent = `сбылось · ${done.length} ${showDone ? "↑" : "↓"}`;
    $("doneList").hidden = !showDone || !done.length;

    if (openId && !all.some((x) => x.id === openId)) openId = null;
    if (openId && !force) return;  // a background sync must not wipe an open editor

    fill($("list"), sortItems(want));
    fill($("doneList"), done.sort((a, b) => (b.doneAt || 0) - (a.doneAt || 0)));
  }

  function sortItems(list) {
    const cmp = {
      new: (a, b) => b.createdAt - a.createdAt,
      prio: (a, b) => b.priority - a.priority || b.createdAt - a.createdAt,
      exp: (a, b) => (b.price ?? -1) - (a.price ?? -1),
      cheap: (a, b) => (a.price ?? Infinity) - (b.price ?? Infinity),
    }[prefs.sort];
    return list.sort(cmp);
  }

  function fill(ul, items) {
    ul.textContent = "";
    for (const x of items) {
      ul.append(row(x));
      if (x.id === openId) ul.append(editor(x));
    }
  }

  function row(x) {
    const li = document.createElement("li");
    li.className = "row" + (x.done ? " is-done" : "");
    li.tabIndex = 0;

    const tick = document.createElement("button");
    tick.type = "button"; tick.className = "tick"; tick.innerHTML = CHECK;
    tick.setAttribute("aria-label", x.done ? "вернуть в список" : "сбылось");
    tick.addEventListener("click", (e) => {
      e.stopPropagation();
      const d = !x.done;
      putItem({ ...x, done: d, doneAt: d ? Date.now() : null });
      if (d) toast("сбылось ✓");
    });

    const main = document.createElement("div"); main.className = "main";
    const t = document.createElement("div"); t.className = "t"; t.textContent = x.title;
    const sub = document.createElement("div"); sub.className = "sub";
    const dots = document.createElement("span"); dots.className = "dots"; dots.dataset.p = x.priority; dots.innerHTML = "<i></i><i></i><i></i>";
    sub.append(dots);
    const u = safeUrl(x.url || "");
    if (u) {
      const a = document.createElement("a"); a.href = u; a.target = "_blank"; a.rel = "noopener noreferrer";
      a.textContent = host(u); a.addEventListener("click", (e) => e.stopPropagation());
      sub.append(a);
    }
    if (x.note) { const n = document.createElement("span"); n.className = "note"; n.textContent = x.note; sub.append(n); }
    main.append(t, sub);

    const price = document.createElement("div");
    price.className = "price" + (x.price == null ? " none" : "");
    price.textContent = x.price == null ? "—" : money(x.price);

    li.append(tick, main, price);
    const toggle = () => { openId = openId === x.id ? null : x.id; render(true); };
    li.addEventListener("click", toggle);
    li.addEventListener("keydown", (e) => { if (e.key === "Enter" && e.target === li) toggle(); });
    return li;
  }


  function editor(x) {
    const li = document.createElement("li"); li.className = "editor";
    const form = document.createElement("form"); form.style.display = "contents"; form.autocomplete = "off";
    const input = (id, value, attrs = {}) => { const i = document.createElement("input"); i.id = id; i.value = value; Object.assign(i, attrs); return i; };

    const title = input("eTitle", x.title, { placeholder: "название", maxLength: 200 });
    const url = input("eUrl", x.url || "", { placeholder: "ссылка", inputMode: "url" });
    const price = input("ePrice", x.price == null ? "" : String(x.price).replace(".", ","), { placeholder: "цена, ₽", inputMode: "decimal" });
    const note = document.createElement("textarea"); note.id = "eNote"; note.value = x.note || ""; note.placeholder = "заметка: размер, цвет, где видел"; note.maxLength = 1000;

    let p = x.priority;
    const pb = document.createElement("button"); pb.type = "button"; pb.className = "prio"; pb.dataset.p = p;
    pb.innerHTML = "<i></i><i></i><i></i>"; pb.setAttribute("aria-label", "насколько хочется");
    pb.addEventListener("click", () => { p = p % 3 + 1; pb.dataset.p = p; });

    const pair = document.createElement("div"); pair.className = "pair"; pair.append(price, pb);

    const acts = document.createElement("div"); acts.className = "acts";
    const del = document.createElement("button"); del.type = "button"; del.className = "link danger"; del.textContent = "удалить";
    del.addEventListener("click", () => {
      openId = null;
      mutate({ t: "del", id: x.id });
      toast("удалено", () => putItem(x));
    });
    const ok = document.createElement("button"); ok.type = "submit"; ok.className = "btn"; ok.textContent = "готово";
    acts.append(del, ok);

    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const raw = url.value.trim();
      openId = null;
      putItem({
        ...x,
        title: title.value.trim().slice(0, 200) || "без названия",
        url: raw ? safeUrl(/^https?:\/\//i.test(raw) ? raw : "https://" + raw) : "",
        price: toPrice(price.value),
        priority: p,
        note: note.value.trim().slice(0, 1000),
      });
    });
    form.addEventListener("keydown", (e) => { if (e.key === "Escape") { openId = null; render(); } });

    form.append(title, url, pair, note, acts);
    li.append(form);
    return li;
  }

  // ---------- capture line ----------
  const q = $("q");
  function preview() {
    const v = q.value.trim();
    $("go").classList.toggle("on", !!v);
    const out = $("preview");
    if (!v) { out.textContent = "можно сразу со ссылкой и ценой"; return; }
    const r = parse(v);
    out.textContent = "";
    const b = document.createElement("b"); b.textContent = r.title || "…"; out.append(b);
    if (r.url) out.append(" · " + host(r.url));
    out.append(" · " + (r.price != null ? money(r.price) : "без цены"));
  }
  q.addEventListener("input", preview);

  $("prio").addEventListener("click", () => { prio = prio % 3 + 1; $("prio").dataset.p = prio; });

  $("add").addEventListener("submit", (e) => {
    e.preventDefault();
    const v = q.value.trim(); if (!v) return;
    const r = parse(v);
    putItem({ id: newId(), title: r.title.slice(0, 200) || "без названия", url: r.url, price: r.price, priority: prio, note: "", done: false, createdAt: Date.now(), doneAt: null });
    q.value = ""; preview();
  });

  // ---------- footer + settings ----------
  $("fold").addEventListener("click", () => { showDone = !showDone; render(); });
  $("sortBtn").addEventListener("click", () => {
    const ks = Object.keys(SORTS);
    prefs.sort = ks[(ks.indexOf(prefs.sort) + 1) % ks.length]; save(LS.prefs, prefs); render();
  });
  $("setBtn").addEventListener("click", () => {
    const s = $("settings"); s.hidden = !s.hidden; $("setBtn").setAttribute("aria-expanded", String(!s.hidden));
  });

  function applyPrefs() {
    const root = document.documentElement;
    root.style.setProperty("--accent", prefs.accent);
    if (prefs.theme === "auto") delete root.dataset.theme; else root.dataset.theme = prefs.theme;
    $("swatches").querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.c === prefs.accent)));
    $("themeSeg").querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.v === prefs.theme)));
  }
  for (const c of ACCENTS) {
    const b = document.createElement("button");
    b.type = "button"; b.dataset.c = c; b.style.setProperty("--c", c); b.setAttribute("aria-label", "цвет " + c);
    b.addEventListener("click", () => { prefs.accent = c; save(LS.prefs, prefs); applyPrefs(); });
    $("swatches").append(b);
  }
  $("themeSeg").addEventListener("click", (e) => {
    const b = e.target.closest("button"); if (!b) return;
    prefs.theme = b.dataset.v; save(LS.prefs, prefs); applyPrefs();
  });
  $("logout").addEventListener("click", () => logout());

  // ---------- toast ----------
  let toastTimer;
  function toast(text, undo) {
    $("toastText").textContent = text;
    const btn = $("toastBtn"); btn.hidden = !undo;
    btn.onclick = undo ? () => { $("toast").hidden = true; undo(); } : null;
    $("toast").hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => ($("toast").hidden = true), undo ? 5000 : 1800);
  }

  // ---------- gate ----------
  function showGate(msg, err) {
    $("app").hidden = true; $("gate").hidden = false;
    if (msg) { $("gateMsg").textContent = msg; $("gateMsg").classList.toggle("err", !!err); }
    $("gateKey").focus();
  }
  function showApp() {
    $("gate").hidden = true; $("app").hidden = false;
    setSync(); render(); takeShare();
  }
  function logout(msg) {
    key = null; drop(LS.key); drop(LS.cache); drop(LS.outbox);
    server = {}; outbox = []; openId = null;
    showGate(msg || "введи ключ из настроек vercel — один раз на каждом устройстве", !!msg);
  }
  $("gateForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const k = $("gateKey").value.trim(); if (!k) return;
    key = k;
    const msg = $("gateMsg"); msg.classList.remove("err"); msg.textContent = "проверяю…";
    try {
      const { items } = await api("GET");
      save(LS.key, key);
      server = {}; for (const it of items) server[it.id] = it; save(LS.cache, server);
      $("gateKey").value = "";
      showApp();
    } catch (err) {
      key = null;
      msg.classList.add("err");
      msg.textContent = err.status === 401 ? "не тот ключ"
        : err.body && err.body.error === "not_configured" ? "сервер не настроен: нет " + err.body.missing.join(", ")
        : "нет связи с сервером";
    }
  });

  // shared from another app (android share sheet → /?title=&text=&url=)
  function takeShare() {
    const sp = new URLSearchParams(location.search);
    const parts = ["title", "text", "url"].map((k) => sp.get(k)).filter(Boolean);
    if (!parts.length) return;
    q.value = [...new Set(parts)].join(" ");
    history.replaceState(null, "", "/");
    preview(); q.focus();
  }

  // ---------- boot ----------
  applyPrefs();
  if (key) { showApp(); pull(); flush(); } else showGate();

  setInterval(() => { if (key && document.visibilityState === "visible" && !pushing) pull(); }, 10000);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && key) { flush(); pull(); } });
  addEventListener("online", () => { if (key) { flush(); pull(); } });
  document.addEventListener("keydown", (e) => {
    if (e.key === "/" && key && !/INPUT|TEXTAREA/.test(document.activeElement.tagName)) { e.preventDefault(); q.focus(); }
  });

  if ("serviceWorker" in navigator) addEventListener("load", () => navigator.serviceWorker.register("/sw.js").catch(() => {}));
})();
