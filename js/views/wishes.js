import * as store from "../store.js";
import { h, svg, parseWish, money, host, safeUrl, plural, toNumber, toast, sheet, today, load, save } from "../util.js";
import { seg } from "./money.js";

const CHECK = '<svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
const SORTS = [["new", "новые"], ["prio", "важные"], ["exp", "дороже"], ["cheap", "дешевле"]];

export function wishesView(ctx) {
  const ui = Object.assign({ sort: "new" }, load("stash.ui.wishes", {}));
  let prio = 2, showDone = false;

  const input = h("input", { id: "wishes-q", type: "text", placeholder: "что хочется? можно со ссылкой и ценой", "aria-label": "новое желание", enterkeyhint: "done", autocomplete: "off" });
  const prioBtn = h("button", { type: "button", class: "prio", "data-p": "2", "aria-label": "насколько хочется" }, h("i"), h("i"), h("i"));
  const go = h("button", { type: "submit", class: "go", "aria-label": "добавить" }, "+");
  const preview = h("p", { class: "preview" });
  const form = h("form", { class: "capture", autocomplete: "off" }, prioBtn, input, go);
  const body = h("div");
  const el = h("section", { "aria-label": "хочу" }, form, preview, body);

  function renderCapture() {
    const v = input.value.trim();
    go.classList.toggle("on", !!v);
    preview.textContent = "";
    if (!v) { preview.append("вставь ссылку и цену: «кеды https://… 890 000»"); return; }
    const p = parseWish(v);
    preview.append(h("b", {}, p.title || "…"));
    if (p.url) preview.append(" · " + host(p.url));
    preview.append(" · " + (p.price != null ? money(p.price, ctx.currency()) : "без цены"));
  }
  input.addEventListener("input", renderCapture);
  prioBtn.addEventListener("click", () => { prio = (prio % 3) + 1; prioBtn.dataset.p = prio; });
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const v = input.value.trim(); if (!v) return;
    const p = parseWish(v);
    store.put("wishes", { title: p.title.slice(0, 200) || "без названия", url: p.url, price: p.price, priority: prio, note: "", done: false, doneAt: null });
    input.value = ""; renderCapture();
  });

  function render() {
    renderCapture();
    const cur = ctx.currency();
    const all = store.all("wishes");
    const want = all.filter((w) => !w.done), done = all.filter((w) => w.done).sort((a, b) => (b.doneAt || 0) - (a.doneAt || 0));
    const sum = want.reduce((s, w) => s + (w.price || 0), 0);
    body.textContent = "";

    if (want.length) {
      body.append(h("div", { class: "bar" },
        h("span", { class: "note" }, `${want.length} ${plural(want.length, ["желание", "желания", "желаний"])} на `, h("b", { class: "num", style: { color: "var(--fg)", fontWeight: 500 } }, money(sum, cur))),
        seg(SORTS, ui.sort, (v) => { ui.sort = v; save("stash.ui.wishes", ui); render(); })));
      // how many months of the current savings rate it would take
      const rate = monthlySavings();
      if (rate > 0 && sum > 0) body.append(h("p", { class: "note", style: { marginTop: "8px" } }, `при нынешнем темпе откладывания всё сбудется примерно за ${Math.max(1, Math.ceil(sum / rate))} ${plural(Math.ceil(sum / rate), ["месяц", "месяца", "месяцев"])}`));
      const cmp = {
        new: (a, b) => b.createdAt - a.createdAt,
        prio: (a, b) => b.priority - a.priority || b.createdAt - a.createdAt,
        exp: (a, b) => (b.price ?? -1) - (a.price ?? -1),
        cheap: (a, b) => (a.price ?? Infinity) - (b.price ?? Infinity),
      }[ui.sort];
      body.append(h("ul", { class: "list", style: { marginTop: "16px", borderTop: "1px solid var(--line)" } }, want.sort(cmp).map(row)));
    } else {
      body.append(h("p", { class: "empty" }, all.length ? "Все желания сбылись. Пора придумать новые." : h("span", {}, "Пока пусто. Напиши, например, ", h("b", {}, "«наушники sony 3,5 млн»"), ": название и цену приложение разберёт само.")));
    }

    if (done.length) {
      body.append(h("button", { type: "button", class: "fold", onclick: () => { showDone = !showDone; render(); } }, `сбылось · ${done.length} ${showDone ? "↑" : "↓"}`));
      if (showDone) body.append(h("ul", { class: "list", style: { marginTop: "8px" } }, done.map(row)));
    }
  }

  // average (income − expense) over the last three full months
  function monthlySavings() {
    const d = new Date(), months = [];
    for (let i = 1; i <= 3; i++) { const x = new Date(d.getFullYear(), d.getMonth() - i, 1); months.push(`${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}`); }
    const txns = store.all("txns").filter((t) => months.includes(t.date.slice(0, 7)));
    if (!txns.length) return 0;
    const net = txns.reduce((s, t) => s + (t.kind === "income" ? t.amount : -t.amount), 0);
    return net / 3;
  }

  function row(w) {
    const cur = ctx.currency();
    const tick = h("button", { type: "button", class: "tick", "aria-label": w.done ? "вернуть в список" : "сбылось", onclick: (e) => { e.stopPropagation(); toggle(w); } }, svg(CHECK));
    const sub = h("div", { class: "sub" }, h("span", { class: "dots", "data-p": String(w.priority) }, h("i"), h("i"), h("i")));
    const u = safeUrl(w.url || "");
    if (u) sub.append(h("a", { href: u, target: "_blank", rel: "noopener noreferrer", onclick: (e) => e.stopPropagation() }, host(u)));
    if (w.note) sub.append(h("span", {}, w.note));
    return h("li", { class: "row" + (w.done ? " is-done" : ""), tabIndex: 0, onclick: () => edit(w), onkeydown: (e) => e.key === "Enter" && e.target === e.currentTarget && edit(w) },
      tick,
      h("div", { class: "main" }, h("div", { class: "t" }, w.title), sub),
      h("div", { class: "amt" + (w.price == null ? " none" : "") }, w.price == null ? "—" : money(w.price, cur)));
  }

  function toggle(w) {
    const doneNow = !w.done;
    store.put("wishes", { ...w, done: doneNow, doneAt: doneNow ? Date.now() : null });
    if (doneNow && w.price) {
      toast("Сбылось!", { label: `записать расход ${money(w.price, ctx.currency())}`, run: () => {
        store.put("txns", { kind: "expense", amount: w.price, cat: ctx.cat("c-shop") ? "c-shop" : ctx.fallbackCat("expense"), date: today(), note: w.title });
        toast("Записано в «Деньги»");
      } });
    } else if (doneNow) toast("Сбылось!");
  }

  function edit(w) {
    sheet("Желание", (box, close) => {
      let p = w.priority;
      const title = h("input", { id: "wish-title", value: w.title, maxLength: 200 });
      const url = h("input", { id: "wish-url", value: w.url || "", inputMode: "url", placeholder: "https://" });
      const price = h("input", { id: "wish-price", value: w.price == null ? "" : String(w.price).replace(".", ","), inputMode: "decimal", placeholder: "0" });
      const note = h("textarea", { id: "wish-note", maxLength: 1000, placeholder: "размер, цвет, где видел" }); note.value = w.note || "";
      const pb = h("button", { type: "button", class: "prio", "data-p": String(p), "aria-label": "насколько хочется", style: { background: "var(--soft)", borderRadius: "10px", padding: "13px 14px" } }, h("i"), h("i"), h("i"));
      pb.onclick = () => { p = (p % 3) + 1; pb.dataset.p = p; };
      box.append(h("form", { style: { display: "contents" }, onsubmit: (e) => {
        e.preventDefault();
        const raw = url.value.trim();
        store.put("wishes", { ...w, title: title.value.trim() || "без названия", url: raw ? safeUrl(/^https?:\/\//i.test(raw) ? raw : "https://" + raw) : "", price: toNumber(price.value), priority: p, note: note.value.trim() });
        close();
      } },
        h("label", { class: "field" }, "название", title),
        h("label", { class: "field" }, "ссылка", url),
        h("div", { class: "pair" }, h("label", { class: "field" }, "цена", price), h("div", { class: "field" }, "насколько хочется", pb)),
        h("label", { class: "field" }, "заметка", note),
        h("div", { class: "acts" },
          h("button", { type: "button", class: "link danger", onclick: () => { const prev = store.remove("wishes", w.id); close(); toast("Желание удалено", { label: "вернуть", run: () => store.put("wishes", prev) }); } }, "удалить"),
          h("div", { class: "r" }, h("button", { type: "button", class: "btn ghost", onclick: close }, "Отмена"), h("button", { type: "submit", class: "btn" }, "Сохранить")))));
    });
  }

  return { el, render, focus: () => input.focus(), prefill: (text) => { input.value = text; renderCapture(); input.focus(); } };
}
