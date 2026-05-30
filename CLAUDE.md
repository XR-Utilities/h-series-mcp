# h-series-mcp

Public passthrough MCP server exposing the H-Series APIs (H-Index registry,
H-Seal receipts) as agent tools. Stateless: no database, no wallet, no secrets;
all security is delegated upstream to the backends.

## Security change discipline
This repo is PUBLIC and world-readable. After any change that creates, updates,
deletes, or disables/pauses code, do a focused security review of the diff. Do
NOT keep a security log in this repo. Security-log entries for changes here are
written to the private H-Grant repo as `MCP-SECURITY-LOG.md`; in practice this
repo is worked on from the H-Grant codespace where both are checked out, and the
master security architecture doc (`SECURITY-ARCHITECTURE.md`, private) is the
collector. Never put secrets, keys, or proprietary enforcement detail into this
public repo, in code, comments, logs, or docs.
