interface RgbaColor {
  readonly red: number;
  readonly green: number;
  readonly blue: number;
  readonly alpha: number;
}

const parseRgbColor = (value: string): RgbaColor | undefined => {
  const match = value.match(/^rgba?\(([^)]+)\)$/u);
  if (!match) return undefined;

  const channels = match[1]!.match(/[\d.]+/gu)?.map(Number);
  if (!channels || channels.length < 3) return undefined;
  return {
    red: channels[0]!,
    green: channels[1]!,
    blue: channels[2]!,
    alpha: channels[3] ?? 1,
  };
};

const parseSrgbColor = (value: string): RgbaColor | undefined => {
  const match = value.match(
    /^color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+))?\)$/u,
  );
  if (!match) return undefined;

  return {
    red: Number(match[1]) * 255,
    green: Number(match[2]) * 255,
    blue: Number(match[3]) * 255,
    alpha: match[4] === undefined ? 1 : Number(match[4]),
  };
};

export function parseComputedColor(value: string): RgbaColor {
  const color = parseRgbColor(value) ?? parseSrgbColor(value);
  if (!color) throw new Error(`Unsupported computed color: ${value}`);
  return color;
}

export function compositeColor(foreground: RgbaColor, background: RgbaColor): RgbaColor {
  const alpha = foreground.alpha + background.alpha * (1 - foreground.alpha);
  if (alpha === 0) return { red: 0, green: 0, blue: 0, alpha: 0 };

  const compositeChannel = (foregroundChannel: number, backgroundChannel: number) =>
    (foregroundChannel * foreground.alpha +
      backgroundChannel * background.alpha * (1 - foreground.alpha)) /
    alpha;
  return {
    red: compositeChannel(foreground.red, background.red),
    green: compositeChannel(foreground.green, background.green),
    blue: compositeChannel(foreground.blue, background.blue),
    alpha,
  };
}

export function getPaintedBackground(element: HTMLElement): RgbaColor {
  const layers: RgbaColor[] = [];
  for (let current: HTMLElement | null = element; current; current = current.parentElement) {
    layers.unshift(parseComputedColor(getComputedStyle(current).backgroundColor));
  }
  return layers.reduce((background, layer) => compositeColor(layer, background), {
    red: 255,
    green: 255,
    blue: 255,
    alpha: 1,
  });
}

export function relativeLuminance(color: RgbaColor): number {
  const linearize = (channel: number) => {
    const normalized = channel / 255;
    return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
  };
  return (
    linearize(color.red) * 0.2126 + linearize(color.green) * 0.7152 + linearize(color.blue) * 0.0722
  );
}

export function contrastRatio(foreground: RgbaColor, background: RgbaColor): number {
  const paintedForeground = compositeColor(foreground, background);
  const lighter = Math.max(relativeLuminance(paintedForeground), relativeLuminance(background));
  const darker = Math.min(relativeLuminance(paintedForeground), relativeLuminance(background));
  return (lighter + 0.05) / (darker + 0.05);
}
