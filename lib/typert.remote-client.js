import z from 'zod'

const sessionIdSchema = z.string().min(1)
const workspaceIdSchema = z.string().min(1)
const actionRequestSchema = z.object({ sessionId: sessionIdSchema }).strict()
const workspaceRequestSchema = z.object({ workspaceId: workspaceIdSchema }).strict()
const workspacePathRequestSchema = z.object({ workspaceId: workspaceIdSchema, path: z.string().min(1) }).strict()
const deleteManyRequestSchema = z.object({
  sessionIds: z.array(sessionIdSchema).min(1).optional(),
}).strict()
const emptyRequestSchema = z.object({}).strict()
const codec = (typeSymbol, schema) => ({ mode: 'strict', typeSymbol, schema })
const liveResult = codec('dsh-archive-manager#ArchiveLiveResult', z.object({
  liveSessionIds: z.array(sessionIdSchema),
}).strict())
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
const workspaceResult = codec('dsh-archive-manager#ArchiveWorkspaceResult', z.object({
  archivedSessionIds: z.array(sessionIdSchema),
  archivedSessions: z.array(z.object({
    id: sessionIdSchema,
    title: z.string().min(1),
    displayTitle: z.string().min(1).optional(),
    createdAt: z.number().nonnegative(),
    updatedAt: z.number().nonnegative(),
    cwd: z.string().optional(),
  }).strict()).optional(),
  archivedWorkspaces: z.array(z.object({
    workspaceId: workspaceIdSchema,
    path: z.string().min(1),
    title: z.string().min(1),
    sessionIds: z.array(sessionIdSchema),
    preArchivedSessionIds: z.array(sessionIdSchema),
    createdAt: z.string().min(1),
    updatedAt: z.string().min(1),
    archivedAt: z.string().min(1),
    registryOrder: z.number().int().nonnegative(),
    pathAvailable: z.boolean().optional(),
  }).strict()),
  workspaceId: workspaceIdSchema.optional(),
  workspaceMissing: z.boolean().optional(),
  workspacePath: z.string().optional(),
  workspaceTitle: z.string().optional(),
  workspaceRelocated: z.boolean().optional(),
  restoredSessionIds: z.array(sessionIdSchema).optional(),
}).strict())

export const TYPERT_REMOTE = {
  package: 'dsh-archive-manager',
  descriptors: [
    {
      id: 'dsh-archive-manager#archiveManager/archiveSession',
      service: 'archiveManager',
      namespace: 'archiveManager',
      method: 'archiveSession',
      invocation: { kind: 'direct' },
      parameters: [requestParameter(actionRequestSchema, 'dsh-archive-manager#ArchiveActionRequest')],
      result,
    },
    {
      id: 'dsh-archive-manager#archiveManager/archiveWorkspace',
      service: 'archiveManager',
      namespace: 'archiveManager',
      method: 'archiveWorkspace',
      invocation: { kind: 'direct' },
      parameters: [requestParameter(workspaceRequestSchema, 'dsh-archive-manager#ArchiveWorkspaceRequest')],
      result: workspaceResult,
    },
    {
      id: 'dsh-archive-manager#archiveManager/restoreWorkspace',
      service: 'archiveManager',
      namespace: 'archiveManager',
      method: 'restoreWorkspace',
      invocation: { kind: 'direct' },
      parameters: [requestParameter(workspaceRequestSchema, 'dsh-archive-manager#ArchiveWorkspaceRequest')],
      result: workspaceResult,
    },
    {
      id: 'dsh-archive-manager#archiveManager/archives',
      service: 'archiveManager',
      namespace: 'archiveManager',
      method: 'archives',
      invocation: { kind: 'direct' },
      parameters: [requestParameter(emptyRequestSchema, 'dsh-archive-manager#ArchiveArchivesRequest')],
      result: workspaceResult,
    },
    {
      id: 'dsh-archive-manager#archiveManager/restoreWorkspaceAt',
      service: 'archiveManager',
      namespace: 'archiveManager',
      method: 'restoreWorkspaceAt',
      invocation: { kind: 'direct' },
      parameters: [requestParameter(workspacePathRequestSchema, 'dsh-archive-manager#ArchiveWorkspaceAtRequest')],
      result: workspaceResult,
    },
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
    {
      id: 'dsh-archive-manager#archiveManager/live',
      service: 'archiveManager',
      namespace: 'archiveManager',
      method: 'live',
      invocation: { kind: 'direct' },
      parameters: [requestParameter(emptyRequestSchema, 'dsh-archive-manager#ArchiveLiveRequest')],
      result: liveResult,
    },
  ],
}

export default TYPERT_REMOTE
