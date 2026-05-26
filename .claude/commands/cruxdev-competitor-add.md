# /cruxdev-competitor-add — Manually add a competitor to track

Add a competitor that you've identified to the project's competitive analysis.

## Arguments

$ARGUMENTS = competitor name and URL (e.g., "Superpowers https://github.com/superpowers/superpowers")

If only a name is given, search for the URL.

## Protocol

### Step 1: Parse input

Extract competitor name and URL from $ARGUMENTS.

### Step 2: Deep research

Research the competitor following `docs/COMPETITORS_PATTERN.md` Phase 2:
- Identity: name, URL, GitHub, license, pricing, community size
- Product: description, key features, architecture, platforms
- Traction: stars, downloads, community activity
- Strengths: what they do well (be honest)
- Weaknesses: what they do poorly

Verify every claim. Test every link.

### Step 3: Score and classify

Score the competitor on the 5 dimensions from COMPETITORS_PATTERN.md Phase 3 (relevance, threat, mindshare, learning, differentiation). Recommend a tier: official (≥15), watch (10-14), or noted (<10).

### Step 4: Gap analysis

Build the feature comparison matrix against this competitor. Classify each gap: must-close, should-close, nice-to-have, intentional, or moat.

### Step 5: Update COMPETITORS.md

Add the competitor to `docs/COMPETITORS.md`:
- Add profile in the appropriate tier section
- Update the feature matrix
- Add any must-close/should-close gaps to the gap closure queue

If `docs/COMPETITORS.md` doesn't exist, create it from the template in COMPETITORS_PATTERN.md.

### Step 6: Generate comparison page

If the competitor is tier "official":
- Generate a `/vs/<competitor-slug>` comparison page for the project website
- Follow the comparison page structure from COMPETITORS_PATTERN.md Section 6.1
- Include SEO: title tag, meta description, Schema.org FAQPage

### Step 7: Generate gap closure plans

For each "must close" gap:
- Create `build_plans/BUILD_PLAN_NNN_GAP_<competitor>_<feature>.md`
- Auto-converge it (no user approval needed)

For each "should close" gap:
- Create `build_plans/BUILD_PLAN_NNN_GAP_<competitor>_<feature>.md`
- Auto-converge it

### Step 8: Report

Show the user:
- Competitor profile summary
- Tier recommendation and score
- Feature matrix (your project vs this competitor)
- Gaps identified and their classification
- Build plans generated (if any)
- Comparison page generated (if official tier)
