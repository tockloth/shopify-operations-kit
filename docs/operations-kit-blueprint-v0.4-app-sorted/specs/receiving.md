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
- **1. Create Goods Receipt:** Auf Receiving Overview für supplier-acknowledged Purchase Orders und als direkter nächster Schritt auf Purchase Order Detail. Die Aktion öffnet danach Receipt Detail.
- **2. Receive:** Menge wird als received erfasst. Bei QC-Policy zunächst QC hold.
- **3. Complete QC:** Accepted/Rejected Quantity + Notes. Accepted darf nicht größer als received sein.
- **4. Put away to inventory:** Accepted goods werden nach MAIN gebucht. Idempotent: keine Doppelbuchung.
- **5. Danach:** Order kann ready for logistics werden, wenn Adresse und Bestand vorhanden sind.

## UI
### list
Receiving Overview ist eine Work Queue. Die Startansicht zeigt alle nicht abgeschlossenen Receiving-Vorgänge: Purchase Orders, die auf Goods Receipt warten, sowie Goods Receipts in QC oder Putaway.

- Keine Erklärungskarte im Kopfbereich.
- Prozesshilfe `Receiving process` ist standardmäßig eingeklappt.
- Scope-Selector `Work queue`: `Active work`, `Awaiting receipt`, `Receiving / QC`, `Putaway pending`, `Completed`.
- Der Scope-Selector ersetzt Reiter.
- Filter sind standardmäßig eingeklappt: Receipt/PO/Product search, Supplier, Expected/received before.
- `Post receipt` als Sammelbutton gehört nicht auf die Receiving-Startseite.
- `Create Goods Receipt` ist als Zeilenaktion auf Receiving Overview und als nächster Prozessschritt auf Purchase Order Detail erlaubt. Beide Wege öffnen danach Receipt Detail.
- Receiving Overview öffnet danach Receipt Detail; QC und Putaway bleiben auf Receipt Detail.
- Jede Zeile muss einen auswählbaren Datensatz haben: PO-Referenz öffnet Purchase Order Detail, Receipt-Referenz öffnet Receipt Detail.
- Wichtige Blocker wie fehlender Unit Price müssen bereits in der Receiving-Übersicht sichtbar sein. Wenn Preis fehlt, ist die nächste Aktion `Open Purchase Order` zur Korrektur, nicht Goods Receipt.

### detail
Receipt Detail besitzt QC und Putaway.

- Toolbar: Back to Receiving, Back to Procurement, Back to Purchase Order.
- Sections/Tabs: Header, Lines / QC, Putaway, Inventory outcome, Events later.
- QC-Form: Accepted quantity, Rejected quantity, Notes, Complete QC.
- Putaway-Form: Accepted quantity, Target location, Put away to inventory.
- Putaway bedeutet: akzeptierte Ware wird in Bestand MAIN gebucht.
