# Receiving

Goods Receipt, QC und Putaway / Einlagerung

## Entitäten
### GoodsReceipt
- Attribute/Bedeutung: Wareneingangskopf zu PurchaseOrder. Felder: PO, supplier, status, received date.
- Regel: Startet nach PO sent/acknowledged je nach Setting.

### GoodsReceiptLine
- Attribute/Bedeutung: Wareneingangszeile: item, received qty, accepted qty, rejected qty, QC status, putaway status, purchase_order_line_id.
- Regel: Überträgt bestellte Ware in QC-HOLD oder MAIN.

### InventoryMovement
- Attribute/Bedeutung: Buchungen: qc_hold, putaway, rejection/quarantine später.
- Regel: Putaway bedeutet: akzeptierte Ware wird in Bestand MAIN gebucht.

## Prozess
- **1. Create Goods Receipt:** Von PO Detail, wenn PO Status/Settings es erlauben.
- **2. Receive:** Menge wird als received erfasst. Bei QC-Policy zunächst QC hold.
- **3. Complete QC:** Accepted/Rejected Quantity + Notes. Accepted darf nicht größer als received sein.
- **4. Put away to inventory:** Accepted goods werden nach MAIN gebucht. Idempotent: keine Doppelbuchung.
- **5. Danach:** Order kann ready for logistics werden, wenn Adresse und Bestand vorhanden sind.

## UI
### list
Siehe HTML-Wireframe auf der Modul-Seite. Anforderungen: Toolbar, Filter/Tabs, Tabellen/Forms, Next Action und Blocker gemäß Modul.

### detail
Siehe HTML-Wireframe auf der Modul-Seite. Anforderungen: Toolbar, Filter/Tabs, Tabellen/Forms, Next Action und Blocker gemäß Modul.
