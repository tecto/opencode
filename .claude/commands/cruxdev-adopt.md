# /cruxdev-adopt — Adopt or re-audit a project

First run: full Key-compatible adoption. Subsequent runs: audit for gaps and fix them.

## Arguments

$ARGUMENTS = the project directory path (default: current directory)

## Protocol

### Step 0: Detect mode

Check if `.cruxdev/` and `intake-classification.md` exist:
- **Neither exists** → INSTALL MODE (first adoption)
- **Both exist** → AUDIT MODE (re-run as gap check)

---

## INSTALL MODE

### I-1: Classify the project

Determine project type(s) and maturity:

**Types** (check all that apply):
software-existing, software-greenfield, business-existing, business-new,
product-saas, website, infrastructure, consulting-client, research, campaign

**Maturity**: idea (0) → minimal (1) → growing (2) → production (3) → mature (4)

Create `intake-classification.md` with: name, date, types, template categories, maturity, source locations.

### I-2: Inventory everything

Scan all documents, code, configs, assets. Record in `intake-inventory.md`:
- File path, format, last modified, quality (usable/reference-only/extract-info/obsolete), template match

### I-3: Install Crux + CruxDev

- Install Crux: `adopt_project()` from `/Users/user/personal/crux/scripts/lib/crux_adopt.py`
- Install CruxDev: `install_cruxdev()` MCP tool
- Register with session bus: `session_register(project_name)`

### I-4: Create GAPS.md

Compare inventory against Key template requirements for this project type + maturity.
Create `docs/GAPS.md` with: critical gaps, stub documents, known deficiencies, not-applicable.

### I-5: Create folder structure + stubs

Generate Key-compatible folder structure for this project type.
Create stub documents for all required templates at this maturity level.
Add YAML frontmatter to every document: title, last_updated, source, migration_status.

### I-6: Configure

- Create `.claude/CLAUDE.md` if missing
- Find and verify test commands
- Configure coverage enforcement

### I-7: Save adoption state

Write `.cruxdev/adoption_state.json` with: classification, inventory hash, gap counts, key-readiness status, timestamp.

### I-8: Report

Classification, documents inventoried, gaps by priority, Key-readiness, next steps.

---

## AUDIT MODE

### A-1: Re-classify — has type or maturity changed?
### A-2: Re-inventory — new/deleted/changed documents
### A-3: Re-check gaps — compare against template requirements, update GAPS.md
### A-4: Check document health — drift, staleness, frontmatter, cross-references
### A-5: Check Key-readiness — all criteria verified
### A-6: Auto-fix — missing frontmatter, folder structure, stale timestamps, stub creation
### A-7: Update adoption state
### A-8: Report delta — issues found, gaps closed/opened, Key-readiness status

---

## Key-Readiness Criteria

- [ ] `intake-classification.md` current
- [ ] `intake-inventory.md` accounts for all materials
- [ ] `docs/GAPS.md` current, all gaps classified
- [ ] All CRITICAL gaps resolved
- [ ] All HIGH gaps have remediation plan
- [ ] Folder structure matches Key templates
- [ ] All required docs for maturity level exist
- [ ] All docs have YAML frontmatter
- [ ] Zero phantom references
