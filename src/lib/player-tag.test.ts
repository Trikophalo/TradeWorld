import { describe, expect, it } from "vitest";
import {
  TAG_ALPHABET,
  formatTag,
  friendCodeOf,
  nameKey,
  parseFriendCode,
  parseTag,
  tagFromUniform,
} from "./player-tag";

describe("player tags (ADR-085)", () => {
  it("parses with or without #, any case, and rejects ambiguous letters", () => {
    expect(parseTag("#k7q2")).toBe("K7Q2");
    expect(parseTag(" K7Q2 ")).toBe("K7Q2");
    expect(parseTag("K0Q2")).toBeNull();
    expect(parseTag("KIQ2")).toBeNull();
    expect(parseTag("K7Q")).toBeNull();
    expect(parseTag("Mira")).toBeNull();
    expect(formatTag("K7Q2")).toBe("#K7Q2");
  });

  it("builds valid tags from uniform numbers", () => {
    expect(tagFromUniform([0, 0, 0, 0])).toBe("AAAA");
    expect(tagFromUniform([0.9999, 0.9999, 0.9999, 0.9999])).toBe("9999");
    const tag = tagFromUniform([0.1, 0.4, 0.7, 0.95]);
    expect(parseTag(tag)).toBe(tag);
    expect([...tag].every((c) => TAG_ALPHABET.includes(c))).toBe(true);
  });
});

describe("friend codes (ADR-111)", () => {
  it("is NEXA plus the tag and reads back however it is typed", () => {
    expect(friendCodeOf("K7Q2")).toBe("NEXA-K7Q2");
    expect(parseFriendCode("NEXA-K7Q2")).toBe("K7Q2");
    expect(parseFriendCode(" nexa k7q2 ")).toBe("K7Q2");
    expect(parseFriendCode("#k7q2")).toBe("K7Q2");
    expect(parseFriendCode("K7Q2")).toBe("K7Q2");
  });

  it("keeps a tag that spells NEXA and rejects everything else", () => {
    expect(parseFriendCode("NEXA")).toBe("NEXA");
    expect(parseFriendCode("NEXA-NEXA")).toBe("NEXA");
    expect(parseFriendCode("NEXA-0000")).toBeNull();
    expect(parseFriendCode("NEXA-K7Q")).toBeNull();
    expect(parseFriendCode("")).toBeNull();
    expect(parseFriendCode("NEXA-K7Q2X")).toBeNull();
  });
});

describe("name keys: no lookalikes (ADR-085)", () => {
  it("treats case, digits as letters and underscores as the same name", () => {
    expect(nameKey("Mira")).toBe(nameKey("mira"));
    expect(nameKey("Mira")).toBe(nameKey("M1ra"));
    expect(nameKey("Mira")).toBe(nameKey("Mi_ra"));
    expect(nameKey("Boerse")).toBe(nameKey("Börse".replace("ö", "oe")));
  });

  it("keeps really different names apart", () => {
    expect(nameKey("Mira")).not.toBe(nameKey("Mira2"));
    expect(nameKey("Matthias")).not.toBe(nameKey("Mathias"));
    expect(nameKey("Max")).not.toBe(nameKey("Maxi"));
  });
});
