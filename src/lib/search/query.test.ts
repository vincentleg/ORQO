import { describe, expect, test } from "bun:test";
import { findKnownCompany, parseSearchQuery, websiteDomain } from "./query";

describe("search query", () => {
  test("websites", () => {
    expect(parseSearchQuery("https://www.Acme.com/about?x=1")).toEqual({ kind: "website", domain: "acme.com", url: "https://acme.com" });
    expect(parseSearchQuery("  acme.io ")).toEqual({ kind: "website", domain: "acme.io", url: "https://acme.io" });
    expect(parseSearchQuery("shop.acme.co.uk/path")).toMatchObject({ domain: "shop.acme.co.uk" });
    expect(websiteDomain("ftp://acme.com")).toBeNull();
    expect(websiteDomain("javascript:alert(1)")).toBeNull();
    expect(websiteDomain("http://localhost:3000")).toBeNull();
  });

  test("names", () => {
    expect(parseSearchQuery("  Acme   Robotics ")).toEqual({ kind: "name", name: "Acme Robotics" });
    expect(parseSearchQuery("Node.js Foundation")).toEqual({ kind: "name", name: "Node.js Foundation" });
    expect(parseSearchQuery("Société Générale")).toEqual({ kind: "name", name: "Société Générale" });
  });

  test("empty or meaningless input", () => {
    expect(parseSearchQuery("")).toBeNull();
    expect(parseSearchQuery("   ")).toBeNull();
    expect(parseSearchQuery(undefined)).toBeNull();
    expect(parseSearchQuery("!!! ---")).toBeNull();
  });

  test("length is capped", () => {
    const t = parseSearchQuery("a".repeat(500));
    expect(t?.kind === "name" && t.name.length).toBe(200);
  });

  test("known-company matching", () => {
    const companies = [
      { name: "Société Générale", website: null },
      { name: "Acme Robotics", website: "https://www.acme.com/" },
    ];
    expect(findKnownCompany(parseSearchQuery("acme.com")!, companies)?.name).toBe("Acme Robotics");
    expect(findKnownCompany(parseSearchQuery("societe generale")!, companies)?.name).toBe("Société Générale");
    expect(findKnownCompany(parseSearchQuery("acme")!, companies)).toBeNull();
    expect(findKnownCompany(parseSearchQuery("other.com")!, companies)).toBeNull();
  });
});
