# Payments

Zahlungsvorschläge und Buchungsexport für abgeschlossene Beschaffung

## Entitäten
### PurchasePayment
- Attribute/Bedeutung: Zahlungsvorschlag zu PurchaseOrder. Felder: supplier, purchase order, amount, currency, due date, status, exported_at.
- Regel: Entsteht nach vollständigem Putaway einer Purchase Order. Export ist separater Prozessschritt.

## Prozess
- **1. Zahlungsvorschlag entsteht:** Wenn Waren vollständig eingelagert sind, darf ein offener Payment-Eintrag entstehen.
- **2. Auswahl:** Nicht exportierte Einträge können einzeln oder gesammelt markiert werden.
- **3. Export:** `Export selected` markiert die ausgewählten Einträge mit Exportzeitpunkt.
- **4. Danach:** Exportierte Einträge bleiben sichtbar mit `Last exported`.

## UI
### list
Payments Overview ist eine Export-Work-Queue.

- Seitentitel: `Payments`.
- Toolbar: `Mark all not exported`, `Clear selection`, `Export selected`.
- Tabelle: Select, Payment, Supplier, Purchase Order, Status, Amount, Due date, Last exported.
- Jede nicht exportierte Zeile hat eine Checkbox.
- Exportierte Zeilen zeigen keine Checkbox und zeigen `Last exported`.
- Kein Payment-Block in Procurement oder Receiving.
