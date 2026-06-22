import { describe, expect, test } from "bun:test";

import { buildGeneratedUtilitiesCss } from "./sync-codex-theme-utilities";

describe("sync-codex-theme-utilities", () => {
  test("keeps allowlisted utility selectors and their support overrides", () => {
    const css = `
      @layer utilities {
        .duration-relaxed {
          --tw-duration: var(--transition-duration-relaxed);
          transition-duration: var(--transition-duration-relaxed);
        }

        .\\[\\&_\\*\\]\\:text-token-foreground\\/50 * {
          color: var(--color-token-foreground);
        }

        .ignored-utility {
          color: green;
        }

        @supports (color: color-mix(in lab, red, red)) {
          .\\[\\&_\\*\\]\\:text-token-foreground\\/50 * {
            color: color-mix(in oklab, var(--color-token-foreground) 50%, transparent);
          }

          .ignored-utility {
            color: lime;
          }
        }
      }
    `;

    const generatedCss = buildGeneratedUtilitiesCss(css);

    expect(generatedCss.includes(".duration-relaxed")).toBeTrue();
    expect(generatedCss.includes("--tw-duration: var(--transition-duration-relaxed);")).toBeTrue();
    expect(generatedCss.includes(".\\[\\&_\\*\\]\\:text-token-foreground\\/50 *")).toBeTrue();
    expect(
      generatedCss.includes(
        "color: color-mix(in oklab, var(--color-token-foreground) 50%, transparent);",
      ),
    ).toBeTrue();
    expect(generatedCss.includes(".ignored-utility")).toBeFalse();
    expect(generatedCss.includes("@supports (color: color-mix(in lab, red, red)) {\n    \n  }")).toBeFalse();
  });

  test("keeps allowlisted top-level utility selectors outside @layer blocks", () => {
    const css = `
      .icon-2xs {
        width: 14px;
        height: 14px;
      }

      .heading-dialog {
        font-size: var(--text-heading-md);
        letter-spacing: -0.36px;
        font-weight: 500;
        line-height: 28px;
      }

      .ignored-top-level {
        color: red;
      }
    `;

    const generatedCss = buildGeneratedUtilitiesCss(css);

    expect(generatedCss.includes(".icon-2xs")).toBeTrue();
    expect(generatedCss.includes("width: 14px;")).toBeTrue();
    expect(generatedCss.includes(".heading-dialog")).toBeTrue();
    expect(generatedCss.includes(".ignored-top-level")).toBeFalse();
  });

  test("drops reference font-face rules while preserving allowlisted utilities", () => {
    const css = `
      @font-face {
        font-family: KaTeX_Main;
        src: url("./KaTeX_Main-Regular-B22Nviop.woff2") format("woff2");
        font-weight: 400;
        font-style: normal;
      }

      .icon-2xs {
        width: 14px;
        height: 14px;
      }
    `;

    const generatedCss = buildGeneratedUtilitiesCss(css);

    expect(generatedCss.includes("@font-face")).toBeFalse();
    expect(generatedCss.includes("KaTeX_Main")).toBeFalse();
    expect(generatedCss.includes("KaTeX_Main-Regular-B22Nviop.woff2")).toBeFalse();
    expect(generatedCss.includes(".icon-2xs")).toBeTrue();
  });

  test("emits the toolbar padding utility when the reference css omits it", () => {
    const generatedCss = buildGeneratedUtilitiesCss(`
      @layer utilities {
        .ignored-utility {
          color: red;
        }
      }
    `);

    expect(generatedCss.includes(".px-toolbar")).toBeTrue();
    expect(generatedCss.includes("padding-inline: var(--padding-toolbar);")).toBeTrue();
    expect(generatedCss.includes(".ignored-utility")).toBeFalse();
  });

  test("keeps the complete Codex scroll fade mask utility family", () => {
    const generatedCss = buildGeneratedUtilitiesCss(`
      @layer components {
        @property --top-fade {
          syntax: "<length>";
          inherits: false;
          initial-value: 0;
        }

        @property --bottom-fade {
          syntax: "<length>";
          inherits: false;
          initial-value: 0;
        }

        @property --edge-fade-distance {
          syntax: "<length>";
          inherits: false;
          initial-value: 1rem;
        }

        @keyframes edge-fade {
          0% {
            --top-fade: 0;
            --bottom-fade: var(--edge-fade-distance, 1rem);
          }

          99% {
            --top-fade: var(--edge-fade-distance, 1rem);
            --bottom-fade: 0;
          }
        }

        @keyframes edge-fade-top {
          0% {
            --top-fade: var(--edge-fade-distance, 1rem);
            --bottom-fade: var(--edge-fade-distance, 1rem);
          }

          99% {
            --top-fade: var(--edge-fade-distance, 1rem);
            --bottom-fade: 0;
          }
        }

        @supports (animation-timeline: --scroll-fade) {
          .vertical-scroll-fade-mask {
            mask: linear-gradient(
              to bottom in oklch,
              oklch(60% 0 0/0),
              oklch(85% 0 0) var(--top-fade) calc(100% - var(--bottom-fade)),
              oklch(60% 0 0/0)
            );
            animation-name: edge-fade;
            animation-timeline: scroll(self y);
          }

          .vertical-scroll-fade-mask-top {
            mask: linear-gradient(
              to bottom in oklch,
              oklch(60% 0 0/0),
              oklch(85% 0 0) var(--top-fade) calc(100% - var(--bottom-fade)),
              oklch(60% 0 0/0)
            );
            animation-name: edge-fade-top;
            animation-timeline: scroll(self y);
          }
        }
      }
    `);

    expect(generatedCss.includes(".vertical-scroll-fade-mask")).toBeTrue();
    expect(generatedCss.includes(".vertical-scroll-fade-mask-top")).toBeTrue();
    expect(generatedCss.includes(".vertical-scroll-fade-mask-bottom")).toBeTrue();
    expect(generatedCss.includes(".horizontal-scroll-fade-mask")).toBeTrue();
    expect(generatedCss.includes("@property --left-fade")).toBeTrue();
    expect(generatedCss.includes("@property --right-fade")).toBeTrue();
    expect(generatedCss.includes("@keyframes edge-fade-bottom")).toBeTrue();
    expect(generatedCss.includes("@keyframes edge-fade-horizontal")).toBeTrue();
    expect(generatedCss.includes("animation-timeline: scroll(self y);")).toBeTrue();
    expect(generatedCss.includes("animation-timeline: scroll(self x);")).toBeTrue();
  });

  test("keeps allowlisted selectors from the Codex components layer", () => {
    const css = `
      @layer components {
        .icon-2xs {
          width: 14px;
          height: 14px;
        }

        .heading-dialog {
          font-size: var(--text-heading-md);
          letter-spacing: -0.36px;
          font-weight: 500;
          line-height: 28px;
        }

        .ignored-component-class {
          color: red;
        }
      }
    `;

    const generatedCss = buildGeneratedUtilitiesCss(css);

    expect(generatedCss.includes("@layer components")).toBeTrue();
    expect(generatedCss.includes(".icon-2xs")).toBeTrue();
    expect(generatedCss.includes(".heading-dialog")).toBeTrue();
    expect(generatedCss.includes(".ignored-component-class")).toBeFalse();
  });

  test("keeps shipped window-variant arbitrary property utility selectors", () => {
    const css = `
      @layer utilities {
        .electron\\:\\[--color-token-description-foreground\\:color-mix\\(in_srgb\\,var\\(--color-token-foreground\\)_70\\%\\,transparent\\)\\]:where([data-codex-window-type="electron"] .electron\\:\\[--color-token-description-foreground\\:color-mix\\(in_srgb\\,var\\(--color-token-foreground\\)_70\\%\\,transparent\\)\\]) {
          --color-token-description-foreground: var(--color-token-foreground);
        }

        @supports (color: color-mix(in lab, red, red)) {
          .electron\\:\\[--color-token-description-foreground\\:color-mix\\(in_srgb\\,var\\(--color-token-foreground\\)_70\\%\\,transparent\\)\\]:where([data-codex-window-type="electron"] .electron\\:\\[--color-token-description-foreground\\:color-mix\\(in_srgb\\,var\\(--color-token-foreground\\)_70\\%\\,transparent\\)\\]) {
            --color-token-description-foreground: color-mix(in srgb, var(--color-token-foreground) 70%, transparent);
          }
        }

        .browser\\:\\[--color-token-description-foreground\\:color-mix\\(in_srgb\\,var\\(--color-token-foreground\\)_90\\%\\,transparent\\)\\]:where([data-codex-window-type="browser"] .browser\\:\\[--color-token-description-foreground\\:color-mix\\(in_srgb\\,var\\(--color-token-foreground\\)_90\\%\\,transparent\\)\\]) {
          --color-token-description-foreground: var(--color-token-foreground);
        }

        .ignored-arbitrary {
          --some-token: red;
        }
      }
    `;

    const generatedCss = buildGeneratedUtilitiesCss(css);

    expect(generatedCss.includes('[data-codex-window-type="electron"]')).toBeTrue();
    expect(generatedCss.includes('[data-codex-window-type="browser"]')).toBeTrue();
    expect(
      generatedCss.includes(
        "--color-token-description-foreground: color-mix(in srgb, var(--color-token-foreground) 70%, transparent);",
      ),
    ).toBeTrue();
    expect(generatedCss.includes(".ignored-arbitrary")).toBeFalse();
  });
});
