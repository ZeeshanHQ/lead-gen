import { describe, expect, it } from "vitest";
import { findMatches, identityKeys, nameSimilarity, type ExistingIdentity } from "@/server/domain/dedupe";

function existing(id: string, c: Parameters<typeof identityKeys>[0], refs: ExistingIdentity["providerRefs"] = []): ExistingIdentity {
  return { id, ...identityKeys(c), providerRefs: refs };
}

describe("dedupe", () => {
  const base = existing("a", {
    name: "Cool Air Heating & Cooling LLC",
    website: "https://www.coolair.com",
    phone: "(214) 555-2368",
    address: "100 Main Street",
    zip: "75201",
    city: "Dallas",
    state: "TX",
  });

  it("matches strongly on website domain regardless of www/path/case", () => {
    const hits = findMatches({ name: "Totally Different Name", website: "COOLAIR.com/about" }, [base]);
    expect(hits[0]?.match.strength).toBe("STRONG");
  });
  it("matches strongly on phone", () => {
    const hits = findMatches({ name: "Other", phone: "214.555.2368" }, [base]);
    expect(hits[0]?.match.strength).toBe("STRONG");
  });
  it("matches strongly on street + ZIP", () => {
    const hits = findMatches({ name: "Other", address: "100 main st", zip: "75201" }, [base]);
    expect(hits[0]?.match.strength).toBe("STRONG");
  });
  it("matches strongly on provider id", () => {
    const e = existing("p", { name: "X" }, [{ provider: "places", ref: "abc" }]);
    expect(findMatches({ name: "Y", providerRef: { provider: "places", ref: "abc" } }, [e])[0]?.match.strength).toBe("STRONG");
    expect(findMatches({ name: "Y", providerRef: { provider: "places", ref: "zzz" } }, [e])).toHaveLength(0);
  });
  it("same name+city+state is STRONG", () => {
    const hits = findMatches({ name: "COOL AIR HEATING AND COOLING", city: "dallas", state: "Texas" }, [base]);
    expect(hits[0]?.match.strength).toBe("STRONG");
  });
  it("same name in same state but different city is only POSSIBLE", () => {
    const hits = findMatches({ name: "Cool Air Heating and Cooling", city: "Austin", state: "TX" }, [base]);
    expect(hits[0]?.match.strength).toBe("POSSIBLE");
  });
  it("same name in a different state does not match", () => {
    expect(findMatches({ name: "Cool Air Heating and Cooling", city: "Austin", state: "OK" }, [base])).toHaveLength(0);
  });
  it("name-only without geography never matches", () => {
    expect(findMatches({ name: "Cool Air Heating and Cooling" }, [base])).toHaveLength(0);
  });
  it("similar names in the same city are POSSIBLE", () => {
    const hits = findMatches({ name: "Cool Air Heating and Cooling Dallas", city: "Dallas", state: "TX" }, [base]);
    expect(hits[0]?.match.strength).toBe("POSSIBLE");
  });
  it("seven sources for one company collapse to one strong hit", () => {
    const variants = [
      { name: "Cool Air Heating", website: "coolair.com" },
      { name: "Cool Air H&C", phone: "2145552368" },
      { name: "COOL AIR", website: "https://www.coolair.com/contact" },
    ];
    for (const v of variants) expect(findMatches(v, [base])[0]?.existingId).toBe("a");
  });
  it("nameSimilarity is a token Jaccard", () => {
    expect(nameSimilarity("a b c", "a b c")).toBe(1);
    expect(nameSimilarity("a b", "c d")).toBe(0);
    expect(nameSimilarity("", "a")).toBe(0);
  });
});
