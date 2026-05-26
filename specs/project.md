## project

The goal is to let a single instance of OpenCode run sessions for multiple projects and different worktrees per project.

### api

```
GET /project -> Project[]

POST /project/init -> Project


GET /project/:projectID/session -> Session[]

GET /project/:projectID/session/:sessionID -> Session

POST /project/:projectID/session -> Session
{
  id?: string
  parentID?: string
  directory: string
}

DELETE /project/:projectID/session/:sessionID

POST /project/:projectID/session/:sessionID/init

POST /project/:projectID/session/:sessionID/abort

POST /project/:projectID/session/:sessionID/share

DELETE /project/:projectID/session/:sessionID/share

POST /project/:projectID/session/:sessionID/compact

GET /project/:projectID/session/:sessionID/message -> { info: Message, parts: Part[] }[]

GET /project/:projectID/session/:sessionID/message/:messageID -> { info: Message, parts: Part[] }

POST /project/:projectID/session/:sessionID/message -> { info: Message, parts: Part[] }

POST /project/:projectID/session/:sessionID/revert -> Session

POST /project/:projectID/session/:sessionID/unrevert -> Session

POST /project/:projectID/session/:sessionID/permission/:permissionID -> Session

GET /project/:projectID/session/:sessionID/find/file -> string[]

GET /project/:projectID/session/:sessionID/file -> { type: "raw" | "patch", content: string }

GET /project/:projectID/session/:sessionID/file/status -> File[]

POST /log

// These are awkward

GET /provider?directory=<resolve path> -> Provider
GET /config?directory=<resolve path> -> Config // think only tui uses this?

// BP-001: TUI model persistence to project opencode config
GET /config/model_write_target -> ResolvedTarget
  // { mode: "user" } | { mode: "user", refusedPath, refusedReason } | { mode: "project", path, source }
  // where source is one of: OPENCODE_CONFIG | OPENCODE_CONFIG_DIR | existing_file | existing_dot_opencode | scaffolded
  // refusedReason is a human-readable string (e.g. "path under /proc", "path is outside worktree and outside $HOME", "not writable: <dir>") — NOT a stable machine-readable enum.
  // Computed server-side via ConfigPaths.resolveModelWriteTarget with path-safety validation.

POST /config/update_project -> boolean
{
  targetPath: string  // must match the canonical resolveModelWriteTarget output for this instance — server re-resolves and 400s on mismatch (defense in depth)
  models: Record<agentName, { providerID: string; modelID: string }>
}
  // Translates payload to a partial Config.Info { agent: { [name]: { model: "${providerID}/${modelID}" } } }
  // and calls Config.updateProject which preserves .jsonc comments + invalidates InstanceState
  // so the next config GET sees the write.
  // When OPENCODE_DISABLE_PROJECT_CONFIG is set, resolveModelWriteTarget returns {mode: "user"} and the
  // targetPath-mismatch check returns 400 — clients should treat this as any other write-target rejection,
  // not as a flag they need to special-case.

GET /project/:projectID/agent?directory=<resolve path> -> Agent
GET /project/:projectID/find/file?directory=<resolve path> -> File

```
