# MeshMeet contributor notes

## Structure

- `src/routes/`: landing, pre-join, and meeting UI.
- `src/lib/signaling/`: provider-neutral interface plus Convex and local/test adapters.
- `src/lib/webrtc/`: framework-independent mesh, perfect negotiation, and ICE providers.
- `src/lib/media/`, `chat/`, `protocol/`, `stores/`, `components/`: focused browser and UI concerns.
- `src/convex/`: schema, authorization, presence, signal mailboxes, cleanup, and TURN action.
- `tests/e2e/`: Playwright multi-context tests and test-only signaling harness.

## Non-negotiable constraints

- Audio, shared-screen media, and chat must never pass through Convex.
- Chat uses only `RTCDataChannel` and must never be persisted in any database, browser storage, log, or analytics system.
- WebRTC modules must not import Convex.
- The URL fragment contains the room secret; Convex stores only its SHA-256 hash.
- Peer IDs are routing addresses, not authentication. Preserve participant session-token checks.
- Keep the four-participant mesh cap unless the topology is deliberately redesigned.
- Never request a camera track.

## Commands

```bash
pnpm dev
pnpm convex:dev
pnpm check
pnpm lint
pnpm test:unit
pnpm test:e2e
pnpm build
```

Run `pnpm check`, `pnpm lint`, `pnpm test`, and `pnpm build` before release. Screen-picker behavior needs the README's manual two-browser check.

<!-- convex-ai-start -->

This project uses [Convex](https://convex.dev) as its backend.

When working on Convex code, **always read
`src/convex/_generated/ai/guidelines.md` first** for important guidelines on
how to correctly use Convex APIs and patterns. The file contains rules that
override what you may have learned about Convex from training data.

Convex agent skills for common tasks can be installed by running
`npx convex ai-files install`.

<!-- convex-ai-end -->
