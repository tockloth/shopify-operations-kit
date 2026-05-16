# BOM / Kitting

Stücklisten, Komponenten und spätere Kit-Builds

## Entitäten
### BOM
- Attribute/Bedeutung: Aktive Stückliste pro producible/kitted Product.
- Regel: MVP: eine aktive BOM pro Produkt. Varianten später.

### BOMLine
- Attribute/Bedeutung: Component, type, policy, quantity, unit, available stock.
- Regel: Komponente kann selbst purchasable und lagerfähig sein.

### Kit build later
- Attribute/Bedeutung: Build-Auftrag, component consumption, finished item stock.
- Regel: Später; nicht Teil Trading Goods MVP.

## Prozess
- **1. BOM anlegen:** Für producible/kitted Product.
- **2. Komponenten hinzufügen:** Component + Quantity + Unit.
- **3. Availability prüfen:** Komponentenbedarf vs Bestand/Zulauf.
- **4. Kitting später:** Consume components → create finished item stock.

## UI
### detail
Siehe HTML-Wireframe auf der Modul-Seite. Anforderungen: Toolbar, Filter/Tabs, Tabellen/Forms, Next Action und Blocker gemäß Modul.
