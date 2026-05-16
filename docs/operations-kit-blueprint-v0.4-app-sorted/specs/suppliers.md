# Suppliers

Lieferanten und Einkaufskonditionen pflegen

## Entitäten
### Supplier
- Attribute/Bedeutung: Name, E-Mail, Status, Default Currency, Notes, Active.
- Regel: Lieferantenkopf. Keine operative PO-Erstellung aus Supplier Detail.

### SupplierItem
- Attribute/Bedeutung: Produktbezug mit supplier SKU, preferred, price, MOQ, lead time, active.
- Regel: Wichtig für automatische Purchase Need → PO Erstellung.

### Purchase Orders context
- Attribute/Bedeutung: POs zum Lieferanten.
- Regel: Read-only im Supplier Detail; Lifecycle bleibt PO Detail.

## Prozess
- **1. Supplier anlegen:** Für purchasable Produkte Voraussetzung.
- **2. Supplied products pflegen:** Preis, MOQ, Lead Time und bevorzugten Lieferanten setzen.
- **3. Procurement nutzt Terms:** Purchase Need übernimmt SupplierItem-Daten.
- **4. Inaktiv setzen:** Inactive Supplier nicht für neue Needs anbieten, Historie erhalten.

## UI
### list
Siehe HTML-Wireframe auf der Modul-Seite. Anforderungen: Toolbar, Filter/Tabs, Tabellen/Forms, Next Action und Blocker gemäß Modul.

### detail
Siehe HTML-Wireframe auf der Modul-Seite. Anforderungen: Toolbar, Filter/Tabs, Tabellen/Forms, Next Action und Blocker gemäß Modul.
