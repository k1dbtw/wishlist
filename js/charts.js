import { h, shortMoney } from "./util.js";

// Single-series bar chart: one bar per day / month, recessive grid, rounded data ends
// anchored to the baseline, hover / tap tooltip. Text always in text colours.
export function barChart({ points, tip, height = 150, highlight = -1 }) {
  const W = 640, H = height, padL = 36, padB = 20, padT = 6;
  const max = Math.max(...points.map((p) => p.value), 0);
  const top = niceMax(max);
  const n = points.length || 1;
  const slot = (W - padL) / n;
  const bw = Math.max(2, Math.min(22, slot * 0.62));
  const y = (v) => padT + (H - padT - padB) * (1 - v / (top || 1));
  const parts = [];

  for (const g of [0, 0.5, 1]) {
    const gy = y(top * g);
    parts.push(`<line class="grid" x1="${padL}" x2="${W}" y1="${gy}" y2="${gy}"/>`);
    parts.push(`<text class="axis" x="${padL - 6}" y="${gy + 3}" text-anchor="end">${g === 0 ? "0" : shortMoney(top * g)}</text>`);
  }
  const every = Math.ceil(n / 8);
  points.forEach((p, i) => {
    const cx = padL + slot * i + slot / 2;
    if (p.value > 0) {
      const by = y(p.value), bh = H - padB - by, r = Math.min(4, bw / 2, bh);
      parts.push(`<path class="bar-m" data-i="${i}" d="${roundTop(cx - bw / 2, by, bw, bh, r)}"/>`);
    }
    if (i % every === 0 || i === highlight) {
      parts.push(`<text class="axis" x="${cx}" y="${H - 5}" text-anchor="middle"${i === highlight ? ' style="fill:var(--fg)"' : ""}>${p.label}</text>`);
    }
    parts.push(`<rect class="hit" data-i="${i}" x="${padL + slot * i}" y="0" width="${slot}" height="${H}"/>`);
  });

  const box = h("div", { class: "chart" });
  box.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="график">${parts.join("")}</svg>`;
  const tipEl = h("div", { class: "tip", hidden: true });
  box.append(tipEl);

  const show = (i) => {
    const p = points[i]; if (!p) return hide();
    box.classList.add("hovering");
    box.querySelectorAll(".bar-m").forEach((b) => b.classList.toggle("on", +b.dataset.i === i));
    tipEl.innerHTML = "";
    tipEl.append(h("span", {}, p.full || p.label, " · "), h("b", {}, tip(p.value)));
    const rect = box.getBoundingClientRect();
    const scale = rect.width / W;
    const x = (padL + slot * i + slot / 2) * scale;
    tipEl.hidden = false;
    const half = tipEl.offsetWidth / 2;
    tipEl.style.left = Math.min(Math.max(x, half), rect.width - half) + "px";
    tipEl.style.top = y(p.value) * scale + "px";
  };
  const hide = () => { box.classList.remove("hovering"); tipEl.hidden = true; };
  box.addEventListener("pointermove", (e) => { const i = e.target.dataset && e.target.dataset.i; if (i != null) show(+i); });
  box.addEventListener("pointerdown", (e) => { const i = e.target.dataset && e.target.dataset.i; if (i != null) show(+i); });
  box.addEventListener("pointerleave", hide);
  return box;
}

function roundTop(x, y, w, hgt, r) {
  return `M${x},${y + hgt}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + hgt}Z`;
}
function niceMax(v) {
  if (v <= 0) return 0;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  for (const m of [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (m * p >= v) return m * p;
  return 10 * p;
}

// 100% composition strip; segments separated by 2px gaps, colour = the category's fixed slot.
export function stack(parts) {
  const total = parts.reduce((s, p) => s + p.value, 0) || 1;
  return h("div", { class: "stack", role: "img", "aria-label": "доли категорий" },
    parts.map((p) => h("i", { title: p.name, style: { flex: `${p.value / total} 1 0`, background: `var(--c${p.color})` } })));
}
