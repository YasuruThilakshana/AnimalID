import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isPhoneLike, maskPhone, telHref } from "./contact.js";

describe("isPhoneLike", () => {
  it("detects phone numbers and rejects emails and blanks", () => {
    assert.equal(isPhoneLike("+1 (555) 010-2030"), true);
    assert.equal(isPhoneLike("0771234589"), true);
    assert.equal(isPhoneLike("+94 77 123 4589"), true);
    assert.equal(isPhoneLike("sara@example.com"), false);
    assert.equal(isPhoneLike("not a number"), false);
    assert.equal(isPhoneLike("123"), false);
    assert.equal(isPhoneLike(""), false);
    assert.equal(isPhoneLike(null), false);
    assert.equal(isPhoneLike(undefined), false);
  });
});

describe("maskPhone", () => {
  it("keeps the first 2 and last 2 digits, masking the middle", () => {
    assert.equal(maskPhone("+1 (555) 010-2030"), "+1 (5**) ***-**30");
    assert.equal(maskPhone("0771234589"), "07******89");
    assert.equal(maskPhone("+94 77 123 4589"), "+94 ** *** **89");
  });

  it("fully masks very short values and blanks", () => {
    assert.equal(maskPhone("123"), "***");
    assert.equal(maskPhone(""), "");
    assert.equal(maskPhone(null), "");
  });

  it("exposes only the first 2 and last 2 digits", () => {
    for (const value of ["+1 (555) 010-2030", "0771234589", "+94 77 123 4589"]) {
      const digits = value.replace(/\D/g, "");
      const maskedDigits = maskPhone(value).replace(/[^*\d]/g, "");
      assert.equal(maskedDigits, digits.slice(0, 2) + "*".repeat(digits.length - 4) + digits.slice(-2));
    }
  });
});

describe("telHref", () => {
  it("builds dialable tel: links from raw values", () => {
    assert.equal(telHref("+1 (555) 010-2030"), "tel:+15550102030");
    assert.equal(telHref("0771234589"), "tel:0771234589");
    assert.equal(telHref(""), "tel:");
  });
});
