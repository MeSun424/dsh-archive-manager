import { registerHooks, createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { join } from 'node:path'

const runtime = process.env.DSH_DESKTOP_RUNTIME
if (!runtime) throw new Error('DSH_DESKTOP_RUNTIME is required')
const requireRuntime = createRequire(join(runtime, 'package.json'))
let resolving = false
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (!resolving && !context.parentURL?.startsWith(pathToFileURL(runtime + '/').href)
      && (specifier.startsWith('@deepseek-ai/') || specifier === 'zod')) {
      resolving = true
      let path
      try { path = requireRuntime.resolve(specifier) } finally { resolving = false }
      return nextResolve(pathToFileURL(path).href, context)
    }
    return nextResolve(specifier, context)
  },
})
