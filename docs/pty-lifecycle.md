# PTY integration and lifecycle

`src/server/spawn/index.ts` handles terminal resize, input and flow control for all SSH and local login modes.
By default it launches commands through `/usr/bin/env`. Browser SSH can supply a per-session environment to launch
an executable with its literal argument list. The global environment and shared terminal options stay unchanged.

`src/server/session.ts` owns PTY resources and socket listeners. A disconnect or session cancellation releases
those resources and terminates the child. On normal exit, the PTY flushes buffered output before emitting logout.
Browser SSH then closes the private agent and known-hosts sockets.

## Verification

```bash
pnpm test
pnpm test:pty
pnpm test:browser-key
pnpm lint
```

The PTY integration suite requires Unix `/bin/sh`, coreutils and a working node-pty installation.
The SSH integration suite uses OpenSSH to check key login, password fallback, host trust and forwarding.
