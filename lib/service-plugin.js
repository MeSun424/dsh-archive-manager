import ArchiveManagerService from './archive-service.js'

export const name = 'dsh-archive-manager-service'
export const inject = ['workspaceRegistry', 'sessionPersistence', 'sessions', 'agents']

export function apply(ctx) {
  new ArchiveManagerService(ctx)
}
