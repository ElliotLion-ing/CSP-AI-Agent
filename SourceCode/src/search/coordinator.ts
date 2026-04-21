/**
 * Search Coordinator
 * Orchestrates Tier 1 + Tier 2 search and merges results
 */

import { logger } from '../utils/logger';
import { KeywordMatcher } from './tier1-keyword-match';
import { FuzzySearcher } from './tier2-fuzzy-search';
import type { ResourceCandidate, ScoredResult } from './tier1-keyword-match';

export class SearchCoordinator {
  private tier1: KeywordMatcher;
  private tier2: FuzzySearcher;

  constructor() {
    this.tier1 = new KeywordMatcher();
    this.tier2 = new FuzzySearcher();
  }

  /**
   * Merge results from multiple tiers (dedup + keep highest score)
   */
  private mergeResults(resultSets: ScoredResult[][]): ScoredResult[] {
    const resultMap = new Map<string, ScoredResult>(); // key: resource.id

    for (const results of resultSets) {
      for (const result of results) {
        const existing = resultMap.get(result.id);

        if (existing) {
          // Keep higher score, same score prefer lower tier (higher priority)
          if (
            result.score > existing.score ||
            (result.score === existing.score && result.match_tier < existing.match_tier)
          ) {
            resultMap.set(result.id, result);
          }
        } else {
          resultMap.set(result.id, result);
        }
      }
    }

    // Sort: score desc → tier asc → name alpha
    return Array.from(resultMap.values()).sort((a, b) => {
      if (a.score !== b.score) return b.score - a.score;
      if (a.match_tier !== b.match_tier) return a.match_tier - b.match_tier;
      return a.name.localeCompare(b.name);
    });
  }

  /**
   * Execute enhanced search (two-tier architecture)
   * 
   * Strategy:
   * 1. Tier 1: Precise keyword matching
   * 2. If Tier 1 has enough high-quality results (≥3 and top score ≥70), return directly
   * 3. Otherwise, run Tier 2 fuzzy search to supplement
   * 4. Merge and deduplicate
   * 5. Filter very low scores (< 20)
   */
  enhancedSearch(
    query: string,
    apiResults: ResourceCandidate[],
    maxResults: number = 10
  ): ScoredResult[] {
    logger.info({ query, candidateCount: apiResults.length }, 'Enhanced search started');

    // 1. Tier 1: Precise keyword matching
    const tier1Results = this.tier1.search(query, apiResults);

    // Filter low scores immediately
    const tier1Filtered = tier1Results.filter((r) => r.score >= 20);

    // If Tier 1 has enough high-quality results, return directly
    if (tier1Filtered.length >= 3 && tier1Filtered[0] && tier1Filtered[0].score >= 70) {
      logger.info(
        { tier1Count: tier1Filtered.length, topScore: tier1Filtered[0].score },
        'Tier 1 sufficient, skipping Tier 2'
      );
      return tier1Filtered.slice(0, maxResults);
    }

    // 2. Tier 2: Fuzzy search to supplement
    const tier2Results = this.tier2.search(query, apiResults);

    // 3. Merge and deduplicate
    const merged = this.mergeResults([tier1Filtered, tier2Results]);

    // 4. Filter very low scores (< 20) and limit count
    const filtered = merged.filter((r) => r.score >= 20).slice(0, maxResults);

    logger.info(
      {
        tier1Count: tier1Filtered.length,
        tier2Count: tier2Results.length,
        mergedCount: merged.length,
        finalCount: filtered.length,
        topScore: filtered.length > 0 && filtered[0] ? filtered[0].score : undefined,
      },
      'Enhanced search completed'
    );

    return filtered;
  }
}
