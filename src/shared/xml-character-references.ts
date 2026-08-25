const XML_CHARACTER_REFERENCE_PATTERN = /&(?:(amp|lt|gt|quot|apos)|#([0-9]+)|#x([0-9A-Fa-f]+));/gu;

const XML_NAMED_CHARACTERS: Readonly<Record<string, string>> = {
  amp: "&",
  apos: "'",
  gt: ">",
  lt: "<",
  quot: '"',
};

function isXmlCodePoint(value: number): boolean {
  return (
    value === 0x09 ||
    value === 0x0a ||
    value === 0x0d ||
    (value >= 0x20 && value <= 0xd7ff) ||
    (value >= 0xe000 && value <= 0xfffd) ||
    (value >= 0x10000 && value <= 0x10ffff)
  );
}

function parseNumericCharacterReference(digits: string, radix: 10 | 16): number | null {
  const significantDigits = digits.replace(/^0+/u, "") || "0";
  const maximumDigits = radix === 10 ? 7 : 6;
  if (significantDigits.length > maximumDigits) return null;
  return Number.parseInt(significantDigits, radix);
}

/** Decodes one XML entity layer without reinterpreting references produced by that layer. */
export function decodeXmlCharacterReferences(value: string): string {
  return value.replace(
    XML_CHARACTER_REFERENCE_PATTERN,
    (
      reference,
      named: string | undefined,
      decimal: string | undefined,
      hex: string | undefined,
    ) => {
      if (named) return XML_NAMED_CHARACTERS[named] ?? reference;

      const codePoint = decimal
        ? parseNumericCharacterReference(decimal, 10)
        : parseNumericCharacterReference(hex ?? "", 16);
      if (codePoint === null || !isXmlCodePoint(codePoint)) return reference;
      return String.fromCodePoint(codePoint);
    },
  );
}
