/**
 * Search Module Exports
 */

export { SearchCoordinator } from './coordinator';
export { KeywordMatcher } from './tier1-keyword-match';
export { FuzzySearcher } from './tier2-fuzzy-search';
export type { ResourceCandidate, ScoredResult } from './tier1-keyword-match';
