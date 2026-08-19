import z from 'zod'

const sessionIdSchema = z.string().min(1)
const actionRequestSchema = z.object({ sessionId: sessionIdSchema }).strict()
const deleteManyRequestSchema = z.object({
  sessionIds: z.array(sessionIdSchema).min(1).optional(),
}).strict()
const emptyRequestSchema = z.object({}).strict()
const skippedSchema = z.object({
  sessionId: sessionIdSchema,
  code: z.string().min(1),
  message: z.string(),
}).strict()
const actionResultSchema = z.object({
  archivedSessionIds: z.array(sessionIdSchema),
  deletedSessionIds: z.array(sessionIdSchema),
  skipped: z.array(skippedSchema),
}).strict()

const codec = (typeSymbol, schema) => ({ mode: 'strict', typeSymbol, schema })
const requestParameter = (schema, typeSymbol) => ({
  name: 'request',
  wire: 'request',
  source: 'json',
  codec: codec(typeSymbol, schema),
})

export const TYPERT = {
  package: 'dsh-archive-manager',
  face: 'host',
  schemas: [],
  invocations: [
    {
      id: 'dsh-archive-manager#archiveManager/unarchive',
      service: 'archiveManager',
      namespace: 'archiveManager',
      method: 'unarchive',
      invocation: { kind: 'direct' },
      parameters: [requestParameter(actionRequestSchema, 'dsh-archive-manager#ArchiveActionRequest')],
      result: codec('dsh-archive-manager#ArchiveActionResult', actionResultSchema),
    },
    {
      id: 'dsh-archive-manager#archiveManager/delete',
      service: 'archiveManager',
      namespace: 'archiveManager',
      method: 'delete',
      invocation: { kind: 'direct' },
      parameters: [requestParameter(actionRequestSchema, 'dsh-archive-manager#ArchiveActionRequest')],
      result: codec('dsh-archive-manager#ArchiveActionResult', actionResultSchema),
    },
    {
      id: 'dsh-archive-manager#archiveManager/deleteMany',
      service: 'archiveManager',
      namespace: 'archiveManager',
      method: 'deleteMany',
      invocation: { kind: 'direct' },
      parameters: [requestParameter(deleteManyRequestSchema, 'dsh-archive-manager#ArchiveDeleteManyRequest')],
      result: codec('dsh-archive-manager#ArchiveActionResult', actionResultSchema),
    },
  ],
  model: {
    services: [],
    events: [],
    objects: [],
  },
}

export default TYPERT
