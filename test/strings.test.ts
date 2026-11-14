import { describe, expect, it } from "vitest";
import { en, pt } from "../src/strings.ts";

describe("How to play", () => {
  // The keys are read by position (`KeyboardEvent.code`), so on AZERTY, Dvorak and the rest the letters printed on
  // them are not the ones the help names: the help says so, in every language.
  for (const [lang, s] of [["en", en], ["pt", pt]] as const) {
    it(`says the letter keys go by position, as on a US keyboard (${lang})`, () => {
      expect(s.helpLayout).toMatch(/W A S D/);
      expect(s.helpLayout).toMatch(/Z Q S D/);
      expect(s.helpLayout).toMatch(/A \/ E/);
    });
  }
});
