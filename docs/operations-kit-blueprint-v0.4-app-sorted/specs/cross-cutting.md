# Querschnitt

- Tabellenfilter wie Excel
- Next Action mit Grund
- Page Ownership
- Blocker sichtbar
- Events/Audit später
- Dev-Testhilfe ist keine Fachlösung
- Listen zeigen nur die für die Arbeit im jeweiligen Bereich nötigen Spalten. Dashboard-artige Statussummaries und ausführliche Reasons gehören nicht auf jede Liste, sondern nur auf Dashboard oder Detailseiten, wenn sie dort die Entscheidung erklären.
- Detailseiten dürfen Felder, Links und Buttons nicht duplizieren. Jede fachliche Information erscheint genau einmal pro Seite.
- Startseiten von Funktionsbereichen zeigen standardmäßig alle nicht abgeschlossenen Vorgänge des Bereichs. Typ-/Status-Reiter sind Filter auf dieselbe Work Queue; `Completed` ist eine eigene Sicht für abgeschlossene Vorgänge und wird nach dem letzten Abschluss-/Shipment-Zeitpunkt absteigend sortiert.
- Fokus liegt auf den Daten. Hauptaktionen bleiben sichtbar; Filter, Prozesshilfen und andere Hilfsmittel sind standardmäßig einblendbar/eingeklappt.
- Funktionsbereich-Startseiten verwenden keine Reiter als primäre Navigation, wenn ein Scope-/Status-Selektor dieselbe Arbeit klarer und kompakter abbildet.
- Payment/Payables ist ein später eigener Funktionsbereich. Procurement und Receiving zeigen keine Payment-Blöcke. Später erzeugt der Payment-Bereich exportierbare Zahlungsvorschläge/Buchungssätze; exportierte Datensätze werden als `exported_for_payment` oder äquivalent markiert.
- Shopify Fulfillment ist nicht identisch mit lokalem Operations-/Shipment-Status. Ohne Shopify Fulfillment Writeback bleibt Shopify z.B. `UNFULFILLED`; Operations Kit zeigt parallel `Shipped locally` / `Complete`.
