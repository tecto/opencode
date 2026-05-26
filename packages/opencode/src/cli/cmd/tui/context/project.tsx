import { batch } from "solid-js"
import type { ModelWriteTarget, Path, Workspace } from "@opencode-ai/sdk/v2"
import { createStore, reconcile } from "solid-js/store"
import { createSimpleContext } from "./helper"
import { useSDK } from "./sdk"
import { useToast } from "../ui/toast"

// Module-scope guard so the safety-rejection toast fires at most once per TUI process.
let safetyToastShown = false

type WorkspaceStatus = "connected" | "connecting" | "disconnected" | "error"

export const { use: useProject, provider: ProjectProvider } = createSimpleContext({
  name: "Project",
  init: () => {
    const sdk = useSDK()
    const toast = useToast()

    const defaultPath = {
      home: "",
      state: "",
      config: "",
      worktree: "",
      directory: sdk.directory ?? "",
    } satisfies Path

    const [store, setStore] = createStore({
      project: {
        id: undefined as string | undefined,
      },
      instance: {
        path: defaultPath,
        modelWriteTarget: undefined as ModelWriteTarget | undefined,
      },
      workspace: {
        current: undefined as string | undefined,
        list: [] as Workspace[],
        status: {} as Record<string, WorkspaceStatus>,
      },
    })

    async function sync() {
      const workspace = store.workspace.current
      const [path, project, modelWriteTarget] = await Promise.all([
        sdk.client.path.get({ workspace }),
        sdk.client.project.current({ workspace }),
        sdk.client.config.modelWriteTarget({ workspace }).catch(() => undefined),
      ])

      batch(() => {
        setStore("instance", "path", reconcile(path.data || defaultPath))
        setStore("project", "id", project.data?.id)
        setStore("instance", "modelWriteTarget", modelWriteTarget?.data)
      })

      // One-shot safety-rejection toast — fires only when resolver refused a target
      // (e.g. OPENCODE_CONFIG_DIR=/proc/foo, scaffold above $HOME).
      const target = modelWriteTarget?.data
      if (!safetyToastShown && target?.mode === "user" && target.refusedReason) {
        safetyToastShown = true
        toast.show({
          variant: "warning",
          message: `Project model config disabled: ${target.refusedReason}${target.refusedPath ? ` (${target.refusedPath})` : ""}`,
          duration: 4000,
        })
      }
    }

    async function syncWorkspace() {
      const listed = await sdk.client.experimental.workspace.list().catch(() => undefined)
      if (!listed?.data) return
      const status = await sdk.client.experimental.workspace.status().catch(() => undefined)
      const next = Object.fromEntries((status?.data ?? []).map((item) => [item.workspaceID, item.status]))

      batch(() => {
        setStore("workspace", "list", reconcile(listed.data))
        setStore("workspace", "status", reconcile(next))
        if (!listed.data.some((item) => item.id === store.workspace.current)) {
          setStore("workspace", "current", undefined)
        }
      })
    }

    sdk.event.on("event", (event) => {
      if (event.payload.type === "workspace.status") {
        setStore("workspace", "status", event.payload.properties.workspaceID, event.payload.properties.status)
      }
    })

    return {
      data: store,
      project() {
        return store.project.id
      },
      instance: {
        path() {
          return store.instance.path
        },
        directory() {
          return store.instance.path.directory
        },
        modelWriteTarget() {
          return store.instance.modelWriteTarget
        },
      },
      workspace: {
        current() {
          return store.workspace.current
        },
        set(next?: string | null) {
          const workspace = next ?? undefined
          if (store.workspace.current === workspace) return
          setStore("workspace", "current", workspace)
        },
        list() {
          return store.workspace.list
        },
        get(workspaceID: string) {
          return store.workspace.list.find((item) => item.id === workspaceID)
        },
        status(workspaceID: string) {
          return store.workspace.status[workspaceID]
        },
        statuses() {
          return store.workspace.status
        },
        sync: syncWorkspace,
      },
      sync,
    }
  },
})
