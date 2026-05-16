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
Siehe HTML-Wireframe auf der Modul-Seite. Anforderungen: Toolbar, Filter/Tabs, Tabellen/Forms, Next Action und Blocker gemäß Modul.

### detail
Siehe HTML-Wireframe auf der Modul-Seite. Anforderungen: Toolbar, Filter/Tabs, Tabellen/Forms, Next Action und Blocker gemäß Modul.
