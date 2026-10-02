export function groupSessionIds(projectId, archivedIds, projectBySession) {
  return archivedIds.map(String).filter((id) => {
    const project = projectBySession.get(id)
    return (project === undefined ? 'none' : String(project.workspaceId)) === projectId
  })
}

export function buildArchiveGroups(rows, snapshots, projectFilter, query) {
  const result = new Map()
  for (const row of rows) {
    const group = result.get(row.projectId) ?? {
      id: row.projectId, title: row.projectTitle, missing: row.workspaceMissing,
      archivedWorkspace: row.workspaceArchived, rows: [],
    }
    group.rows.push(row)
    result.set(row.projectId, group)
  }
  const needle = query.trim().toLocaleLowerCase()
  for (const snapshot of snapshots) {
    if (snapshot.sessionIds?.length !== 0) continue
    const id = String(snapshot.workspaceId)
    if (projectFilter !== 'all' && projectFilter !== id) continue
    const title = snapshot.title || '无项目'
    if (needle && ![title, snapshot.path, id].join(' ').toLocaleLowerCase().includes(needle)) continue
    result.set(id, { id, title, missing: snapshot.pathAvailable === false, archivedWorkspace: true, rows: [] })
  }
  return [...result.values()]
}
