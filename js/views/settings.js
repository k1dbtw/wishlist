import * as store from "../store.js";
import { h, sheet, toast, download, csvCell, toNumber, newId } from "../util.js";
import { CURRENCIES } from "../defaults.js";
import { seg } from "./money.js";

export const ACCENTS = ["#8b7cff", "#ff6b8b", "#3fbf9b", "#4b9dff", "#f5a524", "#16161a"];
const SCOPES = [["expense", "расходы"], ["income", "доходы"], ["task", "дела"]];
const ERR = { bad_credentials: "Неверный пароль", weak_password: "Пароль должен быть не короче 8 символов", bad_key: "Старый пароль не подошёл" };

export function openSettings(ctx) {
  sheet("Настройки", (box, close) => {
    const prefs = ctx.prefs();

    // ---------- account ----------
    const pwBox = h("div", { hidden: true, style: { display: "grid", gap: "10px" } });
    const cur = h("input", { id: "pw-cur", type: "password", autocomplete: "current-password", placeholder: "текущий пароль" });
    const next = h("input", { id: "pw-next", type: "password", autocomplete: "new-password", placeholder: "новый пароль, от 8 символов" });
    const pwErr = h("p", { class: "err" });
    pwBox.append(h("label", { class: "field" }, cur), h("label", { class: "field" }, next), pwErr,
      h("button", { type: "button", class: "btn", style: { justifySelf: "start" }, onclick: async () => {
        pwErr.textContent = "";
        try { await store.api("POST", "/auth/password", { current: cur.value, next: next.value }); toast("Пароль изменён, другие устройства вышли из аккаунта"); pwBox.hidden = true; cur.value = next.value = ""; }
        catch (e) { pwErr.textContent = ERR[e.message] || "Не получилось. Проверь интернет."; }
      } }, "Сменить пароль"));

    box.append(
      h("h3", {}, "аккаунт"),
      h("div", { class: "set-row" }, h("span", {}, "почта"), h("b", { style: { fontWeight: 500, overflowWrap: "anywhere" } }, ctx.email())),
      h("div", { class: "set-row" },
        h("button", { type: "button", class: "link", onclick: () => { pwBox.hidden = !pwBox.hidden; } }, "сменить пароль"),
        h("div", { style: { display: "flex", gap: "16px" } },
          h("button", { type: "button", class: "link", onclick: async () => { try { await store.api("POST", "/auth/logout-all", {}); toast("Все другие устройства вышли из аккаунта"); } catch { toast("Нет связи с сервером"); } } }, "выйти везде"),
          h("button", { type: "button", class: "link", onclick: () => { close(); ctx.logout(); } }, "выйти"))),
      pwBox);

    // ---------- money ----------
    const currency = h("select", { id: "set-currency", onchange: () => ctx.setPrefs({ currency: currency.value, cv: 2 }) },
      CURRENCIES.map(([code, label]) => h("option", { value: code, selected: code === prefs.currency }, label)));
    const budget = h("input", { id: "set-budget", inputMode: "decimal", placeholder: "не задан", value: prefs.budget ? String(prefs.budget) : "",
      onchange: () => ctx.setPrefs({ budget: toNumber(budget.value) }) });
    box.append(h("h3", {}, "деньги"),
      h("div", { class: "set-row" }, h("span", {}, "валюта"), currency),
      h("div", { class: "set-row" }, h("span", {}, "бюджет на месяц"), budget));

    // ---------- categories ----------
    let scope = "expense";
    const catBox = h("div");
    const drawCats = () => {
      catBox.textContent = "";
      catBox.append(seg(SCOPES, scope, (v) => { scope = v; drawCats(); }));
      for (const c of ctx.cats(scope)) {
        const name = h("input", { id: "cat-" + c.id, value: c.name, maxLength: 40, "aria-label": "название категории",
          onchange: () => { if (name.value.trim()) store.put("cats", { ...c, name: name.value.trim() }); } });
        catBox.append(h("div", { class: "cat-edit" },
          h("button", { type: "button", class: "dotbtn", title: "сменить цвет", "aria-label": "сменить цвет", style: { background: `var(--c${c.color})` },
            onclick: () => { store.put("cats", { ...c, color: (c.color + 1) % 9 }); drawCats(); } }),
          name,
          h("button", { type: "button", class: "link danger", "aria-label": "удалить категорию", onclick: () => {
            if (ctx.cats(scope).length <= 1) return toast("Нужна хотя бы одна категория");
            const prev = store.remove("cats", c.id); drawCats();
            toast(`Категория «${c.name}» удалена`, { label: "вернуть", run: () => { store.put("cats", prev); drawCats(); } });
          } }, "удалить")));
      }
      catBox.append(h("button", { type: "button", class: "link", style: { marginTop: "6px" }, onclick: () => {
        const list = ctx.cats(scope);
        const used = new Set(list.map((c) => c.color));
        const color = [0, 1, 2, 3, 4, 5, 6, 7].find((x) => !used.has(x)) ?? 8;
        store.put("cats", { id: newId("c-"), scope, name: "Новая категория", color, order: Math.max(0, ...list.map((c) => c.order || 0)) + 1, keywords: "" });
        drawCats();
        const inputs = catBox.querySelectorAll(".cat-edit input"); const last = inputs[inputs.length - 1]; last && (last.focus(), last.select());
      } }, "+ добавить категорию"));
    };
    drawCats();
    box.append(h("h3", {}, "категории"), h("p", { class: "note" }, "Нажми на кружок, чтобы сменить цвет. Записи из удалённой категории останутся, просто без категории."), catBox);

    // ---------- look (this device only) ----------
    const look = ctx.look();
    const sw = h("div", { class: "swatches" });
    const drawSw = () => { sw.textContent = ""; for (const c of ACCENTS) sw.append(h("button", { type: "button", "aria-label": "цвет " + c, "aria-pressed": String(c === ctx.look().accent), style: { "--sw": c }, onclick: () => { ctx.setLook({ accent: c }); drawSw(); } })); };
    drawSw();
    const themeBox = h("div");
    const drawTheme = () => { themeBox.textContent = ""; themeBox.append(seg([["auto", "авто"], ["light", "светлая"], ["dark", "тёмная"]], ctx.look().theme, (v) => { ctx.setLook({ theme: v }); drawTheme(); })); };
    drawTheme();
    box.append(h("h3", {}, "оформление"), h("div", { class: "set-row" }, h("span", {}, "акцент"), sw), h("div", { class: "set-row" }, h("span", {}, "тема"), themeBox));

    // ---------- data ----------
    const dataRows = [
      h("div", { class: "set-row" }, h("span", {}, "экспорт"), h("div", { style: { display: "flex", gap: "16px" } },
        h("button", { type: "button", class: "link", onclick: exportCsv }, "операции · csv"),
        h("button", { type: "button", class: "link", onclick: () => download(`stash-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(store.snapshot(), null, 2), "application/json") }, "всё · json"))),
    ];
    if (ctx.config().legacy) {
      const key = h("input", { id: "legacy-key", type: "password", placeholder: "пароль старого вишлиста" });
      dataRows.push(h("div", { class: "set-row" }, key, h("button", { type: "button", class: "link", onclick: async () => {
        try { const r = await store.api("POST", "/import-legacy", { key: key.value }); toast(`Перенесено желаний: ${r.imported}`); store.pull(); }
        catch (e) { toast(ERR[e.message] || "Не получилось перенести"); }
      } }, "перенести")));
    }
    box.append(h("h3", {}, "данные"), ...dataRows);

    // ---------- danger ----------
    const delPw = h("input", { id: "del-pw", type: "password", autocomplete: "current-password", placeholder: "пароль для подтверждения" });
    const delErr = h("p", { class: "err" });
    const delBox = h("div", { hidden: true, style: { display: "grid", gap: "10px" } },
      h("p", { class: "note" }, "Удалятся аккаунт и все записи: деньги, дела и желания. Отменить это нельзя. Если нужно, сначала сделай экспорт."),
      h("label", { class: "field" }, delPw), delErr,
      h("button", { type: "button", class: "btn danger", style: { justifySelf: "start" }, onclick: async () => {
        delErr.textContent = "";
        try { await store.api("POST", "/account/delete", { password: delPw.value }); close(); ctx.logout({ silent: true }); toast("Аккаунт удалён"); }
        catch (e) { delErr.textContent = ERR[e.message] || "Не получилось. Проверь интернет."; }
      } }, "Удалить навсегда"));
    box.append(h("h3", {}, "аккаунт и данные"),
      h("div", { class: "set-row" }, h("button", { type: "button", class: "link danger", onclick: () => { delBox.hidden = !delBox.hidden; } }, "удалить аккаунт")), delBox,
      h("p", { class: "note", style: { marginTop: "12px" } }, "stash · деньги, дела и желания"),
      h("div", { class: "acts" }, h("span"), h("button", { type: "button", class: "btn", onclick: close }, "Готово")));
  });

  function exportCsv() {
    const rows = [["дата", "тип", "сумма", "валюта", "категория", "комментарий"]];
    for (const t of store.all("txns").sort((a, b) => a.date.localeCompare(b.date))) {
      rows.push([t.date, t.kind === "income" ? "доход" : "расход", String(t.amount).replace(".", ","), ctx.currency(), ctx.cat(t.cat)?.name || "", t.note || ""]);
    }
    download(`stash-operations-${new Date().toISOString().slice(0, 10)}.csv`, "﻿" + rows.map((r) => r.map(csvCell).join(";")).join("\n"), "text/csv;charset=utf-8");
  }
}
