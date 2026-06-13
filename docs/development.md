# Development

This document keeps contributor setup and local validation details out of the public README.

## Setup

Install dependencies from the repository root:

```bash
bun install
```

Start the desktop app in development mode:

```bash
bun run dev
```

Build the app:

```bash
bun run build
```

Package local macOS installers:

```bash
bun run package
```

## Validation

Run the standard checks before handing off code changes:

```bash
bun run typecheck
bun run lint
bun test
```

## Related Technical Docs

- [Architecture](../ARCHITECTURE.md)
- [Product specification](product-specs/nodex-product-spec.md)
- [Frontend conventions](FRONTEND.md)
- [Reliability model](RELIABILITY.md)
- [Security model](SECURITY.md)
- [macOS release CI](release-macos.md)
- [Landing site operations](landing-site.md)
