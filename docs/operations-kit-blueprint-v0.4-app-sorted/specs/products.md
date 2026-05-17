# Products

Operational Master Data: Shopify-Produkte und Operations-Artikel klassifizieren

## Entitäten
### Item
- Attribute/Bedeutung: Produkt, Variante, Komponente oder Rohmaterial. Felder: SKU, Titel, Shopify IDs, item_type, sellable, purchasable, producible, active, unit, lead time, order qty, production qty, min stock, QC flags.
- Regel: Zentrales Stammdatenobjekt. Shopify-owned SKU/Titel read-only.

### SupplierItem
- Attribute/Bedeutung: Lieferantenbeziehung pro Item: supplier, supplier_sku, preferred, price, currency, MOQ, lead time, active.
- Regel: Beschaffung kann nur sauber laufen, wenn purchasable Items Lieferant und Terms haben.

### BOM/BOMLine
- Attribute/Bedeutung: Aktive Stückliste und Komponenten.
- Regel: Für producible/kitted Produkte. Keine Prozessausführung auf Product Detail.

### Shopify Sync State
- Attribute/Bedeutung: product_status, publishedAt/onlineStoreUrl, last_seen, missing/stale.
- Regel: On shop ist ein abgeleiteter Shopify-Visibility-Status aus active/status/publication/latest sync. Operational sellable ist eine getrennte Operations-Rolle und darf nicht als Ersatz für Shopify-Visibility verwendet werden.

## Prozess
- **1. Sync Products:** Shopify-Produkte/Varianten importieren, Status, Publication und Last Seen pflegen.
- **2. Klassifizieren:** Item type + Rollen: sellable/purchasable/producible.
- **3. Purchasing Settings:** Preferred Supplier, Supplier SKU, Preis, MOQ, Lead Time, Mindestbestand.
- **4. QC Policy:** QC required on receiving / after production. Ausführung liegt bei Receipt/Production, nicht beim Produkt.
- **5. BOM Readiness:** Producible Item braucht aktive BOM mit Komponenten.
- **6. Create operational component:** Neuanlage nicht verkaufbarer Komponenten/Rohmaterialien muss Rollen und QC-Flags explizit setzen können. Defaults dürfen helfen, aber nicht die sichtbare Entscheidung ersetzen.

## UI
### list
Siehe HTML-Wireframe auf der Modul-Seite. Anforderungen: Toolbar, Filter/Tabs, Tabellen/Forms, Next Action und Blocker gemäß Modul.

- Filter: SKU/title, Source/on shop, Shopify status, Role, Supplier.
- Tabelle: Product, Shopify status, Type, Roles, Supplier, Stock, BOM, Data quality, Next.
- Products on shop verwendet dieselbe abgeleitete Shopify-Visibility-Logik wie die Shop-Spalte.

### detail
Siehe HTML-Wireframe auf der Modul-Seite. Anforderungen: Toolbar, Filter/Tabs, Tabellen/Forms, Next Action und Blocker gemäß Modul.

- Product Detail zeigt BOM-Komponenten read-only inklusive verfügbarer Komponentenbestände.
- BOM und Product Detail enthalten keine MRP-/Produktionsausführung.

### create operational component
- Route: `/app/items/new`.
- Felder: SKU, title, item_type, sellable, purchasable, producible, QC required on receiving, QC required after production, minimum stock, standard order quantity, standard production quantity, lead time.
- Defaults: component/raw_material sind nicht sellable und typischerweise purchasable; assembly ist typischerweise producible. User kann Rollen/QC vor dem Speichern explizit ändern.
