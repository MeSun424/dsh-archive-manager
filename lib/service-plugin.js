import ArchiveManagerService from './archive-service.js'

export const name = 'dsh-archive-manager-service'
export const inject = ['workspaceRegistry', 'sessionPersistence', 'sessions', 'agents', 'storageDomain']

export async function apply(ctx) {
  const service = new ArchiveManagerService(ctx)
  await service.initialize()
}
