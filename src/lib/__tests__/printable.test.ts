import { describe, expect, it } from "vitest";
import { printableOnly } from "../printable";

describe("printableOnly", () => {
  it("strips invisible characters that can hide or reorder text", () => {
    const hidden = String.fromCodePoint(0xe0049, 0xe0067); // Unicode tag characters
    const input = `Foundry​ Pool‮${hidden}﻿⁦x⁩`;
    expect(printableOnly(input)).toBe("Foundry Poolx");
  });

  it("keeps emoji, including sequences joined with a zero-width joiner", () => {
    expect(printableOnly("🦓Mined by 👩‍💻")).toBe("🦓Mined by 👩‍💻");
  });

  it("still drops control characters", () => {
    expect(printableOnly("a\u0000b\u0007c\u009fd")).toBe("abcd");
  });
});
