import * as store from "../store.js";
import { barChart, stack } from "../charts.js";
import { h, money, parseTxn, parseBulk, today, dayLabel, parseDay, monthName, monthShort, plural, toNumber, toast, sheet } from "../util.js";

export function moneyView(ctx) {
  const now = new Date();
  const st = { mode: "month", y: now.getFullYear(), m: now.getMonth(), kind: "expense", filter: null, addKind: null, addCat: null, addDate: null };

  // ---------- capture line ----------
  const input = h("input", { id: "money-q", type: "text", placeholder: "кофе 25к или +8 млн зарплата", "aria-label": "новая операция", enterkeyhint: "done", autocomplete: "off", inputMode: "text" });
  const sign = h("button", { type: "button", class: "sign", "aria-label": "расход или доход" });
  const go = h("button", { type: "submit", class: "go", "aria-label": "добавить" }, "+");
  const preview = h("p", { class: "preview" });
  const bulkBtn = h("button", { type: "button", class: "link", onclick: () => openImport("") }, "вставить списком");
  const catChips = h("div", { class: "chips", role: "group", "aria-label": "категория" });
  const form = h("form", { class: "capture", autocomplete: "off" }, sign, input, go);
  const body = h("div");
  const el = h("section", { "aria-label": "деньги" }, form, h("div", { class: "preview-row" }, preview, bulkBtn), catChips, body);

  const parsed = () => parseTxn(input.value, ctx.cats());
  const effective = () => {
    const p = parsed();
    const kind = st.addKind || p.kind;
    const cat = st.addCat && ctx.cat(st.addCat)?.scope === kind ? st.addCat : p.kind === kind ? p.cat : null;
    return { ...p, kind, cat: cat || ctx.fallbackCat(kind), date: st.addDate || p.date };
  };

  function renderCapture() {
    const e = effective();
    sign.textContent = e.kind === "income" ? "+" : "−";
    sign.dataset.kind = e.kind;
    go.classList.toggle("on", !!input.value.trim());
    preview.textContent = "";
    if (!input.value.trim()) preview.append("сумма, что купил, можно дату: «такси 18к вчера»");
    else {
      preview.append(h("b", {}, e.amount != null ? money(e.kind === "income" ? e.amount : -e.amount, ctx.currency(), { sign: true }) : "сумма?"));
      preview.append(" · " + (ctx.cat(e.cat)?.name || "без категории"), " · " + dayLabel(e.date, { withWeekday: false }));
      if (e.note) preview.append(" · " + e.note);
    }
    catChips.textContent = "";
    for (const c of ctx.cats(e.kind)) {
      catChips.append(h("button", { type: "button", class: "chip", "aria-pressed": String(c.id === e.cat), onclick: () => { st.addCat = c.id; renderCapture(); input.focus(); } },
        h("i", { class: "dot", style: { background: `var(--c${c.color})` } }), c.name));
    }
  }
  // a pasted multi-line list goes to the import sheet instead of the one-line field
  input.addEventListener("paste", (e) => {
    const text = (e.clipboardData || window.clipboardData)?.getData("text") || "";
    if (text.trim().includes("\n")) { e.preventDefault(); openImport(text); }
  });
  input.addEventListener("input", () => { if (!input.value.trim()) { st.addCat = null; st.addKind = null; st.addDate = null; } renderCapture(); });
  sign.addEventListener("click", () => { st.addKind = effective().kind === "income" ? "expense" : "income"; st.addCat = null; renderCapture(); input.focus(); });
  form.addEventListener("submit", (ev) => {
    ev.preventDefault();
    const e = effective();
    if (!input.value.trim()) return;
    if (!e.amount) { toast("Добавь сумму, например «кофе 25 000»"); return; }
    store.put("txns", { kind: e.kind, amount: e.amount, cat: e.cat, date: e.date, note: e.note.slice(0, 300) });
    input.value = ""; st.addCat = null; st.addKind = null; st.addDate = null;
    renderCapture();
    // jump to the period that holds the new entry
    const d = parseDay(e.date);
    if (st.mode !== "all" && (d.getFullYear() !== st.y || (st.mode === "month" && d.getMonth() !== st.m))) { st.y = d.getFullYear(); st.m = d.getMonth(); }
    render();
  });

  // ---------- period ----------
  function inPeriod(t) {
    if (st.mode === "all") return true;
    const [y, m] = t.date.split("-").map(Number);
    return st.mode === "year" ? y === st.y : y === st.y && m - 1 === st.m;
  }
  function shift(d) {
    if (st.mode === "year") st.y += d;
    else { st.m += d; if (st.m < 0) { st.m = 11; st.y--; } if (st.m > 11) { st.m = 0; st.y++; } }
    st.filter = null; render();
  }
  const isCurrent = () => st.mode === "all" || (st.y === now.getFullYear() && (st.mode === "year" || st.m === now.getMonth()));

  // ---------- render ----------
  function render() {
    renderCapture();
    const cur = ctx.currency();
    const all = store.all("txns");
    const txns = all.filter(inPeriod);
    const sum = (k) => txns.filter((t) => t.kind === k).reduce((s, t) => s + t.amount, 0);
    const exp = sum("expense"), inc = sum("income");
    body.textContent = "";

    // period switcher
    const title = st.mode === "all" ? "за всё время" : st.mode === "year" ? String(st.y) : `${monthName(st.m)}${st.y !== now.getFullYear() ? " " + st.y : ""}`;
    body.append(h("div", { class: "period" },
      h("div", { class: "nav-p" },
        h("button", { type: "button", "aria-label": "назад", disabled: st.mode === "all", onclick: () => shift(-1) }, "‹"),
        h("h2", {}, title),
        h("button", { type: "button", "aria-label": "вперёд", disabled: st.mode === "all" || isCurrent(), onclick: () => shift(1) }, "›")),
      seg([["month", "месяц"], ["year", "год"], ["all", "всё"]], st.mode, (v) => { st.mode = v; st.filter = null; if (v !== "all") { st.y = now.getFullYear(); st.m = now.getMonth(); } render(); })));

    // headline
    const net = inc - exp;
    body.append(h("div", { class: "hero" },
      h("span", { class: "label" }, "потрачено"),
      h("span", { class: "big" }, money(exp, cur)),
      h("div", { class: "stats" },
        h("span", {}, "доход ", h("b", {}, money(inc, cur))),
        h("span", {}, "итог ", h("b", { style: { color: net < 0 ? "var(--bad)" : "" } }, money(net, cur, { sign: true }))))));

    const budget = ctx.prefs().budget;
    if (budget && st.mode === "month") {
      const pct = exp / budget, over = exp > budget;
      body.append(h("div", { class: "budget" },
        h("div", { class: "meter" + (over ? " over" : "") }, h("i", { style: { width: Math.min(100, pct * 100) + "%" } })),
        over ? h("span", { class: "over" }, `бюджет ${money(budget, cur)} превышен на ${money(exp - budget, cur)}`)
          : h("span", {}, `бюджет ${money(budget, cur)} · осталось ${money(budget - exp, cur)} · ${Math.round(pct * 100)}%`)));
    }

    if (!all.length) {
      body.append(h("p", { class: "empty" }, "Здесь появятся твои траты и доходы. Напиши в строке выше ", h("b", {}, "«продукты 145 000»"), " или ", h("b", {}, "«+8 млн зарплата»"), ": сумму, категорию и дату приложение поймёт само."));
      return;
    }

    // chart
    const kindTxns = txns.filter((t) => t.kind === st.kind && (!st.filter || t.cat === st.filter));
    const card = h("div", { class: "card" },
      h("div", { class: "card-h" },
        h("span", {}, st.mode === "month" ? "по дням" : "по месяцам"),
        seg([["expense", "расходы"], ["income", "доходы"]], st.kind, (v) => { st.kind = v; st.filter = null; render(); })),
      barChart({ points: series(kindTxns), tip: (v) => money(v, cur), highlight: highlightIndex() }));
    body.append(card);

    // categories
    const byCat = new Map();
    for (const t of txns.filter((t) => t.kind === st.kind)) byCat.set(t.cat, (byCat.get(t.cat) || 0) + t.amount);
    const total = [...byCat.values()].reduce((a, b) => a + b, 0);
    if (total > 0) {
      const rows = [...byCat.entries()].map(([id, v]) => ({ id, v, c: ctx.cat(id) || { name: "без категории", color: 8 } })).sort((a, b) => b.v - a.v);
      const top = rows.slice(0, 7), rest = rows.slice(7);
      const parts = top.map((r) => ({ name: r.c.name, value: r.v, color: r.c.color }));
      if (rest.length) parts.push({ name: "остальное", value: rest.reduce((s, r) => s + r.v, 0), color: 8 });
      body.append(h("div", { class: "card" },
        h("div", { class: "card-h" }, h("span", {}, st.kind === "expense" ? "куда ушли деньги" : "откуда пришли"), h("span", { class: "num" }, money(total, cur))),
        stack(parts),
        h("ul", { class: "cats" }, rows.map((r) => h("li", {
          class: st.filter === r.id ? "sel" : st.filter ? "dim" : "",
          onclick: () => { st.filter = st.filter === r.id ? null : r.id; render(); },
        },
          h("i", { class: "dot", style: { background: `var(--c${r.c.color})` } }),
          h("span", {}, r.c.name),
          h("span", { class: "pct" }, Math.round((r.v / total) * 100) + "%"),
          h("span", { class: "v" }, money(r.v, cur)))))));
    }

    // list
    const list = txns.filter((t) => !st.filter || t.cat === st.filter).sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt);
    if (st.filter) body.append(h("div", { class: "filter-note" }, h("span", {}, `только «${ctx.cat(st.filter)?.name || "без категории"}» · ${list.length} ${plural(list.length, ["операция", "операции", "операций"])}`), h("button", { class: "link", type: "button", onclick: () => { st.filter = null; render(); } }, "показать все")));
    if (!list.length) { body.append(h("p", { class: "empty" }, "В этом периоде операций нет.")); return; }
    let lastDay = null, ul = null;
    for (const t of list) {
      if (t.date !== lastDay) {
        lastDay = t.date;
        const dayNet = list.filter((x) => x.date === t.date).reduce((s, x) => s + (x.kind === "income" ? x.amount : -x.amount), 0);
        body.append(h("div", { class: "group-h" }, h("b", {}, dayLabel(t.date)), h("span", { class: "num" }, money(dayNet, cur, { sign: true }))));
        ul = h("ul", { class: "list" }); body.append(ul);
      }
      const c = ctx.cat(t.cat);
      ul.append(h("li", { class: "row nolead", tabIndex: 0, onclick: () => edit(t), onkeydown: (e) => e.key === "Enter" && edit(t) },
        h("div", { class: "main" },
          h("div", { class: "t" }, t.note || c?.name || "без категории"),
          h("div", { class: "sub" }, h("span", { class: "c" }, h("i", { class: "dot", style: { background: `var(--c${c ? c.color : 8})` } }), c?.name || "без категории"))),
        h("div", { class: "amt" + (t.kind === "income" ? " in" : "") }, money(t.kind === "income" ? t.amount : -t.amount, cur, { sign: true }))));
    }
  }

  function series(list) {
    if (st.mode === "month") {
      const days = new Date(st.y, st.m + 1, 0).getDate();
      const pts = Array.from({ length: days }, (_, i) => ({ label: String(i + 1), full: `${i + 1} ${monthShort(st.m)}`, value: 0 }));
      for (const t of list) pts[+t.date.slice(8) - 1].value += t.amount;
      return pts;
    }
    if (st.mode === "year") {
      const pts = Array.from({ length: 12 }, (_, i) => ({ label: monthShort(i), full: `${monthName(i)} ${st.y}`, value: 0 }));
      for (const t of list) pts[+t.date.slice(5, 7) - 1].value += t.amount;
      return pts;
    }
    // all time: by month, from the first entry (last 24 months at most)
    const keys = store.all("txns").map((t) => t.date.slice(0, 7)).sort();
    if (!keys.length) return [];
    let [y, m] = keys[0].split("-").map(Number);
    const end = today().slice(0, 7);
    const pts = [];
    while (`${y}-${String(m).padStart(2, "0")}` <= end) {
      pts.push({ key: `${y}-${String(m).padStart(2, "0")}`, label: m === 1 ? String(y) : monthShort(m - 1), full: `${monthName(m - 1)} ${y}`, value: 0 });
      if (++m > 12) { m = 1; y++; }
    }
    const view = pts.slice(-24);
    const idx = new Map(view.map((p, i) => [p.key, i]));
    for (const t of list) { const i = idx.get(t.date.slice(0, 7)); if (i != null) view[i].value += t.amount; }
    return view;
  }
  function highlightIndex() {
    if (st.mode === "month" && isCurrent()) return now.getDate() - 1;
    if (st.mode === "year" && isCurrent()) return now.getMonth();
    return -1;
  }

  // ---------- edit ----------
  function edit(t) {
    sheet(t.kind === "income" ? "Доход" : "Расход", (box, close) => {
      let kind = t.kind, cat = t.cat;
      const amount = h("input", { id: "tx-amount", inputMode: "decimal", value: String(t.amount).replace(".", ","), "aria-label": "сумма" });
      const date = h("input", { id: "tx-date", type: "date", value: t.date, max: "2100-12-31" });
      const note = h("input", { id: "tx-note", value: t.note || "", maxLength: 300, placeholder: "например, кофе с Машей" });
      const chips = h("div", { class: "chips" });
      const kindSeg = h("div");
      const drawCats = () => {
        chips.textContent = "";
        for (const c of ctx.cats(kind)) chips.append(h("button", { type: "button", class: "chip", "aria-pressed": String(c.id === cat), onclick: () => { cat = c.id; drawCats(); } }, h("i", { class: "dot", style: { background: `var(--c${c.color})` } }), c.name));
        kindSeg.textContent = "";
        kindSeg.append(seg([["expense", "расход"], ["income", "доход"]], kind, (v) => { kind = v; if (ctx.cat(cat)?.scope !== v) cat = ctx.fallbackCat(v); drawCats(); }));
      };
      drawCats();
      const save = h("button", { type: "submit", class: "btn" }, "Сохранить");
      const f = h("form", { style: { display: "contents" }, onsubmit: (e) => {
        e.preventDefault();
        const a = toNumber(amount.value);
        if (!a) { amount.focus(); return; }
        store.put("txns", { ...t, kind, cat, amount: a, date: date.value || t.date, note: note.value.trim() });
        close();
      } },
        kindSeg,
        h("div", { class: "pair" }, h("label", { class: "field" }, "сумма", amount), h("label", { class: "field" }, "дата", date)),
        h("div", { class: "field" }, "категория", chips),
        h("label", { class: "field" }, "комментарий", note),
        h("div", { class: "acts" },
          h("button", { type: "button", class: "link danger", onclick: () => { const prev = store.remove("txns", t.id); close(); toast("Операция удалена", { label: "вернуть", run: () => store.put("txns", prev) }); } }, "удалить"),
          h("div", { class: "r" }, h("button", { type: "button", class: "btn ghost", onclick: close }, "Отмена"), save)));
      box.append(f);
    });
  }

  // ---------- import a pasted list ----------
  function openImport(initial) {
    sheet("Вставить списком", (box, close) => {
      const area = h("textarea", { id: "bulk-text", placeholder: "8 октября\n• Такси на работу: 27 000\n• Кофе флэт уайт: 50 000\n\n9 октября\n• Подписка Claude: 270 000", style: { minHeight: "160px" } });
      area.value = initial;
      const out = h("div", { style: { display: "grid", gap: "14px" } });
      const addBtn = h("button", { type: "button", class: "btn", disabled: true }, "Добавить");
      let groups = [];

      const draw = () => {
        const res = parseBulk(area.value, ctx.cats());
        // keep dates and categories the person already changed when the text is edited
        groups = res.groups.map((g, gi) => ({ ...g, date: (groups[gi] && groups[gi].touched ? groups[gi].date : g.date) || groups[gi]?.date || today(), touched: groups[gi]?.touched,
          items: g.items.map((it) => ({ ...it, cat: it.cat || ctx.fallbackCat(it.kind), on: true })) }));
        out.textContent = "";
        if (!area.value.trim()) { addBtn.disabled = true; addBtn.textContent = "Добавить"; return; }
        groups.forEach((g, gi) => {
          const total = g.items.reduce((s, it) => s + (it.kind === "income" ? it.amount : -it.amount), 0);
          const dateIn = h("input", { type: "date", id: "bulk-date-" + gi, value: g.date, max: "2100-12-31", style: { border: 0, background: "var(--soft)", borderRadius: "8px", padding: "6px 10px", font: "inherit" },
            onchange: () => { g.date = dateIn.value || g.date; g.touched = true; dateIn.previousElementSibling?.remove(); } });
          const list = h("ul", { class: "list" });
          g.items.forEach((it, ii) => {
            const sel = h("select", { id: `bulk-cat-${gi}-${ii}`, "aria-label": "категория", style: { border: 0, background: "var(--soft)", borderRadius: "8px", padding: "4px 8px", font: "inherit", fontSize: "13px", maxWidth: "100%" },
              onchange: () => { it.cat = sel.value; } },
              ctx.cats(it.kind).map((c) => h("option", { value: c.id, selected: c.id === it.cat }, c.name)));
            const chk = h("input", { type: "checkbox", id: `bulk-on-${gi}-${ii}`, checked: true, "aria-label": "добавить эту строку", onchange: () => { it.on = chk.checked; recount(); } });
            list.append(h("li", { class: "row", style: { cursor: "default", padding: "10px 0" } },
              chk,
              h("div", { class: "main" }, h("div", { class: "t" }, it.note), h("div", { class: "sub" }, sel)),
              h("div", { class: "amt" + (it.kind === "income" ? " in" : "") }, money(it.kind === "income" ? it.amount : -it.amount, ctx.currency(), { sign: true }))));
          });
          out.append(h("div", {},
            h("div", { class: "group-h", style: { marginTop: 0, alignItems: "center" } },
              h("span", { style: { display: "flex", gap: "8px", alignItems: "center" } }, !res.groups[gi].date && !g.touched ? h("b", { style: { color: "var(--bad)" } }, "дата?") : null, dateIn),
              h("span", { class: "num" }, money(total, ctx.currency(), { sign: true }))),
            list));
        });
        if (groups.some((g, gi) => !res.groups[gi].date)) out.prepend(h("p", { class: "note" }, "У первых строк нет даты. Выбери её выше, иначе они запишутся на сегодня."));
        if (res.skipped.length) out.append(h("p", { class: "note" }, `Без суммы, пропущено: ${res.skipped.join("; ")}`));
        recount();
      };
      const recount = () => {
        const items = groups.flatMap((g) => g.items.filter((it) => it.on));
        const sum = items.reduce((s, it) => s + it.amount, 0);
        addBtn.disabled = !items.length;
        addBtn.textContent = items.length ? `Добавить ${items.length} ${plural(items.length, ["операцию", "операции", "операций"])} · ${money(sum, ctx.currency())}` : "Нечего добавить";
      };
      let t; area.addEventListener("input", () => { clearTimeout(t); t = setTimeout(draw, 250); });
      addBtn.onclick = () => {
        let n = 0, last = null;
        for (const g of groups) for (const it of g.items) {
          if (!it.on) continue;
          store.put("txns", { kind: it.kind, amount: it.amount, cat: it.cat, date: g.date, note: it.note });
          n++; last = g.date;
        }
        close();
        if (last) { const d = parseDay(last); st.y = d.getFullYear(); st.m = d.getMonth(); if (st.mode === "all") st.mode = "month"; }
        render();
        toast(`Добавлено ${n} ${plural(n, ["операция", "операции", "операций"])}`);
      };
      box.append(
        h("p", { class: "note" }, "Каждая строка — одна трата: «название: сумма» или «кофе 25к». Строка с датой («8 октября») относится ко всему, что ниже. Доход — со знаком +."),
        h("label", { class: "field" }, area), out,
        h("div", { class: "acts" }, h("button", { type: "button", class: "btn ghost", onclick: close }, "Отмена"), addBtn));
      draw();
      if (!initial) area.focus();
    });
  }

  return { el, render, focus: () => input.focus(), prefill: (text) => { input.value = text; renderCapture(); input.focus(); } };
}

export function seg(options, value, onChange) {
  return h("div", { class: "seg", role: "group" }, options.map(([v, label]) =>
    h("button", { type: "button", "aria-pressed": String(v === value), onclick: () => onChange(v) }, label)));
}
