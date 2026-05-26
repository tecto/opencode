import { Config } from "@/config/config"
import { ConfigPaths } from "@/config/paths"
import { Provider } from "@/provider/provider"
import * as InstanceState from "@/effect/instance-state"
import { Effect } from "effect"
import { HttpApiBuilder, HttpApiError } from "effect/unstable/httpapi"
import { InstanceHttpApi } from "../api"
import { markInstanceForDisposal } from "../lifecycle"

export const configHandlers = HttpApiBuilder.group(InstanceHttpApi, "config", (handlers) =>
  Effect.gen(function* () {
    const providerSvc = yield* Provider.Service
    const configSvc = yield* Config.Service

    const get = Effect.fn("ConfigHttpApi.get")(function* () {
      return yield* configSvc.get()
    })

    const update = Effect.fn("ConfigHttpApi.update")(function* (ctx) {
      yield* configSvc.update(ctx.payload)
      yield* markInstanceForDisposal(yield* InstanceState.context)
      return ctx.payload
    })

    const providers = Effect.fn("ConfigHttpApi.providers")(function* () {
      const providers = yield* providerSvc.list()
      return {
        providers: Object.values(providers).map(Provider.toPublicInfo),
        default: Provider.defaultModelIDs(providers),
      }
    })

    const modelWriteTarget = Effect.fn("ConfigHttpApi.modelWriteTarget")(function* () {
      const ctx = yield* InstanceState.context
      return yield* ConfigPaths.resolveModelWriteTarget(ctx.directory, ctx.worktree).pipe(Effect.orDie)
    })

    const updateProject = Effect.fn("ConfigHttpApi.updateProject")(function* (ctx) {
      const { targetPath, models } = ctx.payload

      // Server-side defense in depth: re-resolve the canonical write target and reject
      // any targetPath that doesn't match — prevents an authenticated client (or a
      // compromised plugin) from clobbering arbitrary files like ~/.bashrc by supplying
      // a hand-crafted targetPath. audit-r11-f4.
      const instance = yield* InstanceState.context
      const resolved = yield* ConfigPaths.resolveModelWriteTarget(instance.directory, instance.worktree).pipe(
        Effect.orDie,
      )
      if (resolved.mode !== "project" || resolved.path !== targetPath) {
        return yield* Effect.fail(new HttpApiError.BadRequest())
      }

      const agent: Record<string, { model: string }> = {}
      for (const [name, m] of Object.entries(models) as Array<
        [string, { providerID: string; modelID: string }]
      >) {
        agent[name] = { model: `${m.providerID}/${m.modelID}` }
      }
      yield* configSvc.updateProject({ agent } as Config.Info, targetPath)
      // Force InstanceState rebuild on next request — audit f1-R2. Matches the existing
      // `update` handler pattern at handlers/config.ts:20.
      yield* markInstanceForDisposal(instance)
      return true
    })

    return handlers
      .handle("get", get)
      .handle("update", update)
      .handle("providers", providers)
      .handle("modelWriteTarget", modelWriteTarget)
      .handle("updateProject", updateProject)
  }),
)
