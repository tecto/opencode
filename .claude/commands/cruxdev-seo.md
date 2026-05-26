# /cruxdev-seo — SEO health check

Run comprehensive SEO health checks against a domain. Checks robots.txt, sitemap, llms.txt, security headers, HTTPS, key pages, meta tags, and internal links.

## Arguments

$ARGUMENTS = domain to check (e.g., cruxdev.dev)

## Protocol

1. Call `check_seo_health(domain)` — returns full health report
2. Call `check_pagespeed(url, strategy="mobile")` — returns PageSpeed scores
3. Display results, highlight failures
4. If regressions detected, flag them prominently
