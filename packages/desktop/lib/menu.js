// packages/desktop/lib/menu.js
// Application menu + keyboard shortcuts for the desktop shell. The template is
// built by a pure function (no electron require) so tests can assert the
// bindings without a display; main.js feeds it to Menu.buildFromTemplate.
const NAV_ITEMS = [
  { label: "Tools", path: "/", accelerator: "CmdOrCtrl+1" },
  { label: "Workflow", path: "/workflow", accelerator: "CmdOrCtrl+2" },
  { label: "Settings", path: "/settings", accelerator: "CmdOrCtrl+," },
];

function buildMenuTemplate({ isMac, appName, nav, back, forward }) {
  // On mac, Settings lives in the app menu (platform convention); everywhere
  // else it goes under Go. Never both, or the accelerator would be bound twice.
  const goItems = NAV_ITEMS.filter((i) => !(isMac && i.path === "/settings")).map((i) => ({
    label: i.label,
    accelerator: i.accelerator,
    click: () => nav(i.path),
  }));
  return [
    ...(isMac
      ? [
          {
            label: appName,
            submenu: [
              { role: "about" },
              { type: "separator" },
              { label: "Settings…", accelerator: "CmdOrCtrl+,", click: () => nav("/settings") },
              { type: "separator" },
              { role: "hide" },
              { role: "hideOthers" },
              { role: "unhide" },
              { type: "separator" },
              { role: "quit" },
            ],
          },
        ]
      : []),
    { label: "File", submenu: [isMac ? { role: "close" } : { role: "quit" }] },
    { role: "editMenu" },
    {
      label: "View",
      submenu: [
        { role: "reload" },
        { role: "forceReload" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
        { role: "toggleDevTools" },
      ],
    },
    {
      label: "Go",
      submenu: [
        ...goItems,
        { type: "separator" },
        { label: "Back", accelerator: "CmdOrCtrl+[", click: () => back() },
        { label: "Forward", accelerator: "CmdOrCtrl+]", click: () => forward() },
      ],
    },
    { role: "windowMenu" },
  ];
}

module.exports = { buildMenuTemplate, NAV_ITEMS };
