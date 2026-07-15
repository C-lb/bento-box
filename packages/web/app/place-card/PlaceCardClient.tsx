"use client";
import { MergeToolClient, type MergeToolConfig } from "@/components/MergeToolClient";
import { placecardSpec, PLACECARD_LAYOUTS } from "@event-editor/core/placecard";

const config: MergeToolConfig = {
  toolId: "place-card",
  sizePresets: [
    { id: "placecard-standard", label: "Standard", width: 288, height: 180 },
  ],
  layouts: PLACECARD_LAYOUTS,
  copyFields: [{ key: "tableField", label: "Table column", default: "Table" }],
  recipientLabel: "Name column",
  recipientDefault: "Name",
  sheet: true,
  fileBase: "place-cards",
  historyNoun: "place cards",
  buildSpec: ({ layout, text, recipientField }) =>
    placecardSpec({
      layout: layout as "classic" | "withTable",
      nameField: recipientField,
      tableField: text.tableField || "Table",
    }),
};

export function PlaceCardClient() {
  return <MergeToolClient {...config} />;
}
