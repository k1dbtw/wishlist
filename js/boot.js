// applied before first paint so the saved theme never flashes
try {
  var l = JSON.parse(localStorage.getItem("stash.look") || "{}");
  if (l.theme && l.theme !== "auto") document.documentElement.dataset.theme = l.theme;
  if (l.accent) document.documentElement.style.setProperty("--accent", l.accent);
} catch (e) {}
