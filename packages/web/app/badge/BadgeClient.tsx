"use client";
import { MergeToolClient, type MergeToolConfig } from "@/components/MergeToolClient";
import { badgeSpec, BADGE_LAYOUTS } from "@event-editor/core/badge";

const config: MergeToolConfig = {
  toolId: "badge",
  sizePresets: [
    { id: "badge-4x3", label: "4 x 3 in", width: 288, height: 216 },
    { id: "a6-landscape", label: "A6 landscape", width: 419.53, height: 297.64 },
  ],
  layouts: BADGE_LAYOUTS,
  copyFields: [
    { key: "eventTitle", label: "Event title", default: "" },
    { key: "orgField", label: "Organisation column", default: "Org" },
  ],
  toggles: [{ key: "qr", label: "Include a QR code of each name", default: false }],
  recipientLabel: "Name column",
  recipientDefault: "Name",
  sheet: true,
  fileBase: "badges",
  buildSpec: ({ layout, text, toggles, recipientField }) =>
    badgeSpec({
      layout: layout as "centered" | "leftQr",
      nameField: recipientField,
      orgField: text.orgField || "Org",
      eventTitle: text.eventTitle || "",
      qr: !!toggles.qr,
    }),
};

export function BadgeClient() {
  return <MergeToolClient {...config} />;
}
