import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { buildMenuTemplate, NAV_ITEMS } = require("../lib/menu.js");

function flatten(template) {
  const out = [];
  const walk = (items) => {
    for (const it of items) {
      out.push(it);
      if (Array.isArray(it.submenu)) walk(it.submenu);
    }
  };
  walk(template);
  return out;
}

function build(isMac) {
  const calls = { nav: [], back: 0, forward: 0 };
  const template = buildMenuTemplate({
    isMac,
    appName: "Bento Box",
    nav: (p) => calls.nav.push(p),
    back: () => calls.back++,
    forward: () => calls.forward++,
  });
  return { template, calls, items: flatten(template) };
}

test("nav shortcuts are bound and route to the right paths", () => {
  for (const isMac of [true, false]) {
    const { calls, items } = build(isMac);
    for (const nav of NAV_ITEMS) {
      const bound = items.filter((i) => i.accelerator === nav.accelerator && i.click);
      assert.equal(bound.length, 1, `${nav.accelerator} bound exactly once (isMac=${isMac})`);
      bound[0].click();
      assert.equal(calls.nav.at(-1), nav.path);
    }
  }
});

test("mac puts Settings in the app menu, windows in Go", () => {
  const mac = build(true);
  assert.equal(mac.template[0].label, "Bento Box");
  assert.ok(mac.template[0].submenu.some((i) => i.accelerator === "CmdOrCtrl+,"));
  const win = build(false);
  const go = win.template.find((t) => t.label === "Go");
  assert.ok(go.submenu.some((i) => i.accelerator === "CmdOrCtrl+,"));
});

test("back/forward accelerators wired", () => {
  const { calls, items } = build(true);
  items.find((i) => i.accelerator === "CmdOrCtrl+[").click();
  items.find((i) => i.accelerator === "CmdOrCtrl+]").click();
  assert.equal(calls.back, 1);
  assert.equal(calls.forward, 1);
});

test("view menu keeps the standard zoom/reload roles", () => {
  const { items } = build(false);
  const roles = new Set(items.map((i) => i.role).filter(Boolean));
  for (const r of ["reload", "resetZoom", "zoomIn", "zoomOut", "togglefullscreen"]) {
    assert.ok(roles.has(r), `missing role ${r}`);
  }
});
