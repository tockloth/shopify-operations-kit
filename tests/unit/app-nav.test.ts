import { describe, expect, it } from "vitest";

import { appNavItems, isActiveNav } from "../../app/lib/app-nav";

function activeLabel(pathname: string) {
  return appNavItems.find((item) => isActiveNav(pathname, item))?.label;
}

describe("app nav active state", () => {
  it("activates nested app sections", () => {
    expect(activeLabel("/app/customers")).toBe("Customers");
    expect(activeLabel("/app/customers/customer-1")).toBe("Customers");
    expect(activeLabel("/app/procurement/po-1")).toBe("Procurement");
    expect(activeLabel("/app/receiving/receipt-1")).toBe("Receiving");
    expect(activeLabel("/app/order-lines/line-1")).toBe("Orders");
    expect(activeLabel("/app/items/item-1")).toBe("Products");
    expect(activeLabel("/app/boms")).toBe("BOM");
  });
});
