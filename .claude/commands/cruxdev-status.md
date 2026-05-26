# /cruxdev-status — Check CruxDev installation health

Run all health checks and report what's working and what's not.

## Protocol

Call `cruxdev_status()` and display:

1. **Health status** — overall healthy or not
2. **Checks** — each check with pass/fail and message
3. **Warnings** — non-critical issues (e.g., Crux not configured)
4. **Active convergences** — any in-progress convergence runs
5. **Versions** — Python version, CruxDev root path

If any check fails, suggest how to fix it.
