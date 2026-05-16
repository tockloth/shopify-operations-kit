# Settings

Workflow-Schalter, Datenschutz, Rollen später und Testdaten

## Entitäten
### WorkflowSettings
- Attribute/Bedeutung: PO approval, supplier acknowledgement, receiving required, QC policy, putaway mode, shipping strictness, packing required, payables visibility, kitting approval.
- Regel: Muss Buttons/Status sichtbar beeinflussen.

### Roles later
- Attribute/Bedeutung: Owner/Admin, Procurement, Receiving, Warehouse, Shipping, Finance.
- Regel: Später, aber UI darf Rollenfähigkeit vorbereiten.

### Test data actions
- Attribute/Bedeutung: Lokale Seed/Backfill-Aktionen, nur Development.
- Regel: Nicht als fachliche Lösung verwenden.

## Prozess
- **PO approval required:** Default off für Owner Shops. Wenn on: Approve vor Send.
- **Supplier acknowledgement required:** Default off/optional. Wenn on: Goods Receipt erst nach acknowledged.
- **QC policy:** by product / always / never.
- **Putaway mode:** manual default; automatic später.
- **Shipping address strictness:** strict default; ohne Adresse kein Shipment.

## UI
### detail
Siehe HTML-Wireframe auf der Modul-Seite. Anforderungen: Toolbar, Filter/Tabs, Tabellen/Forms, Next Action und Blocker gemäß Modul.
