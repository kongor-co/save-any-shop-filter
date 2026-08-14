export function isMeaningfulCriterion(criterion) {
  return criterion?.role === "FILTER" || criterion?.role === "PRESENTATION";
}

export function calculateCoverage({ criteria = [], unsupported = [], unresolved = [], defaultsIgnored = [], adapterId = "generic" } = {}) {
  const meaningful = criteria.filter(isMeaningfulCriterion);
  const captured = criteria.length;
  const activeDetected = captured + unsupported.length + unresolved.length;
  const saveEligible = meaningful.length > 0;
  const hasOmissions = unsupported.length > 0 || unresolved.length > 0;
  const allMeaningfulHaveSemanticEvidence = meaningful.length > 0 && meaningful.every((criterion) =>
    criterion.bindings?.some((binding) => binding.type === "DOM")
    || (adapterId !== "generic" && criterion.bindings?.some((binding) =>
      binding.verificationTexts?.length > 0
      && (binding.type === "URL_PATH" || (binding.type === "URL_QUERY" && binding.semanticEvidence === true)))));

  let supportLevel = "UNSUPPORTED";
  if (saveEligible && hasOmissions) supportLevel = "LIMITED";
  else if (saveEligible && adapterId !== "generic" && allMeaningfulHaveSemanticEvidence) supportLevel = "VERIFIED";
  else if (saveEligible) supportLevel = "COMPATIBLE";

  let saveReason = null;
  if (!saveEligible && criteria.some((criterion) => criterion.role === "CONTEXT")) {
    saveReason = "Only search or page context was detected; no active filter or non-default sort is available to save.";
  } else if (!saveEligible && (unsupported.length || unresolved.length)) {
    saveReason = "Active controls were detected, but none can be replayed safely on this page.";
  } else if (!saveEligible) {
    saveReason = "No active filter or non-default sort was detected.";
  }

  return {
    activeDetected,
    captured,
    meaningfulCaptured: meaningful.length,
    unsupported: unsupported.length,
    unresolved: unresolved.length,
    defaultsIgnored: defaultsIgnored.length,
    saveEligible,
    saveReason,
    supportLevel
  };
}
