# Procurement

Purchase Needs und Purchase Orders für Handelsware organisieren

## Entitäten
### PurchaseNeed
- Attribute/Bedeutung: Beschaffungsbedarf aus Order Line, Min Stock oder item-level Planung. Felder: item, quantity, source_order_line_id, supplier, status, expected date.
- Regel: MVP: direkte source_order_line_id wenn aus Kundenbedarf. Null nur bei aggregiertem Bedarf.

### PurchaseOrder
- Attribute/Bedeutung: Bestellung an Lieferanten. Header: supplier, status, dates, total, notes.
- Regel: Eigentümer des PO-Lifecycles bis Goods Receipt.

### PurchaseOrderLine
- Attribute/Bedeutung: PO-Zeile: product, quantity, unit, unit price, line value, expected date, purchase_need_id.
- Regel: Menge folgt shortage quantity, außer explizite MOQ/Losgröße.

### Supplier/SupplierItem
- Attribute/Bedeutung: Lieferant + Einkaufskonditionen.
- Regel: Quelle für Preis, Währung, MOQ, Lead Time.

## Prozess
- **1. Need entsteht:** Refresh planning oder Order Line erzeugt PurchaseNeed. Direkter Kundenbedarf muss source_order_line_id haben.
- **2. Supplier assignment:** Preferred supplier automatisch, sonst Need supplier Blocker.
- **3. Create PO:** Need wird in PO-Line umgewandelt. PO quantity = shortage bei order qty/MOQ 1.
- **4. PO lifecycle:** Draft → Approve optional → Send to supplier → Supplier acknowledged optional → Create Goods Receipt.
- **5. Übergabe Receiving:** Wareneingang/QC/Putaway gehören nicht in die Procurement-Queue, sondern auf Receipt Detail.

## UI
### list
Siehe HTML-Wireframe auf der Modul-Seite. Anforderungen: Toolbar, Filter/Tabs, Tabellen/Forms, Next Action und Blocker gemäß Modul.

### po
Siehe HTML-Wireframe auf der Modul-Seite. Anforderungen: Toolbar, Filter/Tabs, Tabellen/Forms, Next Action und Blocker gemäß Modul.
