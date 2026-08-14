# Nodex New Chat 3D mark model

The New Chat hero uses one fixed corrective-morph topology. At its canonical
orthographic pose, the fitted endpoint reproduces the dark body of the Nodex
mark. As the object rotates away from that pose, the same vertices become a
uniform-bevel rounded cube. White face panels and terminal glyphs are
shell-owned signed-distance fields, not textures or separate decal geometry.

`src/renderer/components/ui/nodex-home-mark-model.generated.ts` is the only
runtime payload. It contains 4,356 triangle-list vertices as one interleaved,
normalized `Int16` stream:

1. fitted position and normal;
2. regular position and normal at bevel `0.052`;
3. precomputed fitted top/front panel and glyph anchors.

The generated payload is lazy-loaded with the WebGL renderer. Do not import it
from the static React shell and do not hand-edit its base64 or anchor arrays.

To regenerate it from the approved research mesh:

    pnpm exec tsx scripts/generate-nodex-home-mark-runtime.ts \
      --source <path-to-corrective-morph-aligned-mesh.json>

The source mesh is a development artifact, not a runtime/build dependency. The
generator records its SHA-256 and quantization error in the generated module.
Regeneration must keep the triangle topology shared between both endpoints and
must not add runtime JSON fetches, raycasts, textures, framebuffer copies, or
additional draw calls.
