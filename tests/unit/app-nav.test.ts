import { describe, expect, it } from "vitest";

import { appNavItems, isActiveNav } from "../../app/lib/app-nav";

function activeLabel(pathname: string) {
  return appNavItems.find((item) => isActiveNav(pathname, item))?.label;
}

describe("app nav active state", () => {
  it("activates nested app sections", () => {
    expect(activeLabel("/app/customers")).toBe("08 Customers");
    expect(activeLabel("/app/customers/customer-1")).toBe("08 Customers");
    expect(activeLabel("/app/procurement/po-1")).toBe("03 Procurement");
    expect(activeLabel("/app/receiving/receipt-1")).toBe("04 Receiving");
    expect(activeLabel("/app/payments")).toBe("06 Payments");
    expect(activeLabel("/app/order-lines/line-1")).toBe("01 Orders");
    expect(activeLabel("/app/items/item-1")).toBe("02 Products");
    expect(activeLabel("/app/boms")).toBe("10 BOM / Kitting");
  });
});
