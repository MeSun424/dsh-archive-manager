import test from 'node:test'
import assert from 'node:assert/strict'
import { buildArchiveGroups, groupSessionIds } from '../src/archive-view.js'

test('Empty archived projects remain visible and can be searched and filtered', () => {
  const snapshots = [{ workspaceId: 'empty', title: 'Empty Project', path: '/example', pathAvailable: false, sessionIds: [] }]
  const groups = buildArchiveGroups([], snapshots, 'all', '')
  assert.equal(groups[0].archivedWorkspace, true)
  assert.equal(groups[0].missing, true)
  assert.equal(buildArchiveGroups([], snapshots, 'empty', 'project').length, 1)
  assert.equal(buildArchiveGroups([], snapshots, 'none', '').length, 0)
  assert.equal(buildArchiveGroups([], snapshots, 'all', 'unmatched').length, 0)
})

test('Deleting a project includes its hidden archives and excludes other projects', () => {
  const archivedIds = ['visible', 'hidden', 'other', 'ungrouped']
  const projectBySession = new Map([
    ['visible', { workspaceId: 'project' }], ['hidden', { workspaceId: 'project' }],
    ['other', { workspaceId: 'other' }],
  ])
  assert.deepEqual(groupSessionIds('project', archivedIds, projectBySession), ['visible', 'hidden'])
  assert.deepEqual(groupSessionIds('none', archivedIds, projectBySession), ['ungrouped'])
})
