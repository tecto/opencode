import { Config } from "@/config/config"
import { Provider } from "@/provider/provider"
import { Schema } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiError, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { Authorization } from "../middleware/authorization"
import { InstanceContextMiddleware } from "../middleware/instance-context"
import { WorkspaceRoutingMiddleware, WorkspaceRoutingQuery } from "../middleware/workspace-routing"
import { described } from "./metadata"

const root = "/config"

const ProjectAgentModel = Schema.Struct({
  providerID: Schema.String,
  modelID: Schema.String,
})

const ModelWriteTargetResponse = Schema.Union([
  Schema.Struct({
    mode: Schema.Literal("user"),
    refusedPath: Schema.optional(Schema.String),
    refusedReason: Schema.optional(Schema.String),
  }),
  Schema.Struct({
    mode: Schema.Literal("project"),
    path: Schema.String,
    source: Schema.Literals([
      "OPENCODE_CONFIG",
      "OPENCODE_CONFIG_DIR",
      "existing_file",
      "existing_dot_opencode",
      "scaffolded",
    ]),
  }),
]).annotate({ identifier: "ModelWriteTarget" })

const UpdateProjectRequest = Schema.Struct({
  targetPath: Schema.String,
  models: Schema.Record(Schema.String, ProjectAgentModel),
}).annotate({ identifier: "UpdateProjectRequest" })

export const ConfigApi = HttpApi.make("config")
  .add(
    HttpApiGroup.make("config")
      .add(
        HttpApiEndpoint.get("get", root, {
          query: WorkspaceRoutingQuery,
          success: described(Config.Info, "Get config info"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "config.get",
            summary: "Get configuration",
            description: "Retrieve the current OpenCode configuration settings and preferences.",
          }),
        ),
        HttpApiEndpoint.patch("update", root, {
          query: WorkspaceRoutingQuery,
          payload: Config.Info,
          success: described(Config.Info, "Successfully updated config"),
          error: HttpApiError.BadRequest,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "config.update",
            summary: "Update configuration",
            description: "Update OpenCode configuration settings and preferences.",
          }),
        ),
        HttpApiEndpoint.get("providers", `${root}/providers`, {
          query: WorkspaceRoutingQuery,
          success: described(Provider.ConfigProvidersResult, "List of providers"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "config.providers",
            summary: "List config providers",
            description: "Get a list of all configured AI providers and their default models.",
          }),
        ),
        HttpApiEndpoint.get("modelWriteTarget", `${root}/model_write_target`, {
          query: WorkspaceRoutingQuery,
          success: described(ModelWriteTargetResponse, "Resolved project-config write target"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "config.modelWriteTarget",
            summary: "Resolve model write target",
            description: "Compute where TUI model selections should be persisted (project config, scaffold, or user-only mode).",
          }),
        ),
        HttpApiEndpoint.post("updateProject", `${root}/update_project`, {
          query: WorkspaceRoutingQuery,
          payload: UpdateProjectRequest,
          success: described(Schema.Boolean, "Project config updated"),
          error: HttpApiError.BadRequest,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "config.updateProject",
            summary: "Update project config models",
            description: "Persist the given per-agent model selections to the specified project config file.",
          }),
        ),
      )
      .annotateMerge(
        OpenApi.annotations({
          title: "config",
          description: "Experimental HttpApi config routes.",
        }),
      )
      .middleware(InstanceContextMiddleware)
      .middleware(WorkspaceRoutingMiddleware)
      .middleware(Authorization),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "opencode experimental HttpApi",
      version: "0.0.1",
      description: "Experimental HttpApi surface for selected instance routes.",
    }),
  )
