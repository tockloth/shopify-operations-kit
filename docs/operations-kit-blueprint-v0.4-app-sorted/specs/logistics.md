# Logistics

Versandbereitschaft, Shipment Work und lokale Shipment-Lifecycle

## Entitäten
### ShippingOrder
- Attribute/Bedeutung: Shipment-Kopf: shipment_number, operations_order_id, status, created/packed/shipped timestamps, shipping address snapshot.
- Regel: Single record für Versandarbeit.

### ShippingOrderLine
- Attribute/Bedeutung: Shipment-Zeile mit operations_order_line_id, item, quantity, picked/packed/shipped status.
- Regel: Direkter Link zur Nachfragezeile.

### Address readiness
- Attribute/Bedeutung: Order shipping address + customer name/email müssen vorhanden und nutzbar sein.
- Regel: Ohne Adresse kein Shipment.

### Inventory readiness
- Attribute/Bedeutung: Bestand muss für Order Line verfügbar/reserviert sein.
- Regel: Procurement/Receiving müssen vorher abgeschlossen sein.

## Prozess
- **1. Ready/Blocked:** Orders mit Bestand + Adresse sind ready, sonst blocked mit genauem Grund.
- **2. Create Shipment:** Erzeugt lokalen Shipment Record und Linien. Kein Shopify Fulfillment Writeback im MVP.
- **3. Pack/Ship später:** Mark packed / Mark shipped lokal. Packing optional via Settings.
- **4. Completed:** Shipment work complete; Shopify fulfillment writeback später explizit.

## UI
### list
Siehe HTML-Wireframe auf der Modul-Seite. Anforderungen: Toolbar, Filter/Tabs, Tabellen/Forms, Next Action und Blocker gemäß Modul.

### detail
Siehe HTML-Wireframe auf der Modul-Seite. Anforderungen: Toolbar, Filter/Tabs, Tabellen/Forms, Next Action und Blocker gemäß Modul.
