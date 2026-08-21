import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

interface MeshEndpoint {
  positions: number[];
  normals: number[];
}

interface CorrectiveMorphMesh {
  topology: {
    vertexCount: number;
  };
  regularBevelRange: [number, number];
  fitted: MeshEndpoint;
  regularMin: MeshEndpoint;
  regularMax: MeshEndpoint;
}

type Vec2 = readonly [number, number];
type Vec3 = readonly [number, number, number];
type Mat2 = readonly [number, number, number, number, number, number];

interface GlyphShape {
  vertices: readonly Vec2[];
}

interface GlyphLayer {
  shape: GlyphShape;
  x: number;
  y: number;
  rotation: number;
  scaleX: number;
  scaleY: number;
  role?: "slash";
}

interface GlyphLayout {
  gap: number;
  offsetX: number;
  offsetY: number;
  slashStroke?: number;
  slashAngle?: number;
}

const OUTPUT_PATH = resolve("src/renderer/components/ui/nodex-home-mark-model.generated.ts");
const GLYPH_OUTPUT_PATH = resolve(
  "src/renderer/components/ui/nodex-home-mark-glyph-scenes.generated.ts",
);
const REGULAR_BEVEL = 0.052;
const FITTED_SCALE = 544.3973872;
const GLYPH_PROJECTION_SCALE = 636.945;
const FITTED_PRINCIPAL: Vec2 = [396.941096, 404.431016];
const GLYPH_PRINCIPAL: Vec2 = [396.941, 404.431];
const HERO_GEOMETRY_SCALE = 1.17;
const FRONT_Z = 0.49985;
const GLYPH_TARGET_Z = 0.5008;
const GLYPH_STROKE = 5.742;
const PROMPT_STROKE = 50 * HERO_GEOMETRY_SCALE;
const BASE_ROTATION = [
  0.9591977392402923, 0, 0.282736090791947, -0.0590442569816084, 0.9779515955840853,
  0.2003108893995316, -0.2765022111191914, -0.208831694659938, 0.9380489595706912,
] as const;
const FITTED_GLYPH_SCREEN: readonly Vec2[] = [
  [305, 352],
  [411, 438.203],
  [305, 535],
  [458.035, 565.638],
  [579.966, 558.361],
];

const SHORT_ARROW: GlyphShape = {
  vertices: [
    [9.794, 2.771],
    [0.221, -2.771],
    [-9.794, 2.771],
  ],
};
const SHORT_LINE: GlyphShape = {
  vertices: [
    [6.784, 0],
    [-6.784, 0],
  ],
};
const GLYPH_LAYOUTS = {
  prompt: { gap: 1, offsetX: 0, offsetY: 0 },
  face: { gap: 1.15, offsetX: -0.014, offsetY: 0 },
  wink: { gap: 1.04, offsetX: 0, offsetY: 0 },
  split: { gap: 1.11, offsetX: 0, offsetY: 0 },
  inverted: { gap: 1.11, offsetX: 0, offsetY: 0 },
  "bar-caret": { gap: 1.11, offsetX: 0, offsetY: 0 },
  bars: { gap: 1.01, offsetX: 0, offsetY: 0 },
  "offset-caret": { gap: 1.11, offsetX: 0, offsetY: 0 },
  "double-bars": { gap: 1.01, offsetX: 0, offsetY: 0 },
  "chevron-equals": { gap: 1.15, offsetX: 0, offsetY: 0 },
  code: {
    gap: 1.21,
    offsetX: 0,
    offsetY: 0,
    slashStroke: 6.377,
    slashAngle: -70.25,
  },
} as const satisfies Record<string, GlyphLayout>;

function glyphLayer(
  shape: GlyphShape,
  x: number,
  y: number,
  rotation = 0,
  scaleX = 500,
  scaleY = 500,
  role?: "slash",
): GlyphLayer {
  return { shape, x, y, rotation, scaleX, scaleY, role };
}

const GLYPH_LAYERS = {
  face: [
    glyphLayer(SHORT_ARROW, 307.52, 250.557, 90, 500, -500),
    glyphLayer(SHORT_LINE, 200.422, 235.768, 180),
    glyphLayer(SHORT_LINE, 200.422, 275.768, 180),
  ],
  wink: [
    glyphLayer(SHORT_ARROW, 307.52, 250.557, -90),
    glyphLayer(SHORT_LINE, 184.422, 251.768, 90),
  ],
  split: [glyphLayer(SHORT_ARROW, 207.52, 250.557), glyphLayer(SHORT_LINE, 336.422, 251.768, 90)],
  inverted: [
    glyphLayer(SHORT_ARROW, 303.52, 234.557, 180),
    glyphLayer(SHORT_LINE, 192.422, 291.768),
  ],
  "bar-caret": [
    glyphLayer(SHORT_ARROW, 303.52, 246.557),
    glyphLayer(SHORT_LINE, 172.422, 251.768, 90),
  ],
  bars: [
    glyphLayer(SHORT_LINE, 200.422, 251.768),
    glyphLayer(SHORT_LINE, 200.422, 251.768, 90),
    glyphLayer(SHORT_LINE, 324.422, 251.768, 90),
  ],
  "offset-caret": [
    glyphLayer(SHORT_ARROW, 199.52, 226.557),
    glyphLayer(SHORT_LINE, 316.422, 283.768, 180),
  ],
  "double-bars": [
    glyphLayer(SHORT_LINE, 184.422, 251.768, 90),
    glyphLayer(SHORT_LINE, 326.422, 251.768, 90),
  ],
  "chevron-equals": [
    glyphLayer(SHORT_ARROW, 207.52, 250.557, -90, 500, -500),
    glyphLayer(SHORT_LINE, 312.422, 235.768, 180),
    glyphLayer(SHORT_LINE, 312.422, 275.768, 180),
  ],
  code: [
    glyphLayer(SHORT_ARROW, 323.52, 250.557, 90),
    glyphLayer(SHORT_ARROW, 179.52, 250.557, 90, 500, -500),
    glyphLayer(SHORT_LINE, 252.422, 249.768, -65, 500, 500, "slash"),
  ],
} as const;

function readSourceArgument(): string {
  const index = process.argv.indexOf("--source");
  const source = index >= 0 ? process.argv[index + 1] : undefined;
  if (!source) {
    throw new Error(
      "Pass --source <corrective-morph-aligned-mesh.json>. The generated runtime module is self-contained and does not read this research artifact at runtime.",
    );
  }
  return resolve(source);
}

function cubicPoint(a: Vec2, b: Vec2, c: Vec2, d: Vec2, amount: number): Vec2 {
  const inverse = 1 - amount;
  return [
    inverse ** 3 * a[0] +
      3 * inverse ** 2 * amount * b[0] +
      3 * inverse * amount ** 2 * c[0] +
      amount ** 3 * d[0],
    inverse ** 3 * a[1] +
      3 * inverse ** 2 * amount * b[1] +
      3 * inverse * amount ** 2 * c[1] +
      amount ** 3 * d[1],
  ];
}

type PanelSegment = { kind: "line"; end: Vec2 } | { kind: "cubic"; c1: Vec2; c2: Vec2; end: Vec2 };

function samplePanel(start: Vec2, segments: readonly PanelSegment[]): Vec2[] {
  const boundary: Vec2[] = [start];
  let current = start;
  for (const segment of segments) {
    if (segment.kind === "line") {
      boundary.push(segment.end);
      current = segment.end;
      continue;
    }
    for (let step = 1; step <= 8; step += 1) {
      boundary.push(cubicPoint(current, segment.c1, segment.c2, segment.end, step / 8));
    }
    current = segment.end;
  }
  const last = boundary.at(-1);
  if (last && Math.hypot(last[0] - start[0], last[1] - start[1]) < 1e-6) {
    boundary.pop();
  }
  if (boundary.length !== 36) {
    throw new Error(`Expected 36 panel boundary samples, received ${boundary.length}.`);
  }
  return boundary;
}

function subtract3(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function add3(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function scale3(value: Vec3, amount: number): Vec3 {
  return [value[0] * amount, value[1] * amount, value[2] * amount];
}

function dot3(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function cross3(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function transposeMatVec3(matrix: readonly number[], vector: Vec3): Vec3 {
  return [
    matrix[0] * vector[0] + matrix[3] * vector[1] + matrix[6] * vector[2],
    matrix[1] * vector[0] + matrix[4] * vector[1] + matrix[7] * vector[2],
    matrix[2] * vector[0] + matrix[5] * vector[1] + matrix[8] * vector[2],
  ];
}

function raycastFittedScreen(screen: Vec2, positions: readonly number[]): Vec3 {
  const cameraPoint: Vec3 = [
    (screen[0] - FITTED_PRINCIPAL[0]) / FITTED_SCALE,
    (screen[1] - FITTED_PRINCIPAL[1]) / FITTED_SCALE,
    4,
  ];
  const origin = transposeMatVec3(BASE_ROTATION, cameraPoint);
  const direction = transposeMatVec3(BASE_ROTATION, [0, 0, -1]);
  let nearest = Number.POSITIVE_INFINITY;
  let hit: Vec3 | null = null;

  for (let offset = 0; offset < positions.length; offset += 9) {
    const a: Vec3 = [positions[offset], positions[offset + 1], positions[offset + 2]];
    const b: Vec3 = [positions[offset + 3], positions[offset + 4], positions[offset + 5]];
    const c: Vec3 = [positions[offset + 6], positions[offset + 7], positions[offset + 8]];
    const edge1 = subtract3(b, a);
    const edge2 = subtract3(c, a);
    const p = cross3(direction, edge2);
    const determinant = dot3(edge1, p);
    if (Math.abs(determinant) < 1e-10) continue;

    const inverse = 1 / determinant;
    const tvec = subtract3(origin, a);
    const u = dot3(tvec, p) * inverse;
    if (u < -0.000001 || u > 1.000001) continue;

    const q = cross3(tvec, edge1);
    const v = dot3(direction, q) * inverse;
    if (v < -0.000001 || u + v > 1.000001) continue;

    const distance = dot3(edge2, q) * inverse;
    if (distance <= 0 || distance >= nearest) continue;
    nearest = distance;
    hit = add3(origin, scale3(direction, distance));
  }

  if (!hit) {
    throw new Error(`Reference ray missed fitted shell at ${screen.join(", ")}.`);
  }
  return hit;
}

function normalize3(x: number, y: number, z: number): Vec3 {
  const length = Math.hypot(x, y, z);
  if (length < 1e-12) return [0, 0, 1];
  return [x / length, y / length, z / length];
}

function quantizePosition(value: number): number {
  return Math.round(Math.max(-0.5, Math.min(0.5, value)) * 65_534);
}

function quantizeNormal(value: number): number {
  return Math.round(Math.max(-1, Math.min(1, value)) * 32_767);
}

function numberArray(name: string, values: readonly number[]): string {
  return `export const ${name} = new Float32Array([\n  ${values
    .map((value) => Number(value.toFixed(9)))
    .join(", ")}\n]);`;
}

function multiply2(a: Mat2, b: Mat2): Mat2 {
  return [
    a[0] * b[0] + a[2] * b[1],
    a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3],
    a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4],
    a[1] * b[4] + a[3] * b[5] + a[5],
  ];
}

function translate2(x: number, y: number): Mat2 {
  return [1, 0, 0, 1, x, y];
}

function scale2(x: number, y = x): Mat2 {
  return [x, 0, 0, y, 0, 0];
}

function rotate2(degrees: number): Mat2 {
  const radians = (degrees * Math.PI) / 180;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  return [cosine, sine, -sine, cosine, 0, 0];
}

function apply2(matrix: Mat2, point: Vec2): Vec2 {
  return [
    matrix[0] * point[0] + matrix[2] * point[1] + matrix[4],
    matrix[1] * point[0] + matrix[3] * point[1] + matrix[5],
  ];
}

function layerMatrix(layer: GlyphLayer): Mat2 {
  return multiply2(
    translate2(layer.x, layer.y),
    multiply2(rotate2(layer.rotation), scale2(layer.scaleX / 100, layer.scaleY / 100)),
  );
}

function performanceChevronShape(): GlyphShape {
  const originalUpper = Math.hypot(9.794 - 0.221, 2.771 - -2.771);
  const originalLower = Math.hypot(-9.794 - 0.221, 2.771 - -2.771);
  const armLength = (originalUpper + originalLower) * 0.5 * 1.42;
  const halfAngle = (73.25 * Math.PI) / 360;
  const halfSpan = Math.sin(halfAngle) * armLength;
  const depth = Math.cos(halfAngle) * armLength;
  return {
    vertices: [
      [halfSpan, depth * 0.5],
      [0, -depth * 0.5],
      [-halfSpan, depth * 0.5],
    ],
  };
}

function resolvedShape(shape: GlyphShape): GlyphShape {
  return shape === SHORT_ARROW ? performanceChevronShape() : shape;
}

function adjustedLayers(id: keyof typeof GLYPH_LAYERS): GlyphLayer[] {
  const layout = GLYPH_LAYOUTS[id];
  const pivots: Record<keyof typeof GLYPH_LAYERS, number> = {
    face: (307.52 + 200.422) * 0.5,
    wink: (307.52 + 184.422) * 0.5,
    split: (207.52 + 336.422) * 0.5,
    inverted: (303.52 + 192.422) * 0.5,
    "bar-caret": (303.52 + 172.422) * 0.5,
    bars: (200.422 + 324.422) * 0.5,
    "offset-caret": (199.52 + 316.422) * 0.5,
    "double-bars": (184.422 + 326.422) * 0.5,
    "chevron-equals": (207.52 + 312.422) * 0.5,
    code: (323.52 + 179.52) * 0.5,
  };
  return GLYPH_LAYERS[id].map((layer) => {
    const rotation =
      id === "code" && layer.role === "slash" ? GLYPH_LAYOUTS.code.slashAngle : layer.rotation;
    if (id === "code" && layer.role === "slash") return { ...layer, rotation };
    return {
      ...layer,
      rotation,
      x: pivots[id] + (layer.x - pivots[id]) * layout.gap,
    };
  });
}

const LEGACY_EXTENT_MAP: Mat2 = (() => {
  const source = { minX: 152.55, maxX: 344.145, minY: 191.57, maxY: 312.025 };
  const legacy = {
    minX: -0.323427709,
    maxX: 0.203195827,
    minY: -0.220405539,
    maxY: 0.19903722,
  };
  const scaleX = (legacy.maxX - legacy.minX) / (source.maxX - source.minX);
  const scaleY = (legacy.maxY - legacy.minY) / (source.maxY - source.minY);
  return [
    scaleX,
    0,
    0,
    scaleY,
    legacy.minX - scaleX * source.minX,
    legacy.minY - scaleY * source.minY,
  ];
})();

function objectMap(id: keyof typeof GLYPH_LAYERS): Mat2 {
  const layout = GLYPH_LAYOUTS[id];
  return multiply2(translate2(layout.offsetX, layout.offsetY), LEGACY_EXTENT_MAP);
}

function projection2(scale: number, principal: Vec2, z: number): Mat2 {
  return [
    BASE_ROTATION[0] * scale,
    BASE_ROTATION[3] * scale,
    BASE_ROTATION[1] * scale,
    BASE_ROTATION[4] * scale,
    principal[0] + BASE_ROTATION[2] * z * scale,
    principal[1] + BASE_ROTATION[5] * z * scale,
  ];
}

function pathData(shape: GlyphShape): string {
  return shape.vertices.reduce(
    (path, point, index) => `${path}${index === 0 ? "M" : "L"}${point[0]} ${point[1]}`,
    "",
  );
}

function matrixString(matrix: Mat2): string {
  return `matrix(${matrix.map((value) => Number(value.toFixed(8))).join(" ")})`;
}

function exactPromptScreenPoint(point: Vec2): Vec2 {
  return [
    400 + (point[0] - 400) * HERO_GEOMETRY_SCALE,
    400 + (point[1] - 400) * HERO_GEOMETRY_SCALE,
  ];
}

function unprojectToFrontPlane(point: Vec2): Vec3 {
  const targetX =
    (point[0] - GLYPH_PRINCIPAL[0]) / GLYPH_PROJECTION_SCALE - BASE_ROTATION[2] * FRONT_Z;
  const targetY =
    (point[1] - GLYPH_PRINCIPAL[1]) / GLYPH_PROJECTION_SCALE - BASE_ROTATION[5] * FRONT_Z;
  const determinant = BASE_ROTATION[0] * BASE_ROTATION[4] - BASE_ROTATION[1] * BASE_ROTATION[3];
  return [
    (targetX * BASE_ROTATION[4] - BASE_ROTATION[1] * targetY) / determinant,
    (BASE_ROTATION[0] * targetY - targetX * BASE_ROTATION[3]) / determinant,
    GLYPH_TARGET_Z,
  ];
}

function projectFittedScreen(target: Vec3): Vec2 {
  const fittedProjectionScale = FITTED_SCALE * HERO_GEOMETRY_SCALE;
  const screenX =
    FITTED_PRINCIPAL[0] +
    (BASE_ROTATION[0] * target[0] + BASE_ROTATION[1] * target[1] + BASE_ROTATION[2] * target[2]) *
      fittedProjectionScale;
  const screenY =
    FITTED_PRINCIPAL[1] +
    (BASE_ROTATION[3] * target[0] + BASE_ROTATION[4] * target[1] + BASE_ROTATION[5] * target[2]) *
      fittedProjectionScale;
  return [400 + (screenX - 400) / HERO_GEOMETRY_SCALE, 400 + (screenY - 400) / HERO_GEOMETRY_SCALE];
}

function roundedTuple(values: readonly number[]): number[] {
  return values.map((value) => Number(value.toFixed(9)));
}

function buildGlyphScenes(
  positions: readonly number[],
  fittedPrompt: readonly number[],
): Record<string, unknown> {
  const promptTargets = FITTED_GLYPH_SCREEN.map((point) =>
    unprojectToFrontPlane(exactPromptScreenPoint(point)),
  );
  const promptPairs = [
    [0, 1],
    [1, 2],
    [3, 4],
  ] as const;
  const promptSegments = promptPairs.map(([a, b]) => ({
    fittedA: roundedTuple(fittedPrompt.slice(a * 3, a * 3 + 3)),
    fittedB: roundedTuple(fittedPrompt.slice(b * 3, b * 3 + 3)),
    targetA: roundedTuple(promptTargets[a]),
    targetB: roundedTuple(promptTargets[b]),
    radius: Number((PROMPT_STROKE / (GLYPH_PROJECTION_SCALE * 2)).toFixed(9)),
  }));
  const promptPaths = [
    {
      d: "M305 352L411 438.203L305 535",
      transform: "translate(400 400) scale(1.17) translate(-400 -400)",
      strokeWidth: 50,
    },
    {
      d: "M458.035 565.638L579.966 558.361",
      transform: "translate(400 400) scale(1.17) translate(-400 -400)",
      strokeWidth: 50,
    },
  ];
  const result: Record<string, unknown> = {
    prompt: { segments: promptSegments, svgPaths: promptPaths },
    "prompt-no-cursor": {
      segments: promptSegments.slice(0, 2),
      svgPaths: promptPaths.slice(0, 1),
    },
  };

  for (const id of Object.keys(GLYPH_LAYERS) as (keyof typeof GLYPH_LAYERS)[]) {
    const map = objectMap(id);
    const canonicalMap = multiply2(
      projection2(GLYPH_PROJECTION_SCALE, GLYPH_PRINCIPAL, FRONT_Z),
      map,
    );
    const segments: unknown[] = [];
    const svgPaths = adjustedLayers(id).map((layer) => {
      const localTransform = multiply2(map, layerMatrix(layer));
      const shape = resolvedShape(layer.shape);
      const strokeWidth =
        id === "code" && layer.role === "slash" ? GLYPH_LAYOUTS.code.slashStroke : GLYPH_STROKE;
      const areaScale = Math.sqrt(
        Math.abs(localTransform[0] * localTransform[3] - localTransform[1] * localTransform[2]),
      );
      for (let index = 0; index < shape.vertices.length - 1; index += 1) {
        const a2 = apply2(localTransform, shape.vertices[index]);
        const b2 = apply2(localTransform, shape.vertices[index + 1]);
        const targetA: Vec3 = [a2[0], a2[1], GLYPH_TARGET_Z];
        const targetB: Vec3 = [b2[0], b2[1], GLYPH_TARGET_Z];
        segments.push({
          fittedA: roundedTuple(raycastFittedScreen(projectFittedScreen(targetA), positions)),
          fittedB: roundedTuple(raycastFittedScreen(projectFittedScreen(targetB), positions)),
          targetA: roundedTuple(targetA),
          targetB: roundedTuple(targetB),
          radius: Number((strokeWidth * 0.5 * areaScale).toFixed(9)),
        });
      }
      return {
        d: pathData(shape),
        transform: matrixString(multiply2(canonicalMap, layerMatrix(layer))),
        strokeWidth,
      };
    });
    if (segments.length > 9) throw new Error(`${id} exceeds the nine-segment shader limit.`);
    result[id] = { segments, svgPaths };
  }
  return result;
}

const sourcePath = readSourceArgument();
const sourceText = readFileSync(sourcePath, "utf8");
const mesh = JSON.parse(sourceText) as CorrectiveMorphMesh;
const { vertexCount } = mesh.topology;
const componentCount = vertexCount * 3;
for (const endpoint of [mesh.fitted, mesh.regularMin, mesh.regularMax]) {
  if (endpoint.positions.length !== componentCount || endpoint.normals.length !== componentCount) {
    throw new Error("Corrective morph endpoints do not share one triangle-list topology.");
  }
}

const [minBevel, maxBevel] = mesh.regularBevelRange;
const regularAmount = (REGULAR_BEVEL - minBevel) / (maxBevel - minBevel);
const packed = new Int16Array(vertexCount * 12);
let maxPositionError = 0;
for (let vertex = 0; vertex < vertexCount; vertex += 1) {
  const sourceOffset = vertex * 3;
  const targetOffset = vertex * 12;
  const regularNormal = normalize3(
    mesh.regularMin.normals[sourceOffset] +
      (mesh.regularMax.normals[sourceOffset] - mesh.regularMin.normals[sourceOffset]) *
        regularAmount,
    mesh.regularMin.normals[sourceOffset + 1] +
      (mesh.regularMax.normals[sourceOffset + 1] - mesh.regularMin.normals[sourceOffset + 1]) *
        regularAmount,
    mesh.regularMin.normals[sourceOffset + 2] +
      (mesh.regularMax.normals[sourceOffset + 2] - mesh.regularMin.normals[sourceOffset + 2]) *
        regularAmount,
  );

  for (let component = 0; component < 3; component += 1) {
    const fittedPosition = mesh.fitted.positions[sourceOffset + component];
    const regularPosition =
      mesh.regularMin.positions[sourceOffset + component] +
      (mesh.regularMax.positions[sourceOffset + component] -
        mesh.regularMin.positions[sourceOffset + component]) *
        regularAmount;
    const fittedPositionQuantized = quantizePosition(fittedPosition);
    const regularPositionQuantized = quantizePosition(regularPosition);
    packed[targetOffset + component] = fittedPositionQuantized;
    packed[targetOffset + 3 + component] = quantizeNormal(
      mesh.fitted.normals[sourceOffset + component],
    );
    packed[targetOffset + 6 + component] = regularPositionQuantized;
    packed[targetOffset + 9 + component] = quantizeNormal(regularNormal[component]);
    maxPositionError = Math.max(
      maxPositionError,
      Math.abs(fittedPosition - fittedPositionQuantized / 65_534),
      Math.abs(regularPosition - regularPositionQuantized / 65_534),
    );
  }
}

const topBoundary = samplePanel(
  [137.862, 152.3110570608],
  [
    {
      kind: "cubic",
      c1: [132.315, 148.2040570608],
      c2: [134.955, 136.8422343],
      end: [141.923, 136.3432343],
    },
    { kind: "line", end: [519.555, 113.0977657] },
    { kind: "cubic", c1: [531.588, 112.2347657], c2: [543.543, 113.628], end: [553.273, 120.522] },
    { kind: "line", end: [629.043, 174.203] },
    {
      kind: "cubic",
      c1: [631.918, 176.241],
      c2: [630.57, 179.2065641],
      end: [627.008, 179.4005641],
    },
    { kind: "line", end: [227.097, 204.0174359] },
    {
      kind: "cubic",
      c1: [214.994, 204.6754359],
      c2: [203.048, 198.7999429392],
      end: [193.425, 191.6759429392],
    },
    { kind: "line", end: [137.862, 152.3110570608] },
  ],
);
const frontBoundary = samplePanel(
  [208.339, 270.767],
  [
    { kind: "cubic", c1: [208.339, 257.775], c2: [218.835, 247.044], end: [232.257, 246.313] },
    { kind: "line", end: [655.075, 223.286] },
    { kind: "cubic", c1: [668.158, 222.574], c2: [679.168, 232.633], end: [679.168, 245.295] },
    { kind: "line", end: [679.168, 627.132] },
    { kind: "cubic", c1: [679.168, 640.1], c2: [668.71, 650.82], end: [655.315, 651.582] },
    { kind: "line", end: [235.172, 675.487] },
    { kind: "cubic", c1: [220.615, 676.317], c2: [208.339, 665.13], end: [208.339, 651.037] },
    { kind: "line", end: [208.339, 270.767] },
  ],
);

const fittedTopBoundary = topBoundary.flatMap((screen) =>
  raycastFittedScreen(screen, mesh.fitted.positions),
);
const fittedFrontBoundary = frontBoundary.flatMap((screen) =>
  raycastFittedScreen(screen, mesh.fitted.positions),
);
const fittedGlyph = FITTED_GLYPH_SCREEN.flatMap((screen) =>
  raycastFittedScreen(screen, mesh.fitted.positions),
);
const bytes = Buffer.from(packed.buffer, packed.byteOffset, packed.byteLength);
const sourceHash = createHash("sha256").update(sourceText).digest("hex");

const output = `// This file is generated by scripts/generate-nodex-home-mark-runtime.ts.
// Source sha256: ${sourceHash}
// Position quantization max error: ${maxPositionError}

export const NODEX_HOME_MARK_VERTEX_COUNT = ${vertexCount};
export const NODEX_HOME_MARK_VERTEX_STRIDE_BYTES = 24;
export const NODEX_HOME_MARK_PACKED_BASE64 = ${JSON.stringify(bytes.toString("base64"))};

${numberArray("NODEX_HOME_MARK_FITTED_TOP_BOUNDARY", fittedTopBoundary)}

${numberArray("NODEX_HOME_MARK_FITTED_FRONT_BOUNDARY", fittedFrontBoundary)}

${numberArray("NODEX_HOME_MARK_FITTED_GLYPH", fittedGlyph)}
`;

const glyphScenes = buildGlyphScenes(mesh.fitted.positions, fittedGlyph);
const glyphOutput = `// This file is generated by scripts/generate-nodex-home-mark-runtime.ts.
// Source sha256: ${sourceHash}

export type NodexHomeMarkGlyphSceneId =
  | "prompt"
  | "prompt-no-cursor"
  | "face"
  | "wink"
  | "split"
  | "inverted"
  | "bar-caret"
  | "bars"
  | "offset-caret"
  | "double-bars"
  | "chevron-equals"
  | "code";

export interface NodexHomeMarkGlyphSegment {
  readonly fittedA: readonly [number, number, number];
  readonly fittedB: readonly [number, number, number];
  readonly targetA: readonly [number, number, number];
  readonly targetB: readonly [number, number, number];
  readonly radius: number;
}

export interface NodexHomeMarkSvgPath {
  readonly d: string;
  readonly transform: string;
  readonly strokeWidth: number;
}

export interface NodexHomeMarkGlyphScene {
  readonly segments: readonly NodexHomeMarkGlyphSegment[];
  readonly svgPaths: readonly NodexHomeMarkSvgPath[];
}

export const NODEX_HOME_MARK_GLYPH_SCENES = ${JSON.stringify(glyphScenes, null, 2)} as const satisfies Record<NodexHomeMarkGlyphSceneId, NodexHomeMarkGlyphScene>;
`;

writeFileSync(OUTPUT_PATH, output);
writeFileSync(GLYPH_OUTPUT_PATH, glyphOutput);
console.log(
  JSON.stringify(
    {
      outputs: [OUTPUT_PATH, GLYPH_OUTPUT_PATH],
      sourceSha256: sourceHash,
      vertexCount,
      packedBytes: packed.byteLength,
      glyphSceneCount: Object.keys(glyphScenes).length,
      maxPositionError,
    },
    null,
    2,
  ),
);
