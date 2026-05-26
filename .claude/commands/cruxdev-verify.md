# /cruxdev-verify — Post-deployment verification

Run health checks against a deployed URL. Verifies HTTP status, SSL, security headers, response time.

## Arguments

$ARGUMENTS = URL to verify (e.g., https://cruxdev.dev)

## Protocol

Call `verify_deployment(url, check_paths)` with the URL and key paths.

Check paths should include at minimum: /, /blog/, and any critical routes.

Report pass/fail for each check. Flag any failures as findings.
