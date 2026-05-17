# Procurement

Purchase Needs und Purchase Orders für Handelsware organisieren

## Entitäten
### PurchaseNeed
- Attribute/Bedeutung: Beschaffungsbedarf aus Order Line, Min Stock oder item-level Planung. Felder: item, quantity, source_order_line_id, supplier, status, expected date.
- Regel: MVP: direkte source_order_line_id wenn aus Kundenbedarf. Null nur bei aggregiertem Bedarf.

### PurchaseOrder
- Attribute/Bedeutung: Bestellung an Lieferanten. Header: supplier, status, dates, total, notes.
- Regel: Eigentümer des PO-Lifecycles bis Supplier acknowledged. Goods Receipt gehört zu Receiving.

### PurchaseOrderLine
- Attribute/Bedeutung: PO-Zeile: product, quantity, unit, unit price, line value, expected date, purchase_need_id.
- Regel: Menge folgt shortage quantity, außer explizite MOQ/Losgröße.

### Supplier/SupplierItem
- Attribute/Bedeutung: Lieferant + Einkaufskonditionen.
- Regel: Quelle für Preis, Währung, MOQ, Lead Time.

## Prozess
- **1. Need entsteht:** Refresh planning oder Order Line erzeugt PurchaseNeed. Direkter Kundenbedarf muss source_order_line_id haben. Die Procurement-Seite darf Purchase Needs beim Laden idempotent aktualisieren, muss dies aber sichtbar melden.
- **2. Supplier assignment:** Preferred supplier automatisch, sonst Need supplier Blocker.
- **3. Create PO:** Need wird in PO-Line umgewandelt. PO quantity = shortage bei order qty/MOQ 1.
- **4. PO lifecycle:** PO created → Approve → Sent to supplier → Supplier acknowledged. Diese Mutationen gehören auf Purchase Order Detail, nicht in die Procurement-Overview.
- **5. Übergabe Receiving:** Supplier-acknowledged POs zeigen als nächsten Prozessschritt `Create Goods Receipt`. Die Aktion darf direkt auf Purchase Order Detail sichtbar sein und muss danach auf Receipt Detail navigieren. Receiving Overview zeigt dieselbe Aktion als Work-Queue-Einstieg. QC und Putaway gehören zu Receipt Detail.
- **6. Nachbearbeitung:** Eine PO muss vor Receiving nachbearbeitbar sein. `Edit` setzt approved/sent/acknowledged zurück auf `PO created`, solange noch kein Goods Receipt gestartet wurde. Danach dürfen Menge, Unit Price, Währung und erwartetes Lieferdatum korrigiert werden; anschließend wird erneut approved.

## UI
### list
Procurement Overview ist eine Work Queue. Die Startansicht zeigt immer alle nicht abgeschlossenen Procurement-Vorgänge, unabhängig davon, ob der Vorgang gerade Purchase Need, Purchase Order oder Receipt/Putaway ist.

- Toolbar: `Refresh purchasing needs`.
- Scope-Selector `Work queue`: `Active work`, alle relevanten Prozessstatus, `Purchase Needs`, `Purchase Orders`, `Receipts`, `Completed`.
- Der Scope-Selector ersetzt Reiter und separaten Statusfilter.
- Filter sind standardmäßig eingeklappt: Supplier, Product/Reference search, Source order, Expected before.
- Prozesshilfe ist standardmäßig eingeklappt im Header und darf nicht den Datenfokus verdrängen.
- `Active work` ist Default und zeigt alle not-completed Vorgänge in einer Tabelle.
- `Purchase Needs`, `Purchase Orders` und `Receipts` sind Filter auf die aktive Work Queue, keine getrennten Arbeitswelten.
- Purchase Needs besitzt Supplier assignment und `Create Purchase Order`.
- Purchase Orders verlinkt zu Purchase Order Detail. Keine Approve/Send/Acknowledge-Mutationen in der Overview.
- Receipts verlinkt zu Receipt Detail für QC/Putaway.
- Completed zeigt abgeschlossene oder abgebrochene Procurement-Vorgänge. Procurement gilt als abgeschlossen, wenn die Ware eingegangen und eingelagert oder anderweitig versandt/erledigt ist.

### po
Purchase Order Detail besitzt den PO-Lifecycle.

- Toolbar: Back to Procurement, Approve, Sent to supplier, Mark supplier acknowledged, Create Goods Receipt, Edit, Cancel PO.
- Sections/Tabs: Header, Lines, Receipts, Events later.
- Lines zeigen Product, Qty, Unit, Unit price, Line value, Expected, Status.
- Receipts zeigen Receipt, Status, Received date, QC, Putaway, Open Receipt.
- Blockierte POs ohne gültige Preise dürfen nicht approved oder sent werden.
- `Edit` gibt eine PO vor Receiving zur Bearbeitung frei und setzt sie zurück auf `PO created`; danach dürfen Menge, Unit Price, Währung und erwartetes Lieferdatum der PO-Zeilen bearbeitet werden.
- Nach `Supplier acknowledged` ist `Create Goods Receipt` der direkte nächste Prozessschritt auf Purchase Order Detail. Wenn bereits ein Receipt existiert, zeigt Purchase Order Detail stattdessen `Open Goods Receipt`.
