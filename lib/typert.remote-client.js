import z from 'zod'

const sessionIdSchema = z.string().min(1)
const actionRequestSchema = z.object({ sessionId: sessionIdSchema }).strict()
const deleteManyRequestSchema = z.object({
  sessionIds: z.array(sessionIdSchema).min(1).optional(),
}).strict()
const codec = (typeSymbol, schema) => ({ mode: 'strict', typeSymbol, schema })
const requestParameter = (schema, typeSymbol) => ({
  name: 'request',
  wire: 'request',
  source: 'json',
  codec: codec(typeSymbol, schema),
})
const result = codec('dsh-archive-manager#ArchiveActionResult', z.object({
  archivedSessionIds: z.array(sessionIdSchema),
  deletedSessionIds: z.array(sessionIdSchema),
  skipped: z.array(z.object({
    sessionId: sessionIdSchema,
    code: z.string().min(1),
    message: z.string(),
  }).strict()),
}).strict())

export const TYPERT_REMOTE = {
  package: 'dsh-archive-manager',
  descriptors: [
    {
      id: 'dsh-archive-manager#archiveManager/unarchive',
      service: 'archiveManager',
      namespace: 'archiveManager',
      method: 'unarchive',
      invocation: { kind: 'direct' },
      parameters: [requestParameter(actionRequestSchema, 'dsh-archive-manager#ArchiveActionRequest')],
      result,
    },
    {
      id: 'dsh-archive-manager#archiveManager/delete',
      service: 'archiveManager',
      namespace: 'archiveManager',
      method: 'delete',
      invocation: { kind: 'direct' },
      parameters: [requestParameter(actionRequestSchema, 'dsh-archive-manager#ArchiveActionRequest')],
      result,
    },
    {
      id: 'dsh-archive-manager#archiveManager/deleteMany',
      service: 'archiveManager',
      namespace: 'archiveManager',
      method: 'deleteMany',
      invocation: { kind: 'direct' },
      parameters: [requestParameter(deleteManyRequestSchema, 'dsh-archive-manager#ArchiveDeleteManyRequest')],
      result,
    },
  ],
}

export default TYPERT_REMOTE
