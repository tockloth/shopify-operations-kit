# Inventory

Stock Position, Ledger, Reservations und Incoming Supply

## Entitäten
### InventoryMovement
- Attribute/Bedeutung: Append-only Bewegungsledger mit item, location, quantity_delta, reserved_delta, source_type/source_id.
- Regel: Bestand wird aus Bewegungen abgeleitet. Keine stille Korrektur.

### Stock position
- Attribute/Bedeutung: On hand, reserved, available, QC hold je Item/Location.
- Regel: Read Model, keine eigene Wahrheit.

### Reservation
- Attribute/Bedeutung: Order-/Shipment-Bezug für reservierte Ware.
- Regel: MVP teilweise, später dedizierter order-line allocation model.

### Incoming supply
- Attribute/Bedeutung: Offene POs/Goods Receipts.
- Regel: Zeigt Zulauf für Beschaffungsentscheidung.

## Prozess
- **1. Bestand entsteht:** Durch Putaway aus Receipt oder später Produktion/Kitting.
- **2. Reservieren:** Für Versand/Shipment; darf andere Orders nicht fälschlich ready machen.
- **3. Ledger prüfen:** Jede Bestandsänderung hat Quelle und Zeitpunkt.
- **4. Adjustment später:** Manuelle Korrekturen nur explizit und mit Audit/Permission.

## UI
### list
Inventory Overview zeigt nur die aktuelle Bestandsposition.

- Seitentitel: `Inventory`.
- Kein erklärender Kopfblock.
- Haupttabelle: Item, Location, On hand, Available, QC hold, Last movement.
- Item-Zeilen öffnen Inventory Item Detail.
- Toolbar/Button: `Open movements` führt zur separaten Movements-Seite.
- Movements/Ledger werden nicht auf der Inventory-Startseite gemischt.

### movements
Inventory Movements ist eine eigene Seite.

- Route: `/app/inventory/movements`.
- Toolbar/Button: `Back to Inventory`.
- Tabelle: Item, Quantity, Movement, Location, Source, Booked date.
- Item-Zeilen öffnen Inventory Item Detail.

### detail
Inventory Item Detail zeigt Stock Position, Ledger Movements, Reservations und Procurement Supply für ein Item.

- Toolbar: Back to Inventory, Open Product später, Export ledger später.
- Stock/Bestand bleibt erste Sektion: On hand, reserved from open orders, available, incoming purchase, planned.
- Danach folgt `Inventory work`: offene Goods Receipt Lines für dieses Item mit QC/Putaway-Status.
- Wenn QC offen ist, darf Inventory Item Detail `Complete QC` als direkte Aktion anbieten.
- Wenn Accepted Quantity zur Einlagerung bereit ist, darf Inventory Item Detail `Put away to inventory` als direkte Aktion anbieten.
- Offene Orders/Reservations sind als einblendbarer Kontext sichtbar.
- Incoming purchase orders sind als einblendbarer Kontext sichtbar.
- Ledger Movements sind einblendbar; sie erklären Bestandsbuchungen für genau dieses Item.
