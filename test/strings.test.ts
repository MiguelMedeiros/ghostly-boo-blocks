// src/strings.ts: the page reads in each of Ghostly's eight languages, picked from the context's BCP 47 tag.
import { describe, expect, it } from "vitest";
import { en, stringsFor } from "../src/strings.ts";

describe("stringsFor", () => {
  it("picks each language Ghostly passes, with its tag and direction", () => {
    const cases: [string, string, "ltr" | "rtl", string][] = [
      ["en", "en", "ltr", "How to play"],
      ["pt-BR", "pt-BR", "ltr", "Como jogar"],
      ["es", "es", "ltr", "Cómo jugar"],
      ["fr", "fr", "ltr", "Comment jouer"],
      ["it", "it", "ltr", "Come si gioca"],
      ["ja", "ja", "ltr", "遊び方"],
      ["zh-CN", "zh-CN", "ltr", "玩法"],
      ["ar", "ar", "rtl", "طريقة اللعب"],
    ];
    for (const [locale, lang, dir, help] of cases) {
      const picked = stringsFor(locale);
      expect([picked.lang, picked.dir, picked.strings.help]).toEqual([lang, dir, help]);
    }
  });

  it("matches a region or script it does not name, and falls back to English", () => {
    expect(stringsFor("es-MX").lang).toBe("es");
    expect(stringsFor("fr-CA").lang).toBe("fr");
    expect(stringsFor("zh-Hans-CN").lang).toBe("zh-CN");
    expect(stringsFor("ar-EG").dir).toBe("rtl");
    expect(stringsFor("PT").lang).toBe("pt-BR");
    expect(stringsFor("de-DE")).toEqual({ lang: "en", dir: "ltr", strings: en });
    expect(stringsFor(undefined)).toEqual({ lang: "en", dir: "ltr", strings: en });
  });

  it("names the contact in every language", () => {
    for (const locale of ["en", "pt", "es", "fr", "it", "ja", "zh", "ar"]) {
      const { strings } = stringsFor(locale);
      expect(strings.together("Ana")).toContain("Ana");
      expect(strings.contactLeft("Ana")).toContain("Ana");
      expect(strings.contactCame("Ana")).toContain("Ana");
      expect(strings.worldReplaced("Ana")).toContain("Ana");
      expect(strings.helpKeys).toHaveLength(en.helpKeys.length);
      expect(strings.helpTouch).toHaveLength(en.helpTouch.length);
    }
  });
});
