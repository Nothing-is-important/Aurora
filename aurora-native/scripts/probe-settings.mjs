// 探针：打印引擎 settings 描述（模型命名空间 schema/值/密钥槽）与默认模型选择
// 用法：electron scripts/probe-settings.mjs
import { app } from 'electron'
import { join } from 'node:path'
import { bootEngine, disposeEngine } from '../electron/engine.mjs'

const home = join(app.getPath('temp'), `aurora-dsh-settings-probe-${process.pid}`)

app.whenReady().then(async () => {
  try {
    const { ctx } = await bootEngine(home)
    const settings = ctx.settings
    const desc = settings.describe({ redactSecrets: true })

    const interesting = ['llm-deepseek', 'llm-pi-ai', 'agent-default-model']
    for (const ns of interesting) {
      const d = desc.find((x) => x.ns === ns)
      console.log(`===== ${ns} =====`)
      if (!d) {
        console.log('(not registered)')
        continue
      }
      console.log(
        JSON.stringify(
          {
            value: d.value,
            user: d.user,
            base: d.base,
            secrets: d.secrets,
            schemaKeys: d.schema ? Object.keys(d.schema.shape ?? d.schema ?? {}) : null,
          },
          null,
          2,
        ).slice(0, 3000),
      )
    }

    console.log('===== llm directory =====')
    try {
      console.log('listConfigurableProviders:', JSON.stringify(ctx.llm.listConfigurableProviders?.() ?? 'n/a'))
      console.log('listProviders:', JSON.stringify(ctx.llm.listProviders?.() ?? 'n/a'))
    } catch (e) {
      console.log('llm dir error:', e.message)
    }

    console.log('===== agentDefaultModel =====')
    try {
      console.log('currentSelection:', JSON.stringify(ctx.agentDefaultModel.currentSelection()))
    } catch (e) {
      console.log('selection error:', e.message)
    }

    await disposeEngine()
    app.exit(0)
  } catch (err) {
    console.error('[probe] FAILED:', err)
    app.exit(1)
  }
})
