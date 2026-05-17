# Orders

Demand Work Queue: Shopify-Bestellungen verstehen, planen und in operative Arbeit überführen

## Entitäten
### OperationsOrder
- Attribute/Bedeutung: Order-Kopf aus Shopify oder manuell. Enthält order_name, Shopify IDs, Zahlungs-/Fulfillmentstatus, Kunde, E-Mail, Lieferadresse, Prozessstatus, Timestamps.
- Regel: Quelle der Nachfrage. Löscht nie Historie; Status wird aus Zeilen und Folgeobjekten abgeleitet.

### OperationsOrderLine
- Attribute/Bedeutung: Eine bestellte Position mit Shopify line item id, Item, SKU/Titel, Menge, Einheit, Supply-Status.
- Regel: Muss einzeln nachvollziehbar sein. Bei gleicher SKU in mehreren Orders darf Status nicht über Item-Level “überspringen”.

### Customer/Shipping Snapshot
- Attribute/Bedeutung: Order-eigene Kundendaten und Shipping Address, verschlüsselt gespeichert.
- Regel: Die Lieferadresse ist Bestandteil der Order. Ohne Adresse blockiert Logistics. Kein manueller Ersatz im echten Prozess.

### Demand Link
- Attribute/Bedeutung: source_order_line_id auf PurchaseNeed, ShippingOrderLine.operations_order_line_id.
- Regel: Verbindet Nachfragezeile mit Beschaffung, Wareneingang, Bestand und Versand.

## Prozess
- **1. Sync Shopify Orders:** Bestellungen mit Kundenname, E-Mail, Lieferadresse und Line Items importieren. Sync darf vorhandene gültige Adresse nicht durch Null aus Fallback-Query überschreiben.
- **2. Demand Decision:** Für jede Order Line: Ready from stock, Needs procurement, Needs production/kitting, Review master data, Already in progress.
- **3. Planning:** Refresh planning erzeugt Purchase Needs für Beschaffungsbedarf. Direkter Bezug: PurchaseNeed.source_order_line_id.
- **4. Status ableiten:** Order-Status wird aus Lines, Needs, POs, Receipts, Inventory, Shipment und Address Readiness abgeleitet. Kein pauschales “in progress”.
- **5. Next Action:** Eine klare nächste Aktion: Open Procurement, Open Receiving, Open Logistics, Open order.

## UI
### list
Die Orders-Liste ist eine schlanke Shopify-Demand-Übersicht, kein Status-Dashboard.

- Toolbar: genau ein primärer Button `Sync Shopify orders`.
- Filter: standardmäßig eingeklappt; bei aktiven Filtern geöffnet. Filter für Work queue, Order/Kunde/Produkt, Payment, Shopify fulfillment und fehlende Adresse.
- Work queue Default: `All orders`, damit auch lokal abgeschlossene Shopify Orders sichtbar bleiben. Weitere Filter: `Active work`, `Completed`. `Completed` zeigt lokal abgeschlossene Orders nach Shipment-/Completion-Zeit absteigend.
- Tabelle: Order, Order date, Customer, Products / quantities, Operations, Payment, Shopify fulfillment, Address, Next action.
- `Shopify fulfillment` ist der Shopify-Status und bleibt ohne Shopify Fulfillment Writeback z.B. `UNFULFILLED`.
- `Operations` ist der lokale Operations-Kit-Status und muss nach lokalem Shipment `Complete` zeigen.
- Lokal abgeschlossen wird als `Shipped locally` sichtbar gemacht; wenn Shopify weiterhin `UNFULFILLED` ist, zeigt die UI `Shopify not updated`.
- Nicht auf der Liste anzeigen: Operational-Status-Zusammenfassung, Next reason / blocker.
- Operative Status- und Reason-Details gehören auf Order Detail, Order Line Detail, Procurement, Receiving oder Logistics.

### detail
Order Detail ist die Demand-Situation-Seite.

- Toolbar: Back to Orders, Open in Shopify, Refresh planning.
- Sections/Tabs: Summary, Lines, Related work, Events later.
- Jedes Feld, jeder Button und jeder Link erscheint nur einmal.
- Summary zeigt Order, Order date, Customer, Email, Payment, Shopify fulfillment, Shipping address, Address readiness, Operations, Next action.
- Next reason darf als kurzer Text im Summary stehen, aber nicht als zweite separate Next-Action-Box dupliziert werden.
- Keine Ausführung von PO-Lifecycle, QC, Putaway oder Shipment-Pack/Ship auf Order Detail.

### line
Order Line Detail erklärt genau eine Nachfragezeile.

- Toolbar: Back to Order, Open Product, genau ein kontextueller Link zu Procurement oder Logistics.
- Sections: Line summary, Decision explanation, Inventory availability, Procurement/Receiving context, Logistics context, Next action.
- Keine operativen Mutationsbuttons auf der Line-Seite; sie erklärt und verlinkt nur.
