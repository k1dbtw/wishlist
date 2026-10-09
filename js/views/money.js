import * as store from "../store.js";
import { barChart, stack } from "../charts.js";
import { h, money, parseTxn, today, dayLabel, parseDay, monthName, monthShort, plural, toNumber, toast, sheet } from "../util.js";

export function moneyView(ctx) {
  const now = new Date();
  const st = { mode: "month", y: now.getFullYear(), m: now.getMonth(), kind: "expense", filter: null, addKind: null, addCat: null, addDate: null };

  // ---------- capture line ----------
  const input = h("input", { id: "money-q", type: "text", placeholder: "кофе 25к или +8 млн зарплата", "aria-label": "новая операция", enterkeyhint: "done", autocomplete: "off", inputMode: "text" });
  const sign = h("button", { type: "button", class: "sign", "aria-label": "расход или доход" });
  const go = h("button", { type: "submit", class: "go", "aria-label": "добавить" }, "+");
  const preview = h("p", { class: "preview" });
  const catChips = h("div", { class: "chips", role: "group", "aria-label": "категория" });
  const form = h("form", { class: "capture", autocomplete: "off" }, sign, input, go);
  const body = h("div");
  const el = h("section", { "aria-label": "деньги" }, form, preview, catChips, body);

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

  return { el, render, focus: () => input.focus(), prefill: (text) => { input.value = text; renderCapture(); input.focus(); } };
}

export function seg(options, value, onChange) {
  return h("div", { class: "seg", role: "group" }, options.map(([v, label]) =>
    h("button", { type: "button", "aria-pressed": String(v === value), onclick: () => onChange(v) }, label)));
}
