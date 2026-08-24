# Machine profiles

Keep credentials out of this file. Store only non-secret connection metadata and dedicated identity paths or SSH aliases.

Each usable profile must define a selector, host or SSH alias, user, dedicated identity, `IdentitiesOnly=yes`, and verification status. An incomplete profile is not authorization to guess or try default credentials.

## 36

- Selectors: `36`, `192.168.48.36`
- Host: `192.168.48.36`
- User: `root`
- Identity file: `~/.ssh/codex_36_key`
- Identities only: `yes`
- Status: verified
- Stack hint: Docker and Docker Compose under `/root/proxima-compose`
- Runtime container hint: `proxima-compose_apps-runtime-server_1`
- Apps container hint: `proxima-compose_gitee-apps-server_1`
- Core container hint: `proxima-compose_gitee-proxima-core_1`
- Log-file hints: `/root/proxima-compose/core.log`, `/root/t.log`
- Remote search hint: `grep` is more portable than `rg`

For test-plan export debugging, search runtime logs first for `test-plan-export-debug`, `test-manager-export`, or `test_manager`.

## 33

- Selectors: `33`, `192.168.48.33`
- Host: `192.168.48.33`
- Observed hostname: `instance-1vyo3q84-06`
- User: `root`
- Identity file: `~/.ssh/codex_33_key`
- Identities only: `yes`
- Status: verified
- Stack hint: Docker and Docker Compose under `/root/proxima-compose`
- Runtime container hint: `proxima-compose_apps-runtime-server_1`
- Apps container hint: `proxima-compose_gitee-apps-server_1`
- Core container hint: `proxima-compose_gitee-proxima-core_1`
- Remote search hint: use `grep`; `rg` was not found

## 37

- Selectors: `37`, `192.168.48.37`
- Host: `192.168.48.37`
- User: not configured
- Dedicated identity or SSH alias: not configured
- Status: incomplete; do not connect until the missing fields are supplied and verified

## Adding a machine

Add a profile only from user-provided or locally verified SSH configuration. Before marking it verified:

1. Check effective settings with `ssh -G` without exposing secrets.
2. Confirm host, user, identity path, and `IdentitiesOnly=yes`.
3. Run a bounded, read-only check using `BatchMode=yes` and `ConnectTimeout=6`.
4. Record runtime and log hints only after observing them on that machine.
