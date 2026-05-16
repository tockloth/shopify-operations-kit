# Customers

Kunden-/Adresskontext, Datenschutz und Order-Bezug

## Entitäten
### OperationCustomer
- Attribute/Bedeutung: Synchronisierter Shopify-Kunde: display name, email, phone optional, Shopify id, privacy/redaction status, amount spent/order count.
- Regel: Personendaten verschlüsselt; nie Raw Ciphertext anzeigen.

### Order shipping address
- Attribute/Bedeutung: Die echte Versandadresse gehört primär zur Order.
- Regel: Customer Detail zeigt Adressbereitschaft über Orders; kein Shopify Writeback.

### Privacy / Redaction
- Attribute/Bedeutung: Redaction löscht/verschleiert personenbezogene Daten nach Shopify Anforderungen.
- Regel: Detail darf nicht crashen, wenn Daten fehlen oder redacted sind.

## Prozess
- **1. Sync Customers:** Kundenstammdaten importieren. Für Versand ist Order Sync mit Shipping Address entscheidend.
- **2. Inspect readiness:** Kunden-Detail zeigt Orders und ob Order-Shipping vorhanden ist.
- **3. Redaction:** Datenschutzaktion später/wo erlaubt.
- **4. Test address:** Nur Development-Hilfe, nie echte Akzeptanzbedingung.

## UI
### list
Siehe HTML-Wireframe auf der Modul-Seite. Anforderungen: Toolbar, Filter/Tabs, Tabellen/Forms, Next Action und Blocker gemäß Modul.

### detail
Siehe HTML-Wireframe auf der Modul-Seite. Anforderungen: Toolbar, Filter/Tabs, Tabellen/Forms, Next Action und Blocker gemäß Modul.
