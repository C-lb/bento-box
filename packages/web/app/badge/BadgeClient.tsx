"use client";
import { MergeToolClient, type MergeToolConfig } from "@/components/MergeToolClient";
import { badgeSpec, BADGE_LAYOUTS } from "@event-editor/core/badge";

const config: MergeToolConfig = {
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
