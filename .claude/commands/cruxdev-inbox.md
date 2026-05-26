# /cruxdev-inbox — Check messages from other CruxDev sessions

Check for issues, improvements, patterns, and breaking changes reported by other projects in the ecosystem.

## Arguments

$ARGUMENTS = project name (optional — auto-detected from current directory)

## Protocol

### Step 1: Check inbox

Call `check_inbox($ARGUMENTS)` to get all unacknowledged messages.

### Step 2: Process each message

For each message:
- **issue**: Read the issue. If it applies to this project, investigate and fix it. If not, acknowledge and move on.
- **improvement**: Evaluate the suggestion. If valuable, create a build plan or implement immediately. Acknowledge either way.
- **pattern**: Read the pattern. If applicable, adopt it. Log it in your project's knowledge.
- **breaking_change**: This is urgent. Read the description, identify what needs to change in this project, and fix it immediately.

### Step 3: Acknowledge

After handling each message, call `acknowledge_message(message_id)`.

### Step 4: Report

Tell the user:
- How many messages were in the inbox
- What was handled and what action was taken
- Any breaking changes that require immediate attention
