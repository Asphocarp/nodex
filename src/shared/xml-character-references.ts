const XML_CHARACTER_REFERENCE_PATTERN =
  /&(?:(amp|lt|gt|quot|apos)|#([0-9]{1,7})|#x([0-9A-Fa-f]{1,6}));/gu;

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

      const codePoint = Number.parseInt(decimal ?? hex ?? "", decimal ? 10 : 16);
      if (!isXmlCodePoint(codePoint)) return reference;
      return String.fromCodePoint(codePoint);
    },
  );
}
