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

const OUTPUT_PATH = resolve(
  "src/renderer/components/ui/nodex-home-mark-model.generated.ts",
);
const REGULAR_BEVEL = 0.052;
const FITTED_SCALE = 544.3973872;
const FITTED_PRINCIPAL: Vec2 = [396.941096, 404.431016];
const BASE_ROTATION = [
  0.9591977392402923, 0, 0.282736090791947,
  -0.0590442569816084, 0.9779515955840853, 0.2003108893995316,
  -0.2765022111191914, -0.208831694659938, 0.9380489595706912,
] as const;
const FITTED_GLYPH_SCREEN: readonly Vec2[] = [
  [305, 352],
  [411, 438.203],
  [305, 535],
  [458.035, 565.638],
  [579.966, 558.361],
];

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
    inverse ** 3 * a[0]
      + 3 * inverse ** 2 * amount * b[0]
      + 3 * inverse * amount ** 2 * c[0]
      + amount ** 3 * d[0],
    inverse ** 3 * a[1]
      + 3 * inverse ** 2 * amount * b[1]
      + 3 * inverse * amount ** 2 * c[1]
      + amount ** 3 * d[1],
  ];
}

type PanelSegment =
  | { kind: "line"; end: Vec2 }
  | { kind: "cubic"; c1: Vec2; c2: Vec2; end: Vec2 };

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
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
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
    mesh.regularMin.normals[sourceOffset]
      + (mesh.regularMax.normals[sourceOffset] - mesh.regularMin.normals[sourceOffset]) * regularAmount,
    mesh.regularMin.normals[sourceOffset + 1]
      + (mesh.regularMax.normals[sourceOffset + 1] - mesh.regularMin.normals[sourceOffset + 1]) * regularAmount,
    mesh.regularMin.normals[sourceOffset + 2]
      + (mesh.regularMax.normals[sourceOffset + 2] - mesh.regularMin.normals[sourceOffset + 2]) * regularAmount,
  );

  for (let component = 0; component < 3; component += 1) {
    const fittedPosition = mesh.fitted.positions[sourceOffset + component];
    const regularPosition = mesh.regularMin.positions[sourceOffset + component]
      + (mesh.regularMax.positions[sourceOffset + component]
        - mesh.regularMin.positions[sourceOffset + component]) * regularAmount;
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

const topBoundary = samplePanel([137.862, 152.3110570608], [
  { kind: "cubic", c1: [132.315, 148.2040570608], c2: [134.955, 136.8422343], end: [141.923, 136.3432343] },
  { kind: "line", end: [519.555, 113.0977657] },
  { kind: "cubic", c1: [531.588, 112.2347657], c2: [543.543, 113.628], end: [553.273, 120.522] },
  { kind: "line", end: [629.043, 174.203] },
  { kind: "cubic", c1: [631.918, 176.241], c2: [630.57, 179.2065641], end: [627.008, 179.4005641] },
  { kind: "line", end: [227.097, 204.0174359] },
  { kind: "cubic", c1: [214.994, 204.6754359], c2: [203.048, 198.7999429392], end: [193.425, 191.6759429392] },
  { kind: "line", end: [137.862, 152.3110570608] },
]);
const frontBoundary = samplePanel([208.339, 270.767], [
  { kind: "cubic", c1: [208.339, 257.775], c2: [218.835, 247.044], end: [232.257, 246.313] },
  { kind: "line", end: [655.075, 223.286] },
  { kind: "cubic", c1: [668.158, 222.574], c2: [679.168, 232.633], end: [679.168, 245.295] },
  { kind: "line", end: [679.168, 627.132] },
  { kind: "cubic", c1: [679.168, 640.1], c2: [668.71, 650.82], end: [655.315, 651.582] },
  { kind: "line", end: [235.172, 675.487] },
  { kind: "cubic", c1: [220.615, 676.317], c2: [208.339, 665.13], end: [208.339, 651.037] },
  { kind: "line", end: [208.339, 270.767] },
]);

const fittedTopBoundary = topBoundary.flatMap((screen) =>
  raycastFittedScreen(screen, mesh.fitted.positions)
);
const fittedFrontBoundary = frontBoundary.flatMap((screen) =>
  raycastFittedScreen(screen, mesh.fitted.positions)
);
const fittedGlyph = FITTED_GLYPH_SCREEN.flatMap((screen) =>
  raycastFittedScreen(screen, mesh.fitted.positions)
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

writeFileSync(OUTPUT_PATH, output);
console.log(JSON.stringify({
  output: OUTPUT_PATH,
  sourceSha256: sourceHash,
  vertexCount,
  packedBytes: packed.byteLength,
  maxPositionError,
}, null, 2));
