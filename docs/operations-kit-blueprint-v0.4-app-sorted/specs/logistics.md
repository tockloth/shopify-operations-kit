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
- **2. Create Shipment:** Erzeugt lokalen Shipment Record und Linien.
- **3. Pack/Ship:** Mark packed / Mark shipped. Packing ist optional via Settings; wenn direkt shipped wird, darf keine künstliche Reservierung entstehen.
- **4. Shopify Fulfillment:** Beim Markieren als shipped erzeugt Operations Kit für Shopify Orders ein Shopify Fulfillment über Fulfillment Orders / `fulfillmentCreate`.
- **5. Completed:** Shipment work ist erst abgeschlossen, wenn lokale Shipment-Buchung und Shopify-Fulfillment-Writeback erfolgreich sind. Für manuelle Orders ohne Shopify Order ID wird nur lokal abgeschlossen.

## UI
### list
Logistics Overview ist eine Work Queue.

- Kein erklärender Kopfblock.
- Scope-Selector `Work queue`: `Active work`, `Ready`, `Blocked`, `Shipments`, `Completed`.
- Der Scope-Selector ersetzt Reiter.
- Filter sind standardmäßig eingeklappt: Order/Customer/Product search, Address state.
- Development-only Backfill ist eingeklappt unter `Development tools`.
- Tabelle: Reference, Status, Customer, Products / quantities, Address, Reason, Next action.
- Tabellen-Navigation: Shipment-Zeilen öffnen Shipment Detail. Ready Orders haben keinen Row-Click; der Hauptweg ist `Create shipment`. Blocked Orders öffnen Order Detail, weil dort der Blocker korrigiert wird.
- Ready Order zeigt `Create shipment` direkt als Hauptaktion.
- Blocked Order zeigt den genauen Blocker und verlinkt zur Order.
- Shipment-Zeilen öffnen Shipment Detail.
- `Mark packed` und `Mark shipped` gehören nicht auf die Overview, sondern auf Shipment Detail.

### detail
Shipment Detail besitzt den lokalen Shipment-Lifecycle.

- Route: `/app/logistics/:shipmentId`.
- Toolbar: Back to Logistics, Mark packed, Mark shipped. Wenn lokal bereits shipped, Shopify aber noch nicht `FULFILLED` ist: Update Shopify fulfillment.
- Sections: Shipment summary, Lines, Address.
- Lines: Product, Quantity, Picked, Packed, Shipped, Status.
- Offene Shipment-Zeilen dürfen vor Pack/Ship korrigiert werden: Quantity ändern, danach erneut Mark packed oder Mark shipped.
- Nach Pack/Ship sind Zeilen gesperrt; Korrektur erfolgt dann später über definierte Ausnahmeprozesse.
- Address zeigt den gespeicherten Versandadress-Snapshot aus der Order.
- `Mark shipped` führt bei Shopify Orders zuerst das Shopify Fulfillment Writeback aus und markiert danach lokal als shipped.
- Wenn Shopify Fulfillment fehlschlägt, bleibt der lokale Shipment-Status unverändert und die UI zeigt den Shopify-Fehler.
- `Update Shopify fulfillment` ist eine Nachholaktion für historische/lokal bereits abgeschlossene Shipments. Sie darf keine lokale Shipment- oder Inventory-Buchung wiederholen.
