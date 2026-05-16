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
Siehe HTML-Wireframe auf der Modul-Seite. Anforderungen: Toolbar, Filter/Tabs, Tabellen/Forms, Next Action und Blocker gemäß Modul.

### detail
Siehe HTML-Wireframe auf der Modul-Seite. Anforderungen: Toolbar, Filter/Tabs, Tabellen/Forms, Next Action und Blocker gemäß Modul.

### line
Siehe HTML-Wireframe auf der Modul-Seite. Anforderungen: Toolbar, Filter/Tabs, Tabellen/Forms, Next Action und Blocker gemäß Modul.
