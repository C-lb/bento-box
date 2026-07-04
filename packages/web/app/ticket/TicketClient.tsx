"use client";
import { MergeToolClient, type MergeToolConfig } from "@/components/MergeToolClient";
import { ticketSpec, TICKET_LAYOUTS } from "@event-editor/core/ticket";

const config: MergeToolConfig = {
  layouts: TICKET_LAYOUTS,
  copyFields: [
    { key: "eventTitle", label: "Event title", default: "" },
    { key: "codeField", label: "QR code column (defaults to name)", default: "" },
  ],
  toggles: [{ key: "qr", label: "Include a QR code", default: true }],
  recipientLabel: "Name column",
  recipientDefault: "Name",
  sheet: true,
  fileBase: "tickets",
  buildSpec: ({ layout, text, toggles, recipientField }) =>
    ticketSpec({
      layout: layout as "classic" | "minimal",
      eventTitle: text.eventTitle || "",
      nameField: recipientField,
      codeField: text.codeField || "",
      qr: !!toggles.qr,
    }),
};

export function TicketClient() {
  return <MergeToolClient {...config} />;
}
