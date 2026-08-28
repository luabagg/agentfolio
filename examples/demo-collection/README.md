# Demo collection

This collection's adapter is trusted executable code. It receives one JSON protocol request on stdin and intentionally reports rather than writes project-local configuration.

```sh
node ../../bin/agentfolio.mjs plan --collection .
node ../../bin/agentfolio.mjs apply --dry-run --collection .
```
