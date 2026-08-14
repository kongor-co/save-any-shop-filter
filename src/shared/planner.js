export function topologicalSort(criteria) {
  const byId = new Map(criteria.map((criterion) => [criterion.criterionId, criterion]));
  const indegree = new Map(criteria.map((criterion) => [criterion.criterionId, 0]));
  const outgoing = new Map(criteria.map((criterion) => [criterion.criterionId, []]));

  for (const criterion of criteria) {
    for (const dependency of criterion.dependencies || []) {
      if (!byId.has(dependency)) throw new Error(`Unknown dependency: ${dependency}`);
      indegree.set(criterion.criterionId, indegree.get(criterion.criterionId) + 1);
      outgoing.get(dependency).push(criterion.criterionId);
    }
  }

  const ready = criteria.filter((criterion) => indegree.get(criterion.criterionId) === 0)
    .map((criterion) => criterion.criterionId).sort();
  const ordered = [];
  while (ready.length) {
    const id = ready.shift();
    ordered.push(byId.get(id));
    for (const next of outgoing.get(id).sort()) {
      indegree.set(next, indegree.get(next) - 1);
      if (indegree.get(next) === 0) {
        ready.push(next);
        ready.sort();
      }
    }
  }
  if (ordered.length !== criteria.length) throw new Error("DEPENDENCY_CYCLE");
  return ordered;
}
