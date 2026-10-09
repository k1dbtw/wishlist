import * as store from "../store.js";
import { h, svg, parseTask, today, addDays, diffDays, dayLabel, plural, toast, sheet, load, save } from "../util.js";
import { seg } from "./money.js";

const CHECK = '<svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';

export function tasksView(ctx) {
  const ui = Object.assign({ group: "cat", filter: null }, load("stash.ui.tasks", {}));
  const st = { addCat: null, showDone: false };

  const input = h("input", { id: "tasks-q", type: "text", placeholder: "мысль или дело: «позвонить маме завтра»", "aria-label": "новая запись", enterkeyhint: "done", autocomplete: "off" });
  const go = h("button", { type: "submit", class: "go", "aria-label": "добавить" }, "+");
  const preview = h("p", { class: "preview" });
  const catChips = h("div", { class: "chips", role: "group", "aria-label": "категория" });
  const form = h("form", { class: "capture", autocomplete: "off" }, input, go);
  const body = h("div");
  const el = h("section", { "aria-label": "дела" }, form, preview, catChips, body);

  const effective = () => {
    const p = parseTask(input.value, ctx.cats());
    return { ...p, cat: st.addCat || p.cat || ui.filter || "t-inbox" };
  };

  function renderCapture() {
    const e = effective();
    go.classList.toggle("on", !!input.value.trim());
    preview.textContent = "";
    if (!input.value.trim()) preview.append("срок словами («завтра», «в пт», «12.11») и #категория");
    else {
      preview.append(h("b", {}, e.text || "…"), " · " + (ctx.cat(e.cat)?.name || "входящие"));
      if (e.due) preview.append(" · " + dayLabel(e.due, { withWeekday: false }));
    }
    catChips.textContent = "";
    for (const c of ctx.cats("task")) {
      catChips.append(h("button", { type: "button", class: "chip", "aria-pressed": String(c.id === e.cat), onclick: () => { st.addCat = c.id; renderCapture(); input.focus(); } },
        h("i", { class: "dot", style: { background: `var(--c${c.color})` } }), c.name));
    }
  }
  input.addEventListener("input", () => { if (!input.value.trim()) st.addCat = null; renderCapture(); });
  form.addEventListener("submit", (ev) => {
    ev.preventDefault();
    if (!input.value.trim()) return;
    const e = effective();
    store.put("tasks", { text: e.text.slice(0, 1000) || input.value.trim(), cat: e.cat, due: e.due, done: false, doneAt: null, pinned: false });
    input.value = ""; st.addCat = null;
    renderCapture();
  });

  const setUi = (patch) => { Object.assign(ui, patch); save("stash.ui.tasks", ui); render(); };

  function render() {
    renderCapture();
    const all = store.all("tasks");
    const open = all.filter((t) => !t.done);
    const done = all.filter((t) => t.done).sort((a, b) => (b.doneAt || 0) - (a.doneAt || 0));
    body.textContent = "";

    // filters
    const counts = new Map();
    for (const t of open) counts.set(t.cat || "t-inbox", (counts.get(t.cat || "t-inbox") || 0) + 1);
    const chips = h("div", { class: "chips", role: "group", "aria-label": "фильтр" },
      h("button", { type: "button", class: "chip", "aria-pressed": String(!ui.filter), onclick: () => setUi({ filter: null }) }, "все ", h("small", {}, String(open.length))));
    for (const c of ctx.cats("task")) {
      chips.append(h("button", { type: "button", class: "chip", "aria-pressed": String(ui.filter === c.id), onclick: () => setUi({ filter: ui.filter === c.id ? null : c.id }) },
        h("i", { class: "dot", style: { background: `var(--c${c.color})` } }), c.name, " ", h("small", {}, String(counts.get(c.id) || 0))));
    }
    body.append(h("div", { class: "bar" },
      h("span", { class: "note" }, open.length ? `открыто ${open.length}` + (overdue(open) ? ` · просрочено ${overdue(open)}` : "") : "всё сделано"),
      seg([["cat", "по категориям"], ["due", "по сроку"], ["new", "новые"]], ui.group, (v) => setUi({ group: v }))));
    body.append(chips);

    const visible = open.filter((t) => !ui.filter || (t.cat || "t-inbox") === ui.filter);
    if (!all.length) {
      body.append(h("p", { class: "empty" }, "Сюда записывается всё, что не хочется держать в голове. Попробуй: ", h("b", {}, "«купить батарейки #купить»"), ", ", h("b", {}, "«отчёт в пт #работа»"), " или просто мысль, пока не убежала."));
    } else if (!visible.length) {
      body.append(h("p", { class: "empty" }, ui.filter ? "В этой категории пусто." : "Открытых дел нет. Можно выдохнуть."));
    } else {
      for (const [title, items] of groups(visible)) {
        if (title) body.append(h("div", { class: "group-h" }, h("b", {}, title), h("span", { class: "num" }, String(items.length))));
        body.append(h("ul", { class: "list" }, items.map(row)));
      }
    }

    if (done.length) {
      body.append(h("div", { class: "bar" },
        h("button", { type: "button", class: "fold", style: { margin: 0 }, onclick: () => { st.showDone = !st.showDone; render(); } }, `выполнено · ${done.length} ${st.showDone ? "↑" : "↓"}`),
        st.showDone ? h("button", { type: "button", class: "link danger", onclick: clearDone }, "очистить") : null));
      if (st.showDone) body.append(h("ul", { class: "list" }, done.slice(0, 100).map(row)));
    }
  }

  const overdue = (list) => list.filter((t) => t.due && t.due < today()).length;
  const byPinThenNew = (a, b) => (b.pinned - a.pinned) || b.createdAt - a.createdAt;
  const byDue = (a, b) => (b.pinned - a.pinned) || (a.due || "9999").localeCompare(b.due || "9999") || b.createdAt - a.createdAt;

  function groups(list) {
    if (ui.group === "new") return [[null, list.sort(byPinThenNew)]];
    if (ui.group === "due") {
      const t = today(), buckets = [["Просрочено", []], ["Сегодня", []], ["Завтра", []], ["На этой неделе", []], ["Позже", []], ["Без срока", []]];
      for (const x of list) {
        const d = x.due ? diffDays(x.due, t) : null;
        const i = d == null ? 5 : d < 0 ? 0 : d === 0 ? 1 : d === 1 ? 2 : d <= 7 ? 3 : 4;
        buckets[i][1].push(x);
      }
      return buckets.filter((b) => b[1].length).map(([n, items]) => [n, items.sort(byDue)]);
    }
    const map = new Map();
    for (const x of list) { const k = ctx.cat(x.cat) ? x.cat : "t-inbox"; if (!map.has(k)) map.set(k, []); map.get(k).push(x); }
    const order = ctx.cats("task").map((c) => c.id);
    return [...map.entries()].sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0]))
      .map(([k, items]) => [ui.filter ? null : ctx.cat(k)?.name || "Входящие", items.sort(byDue)]);
  }

  function row(t) {
    const c = ctx.cat(t.cat);
    const tick = h("button", { type: "button", class: "tick", "aria-label": t.done ? "вернуть" : "готово", onclick: (e) => { e.stopPropagation(); toggle(t); } }, svg(CHECK));
    const sub = h("div", { class: "sub" });
    if (t.pinned) sub.append(h("span", { class: "pin" }, "закреплено"));
    if (t.due && !t.done) {
      const d = diffDays(t.due, today());
      sub.append(h("span", { class: d < 0 ? "late" : d <= 1 ? "soon" : "" }, d < 0 ? `просрочено · ${dayLabel(t.due, { withWeekday: false })}` : dayLabel(t.due)));
    }
    if (ui.group !== "cat" || ui.filter || t.done) sub.append(h("span", { class: "c" }, h("i", { class: "dot", style: { background: `var(--c${c ? c.color : 8})` } }), c?.name || "Входящие"));
    return h("li", { class: "row" + (t.done ? " is-done" : ""), tabIndex: 0, onclick: () => edit(t), onkeydown: (e) => e.key === "Enter" && e.target === e.currentTarget && edit(t) },
      tick, h("div", { class: "main" }, h("div", { class: "t" }, t.text), sub.childNodes.length ? sub : null), h("span"));
  }

  function toggle(t) {
    store.put("tasks", { ...t, done: !t.done, doneAt: t.done ? null : Date.now() });
  }
  function clearDone() {
    const done = store.all("tasks").filter((t) => t.done);
    done.forEach((t) => store.remove("tasks", t.id));
    toast(`Удалено ${done.length}`, { label: "вернуть", run: () => done.forEach((t) => store.put("tasks", t)) });
  }

  function edit(t) {
    sheet("Запись", (box, close) => {
      let cat = ctx.cat(t.cat) ? t.cat : "t-inbox", due = t.due, pinned = !!t.pinned;
      const text = h("textarea", { id: "task-text", maxLength: 1000 }); text.value = t.text;
      const chips = h("div", { class: "chips" });
      const dueRow = h("div", { class: "chips" });
      const dueInput = h("input", { id: "task-due", type: "date", value: due || "", onchange: () => { due = dueInput.value || null; draw(); } });
      const pin = h("button", { type: "button", class: "chip" });
      const draw = () => {
        chips.textContent = "";
        for (const c of ctx.cats("task")) chips.append(h("button", { type: "button", class: "chip", "aria-pressed": String(c.id === cat), onclick: () => { cat = c.id; draw(); } }, h("i", { class: "dot", style: { background: `var(--c${c.color})` } }), c.name));
        dueRow.textContent = "";
        const t0 = today();
        for (const [label, val] of [["сегодня", t0], ["завтра", addDays(t0, 1)], ["через неделю", addDays(t0, 7)], ["без срока", null]]) {
          dueRow.append(h("button", { type: "button", class: "chip", "aria-pressed": String(due === val), onclick: () => { due = val; dueInput.value = val || ""; draw(); } }, label));
        }
        pin.setAttribute("aria-pressed", String(pinned)); pin.textContent = pinned ? "закреплено сверху" : "закрепить сверху";
      };
      pin.onclick = () => { pinned = !pinned; draw(); };
      draw();
      box.append(h("form", { style: { display: "contents" }, onsubmit: (e) => {
        e.preventDefault();
        store.put("tasks", { ...t, text: text.value.trim() || t.text, cat, due, pinned });
        close();
      } },
        h("label", { class: "field" }, "текст", text),
        h("div", { class: "field" }, "категория", chips),
        h("div", { class: "field" }, "срок", dueRow, dueInput),
        h("div", { class: "field" }, h("div", { class: "chips" }, pin)),
        h("div", { class: "acts" },
          h("button", { type: "button", class: "link danger", onclick: () => { const prev = store.remove("tasks", t.id); close(); toast("Запись удалена", { label: "вернуть", run: () => store.put("tasks", prev) }); } }, "удалить"),
          h("div", { class: "r" }, h("button", { type: "button", class: "btn ghost", onclick: close }, "Отмена"), h("button", { type: "submit", class: "btn" }, "Сохранить")))));
    });
  }

  return { el, render, focus: () => input.focus(), prefill: (text) => { input.value = text; renderCapture(); input.focus(); } };
}
