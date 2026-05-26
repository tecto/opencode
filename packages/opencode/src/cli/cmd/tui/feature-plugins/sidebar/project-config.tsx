import type { TuiPlugin, TuiPluginApi } from "@opencode-ai/plugin/tui"
import type { InternalTuiPlugin } from "../../plugin/internal"
import { useLocal } from "@tui/context/local"
import { Show } from "solid-js"

const id = "internal:sidebar-project-config"

function View(props: { api: TuiPluginApi }) {
  const local = useLocal()
  const theme = () => props.api.theme.current
  const failing = () => local.model.projectWriteFailing()

  return (
    <Show when={failing()}>
      <box flexDirection="row" gap={1}>
        <text flexShrink={0} fg={theme().error}>
          •
        </text>
        <text fg={theme().textMuted}>project config: write failing</text>
      </box>
    </Show>
  )
}

const tui: TuiPlugin = async (api) => {
  api.slots.register({
    order: 310,
    slots: {
      sidebar_content() {
        return <View api={api} />
      },
    },
  })
}

const plugin: InternalTuiPlugin = {
  id,
  tui,
}

export default plugin
