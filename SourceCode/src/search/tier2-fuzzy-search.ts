/**
 * Tier 2: Fuzzy Searcher
 * Semantic fuzzy search powered by Fuse.js
 */

import Fuse, { IFuseOptions } from 'fuse.js';
import { logger } from '../utils/logger';
import type { ResourceCandidate, ScoredResult } from './tier1-keyword-match';

interface SearchableResource extends ResourceCandidate {
  searchableContent: string; // name + description concatenated
}

export class FuzzySearcher {
  private readonly fuseOptions: IFuseOptions<SearchableResource> = {
    keys: [
      { name: 'name', weight: 0.5 }, // name has highest weight
      { name: 'description', weight: 0.3 }, // description second
      { name: 'searchableContent', weight: 0.2 }, // combined content lowest
    ],
    threshold: 0.35, // Balanced threshold (0.3 too strict for Chinese, 0.4 too loose)
    includeScore: true, // Return match scores
    minMatchCharLength: 2, // Keep 2 for Chinese (Chinese chars are 2-3 bytes)
    ignoreLocation: true, // Don't restrict match position
    useExtendedSearch: false, // Don't need advanced query syntax
    distance: 100, // Slightly relaxed for Chinese (was 50)
  };

  /**
   * Prepare searchable data structure
   */
  private prepareSearchableData(candidates: ResourceCandidate[]): SearchableResource[] {
    return candidates.map((resource) => ({
      ...resource,
      searchableContent: `${resource.name} ${resource.description}`,
    }));
  }

  /**
   * Convert Fuse score (0=best) to normal score (100=best)
   */
  private convertFuseScore(fuseScore: number | undefined): number {
    const score = fuseScore ?? 0;
    return Math.max(0, Math.min(100, Math.floor((1 - score) * 100)));
  }

  /**
   * Extract excerpt (matched context)
   */
  private extractExcerpt(text: string, query: string, maxLength = 150): string {
    const lowerText = text.toLowerCase();
    const lowerQuery = query.toLowerCase();
    const index = lowerText.indexOf(lowerQuery);

    if (index === -1) {
      // No exact match, return first 150 chars
      return text.length > maxLength ? text.substring(0, maxLength) + '...' : text;
    }

    // Extract 50 chars before and after match
    const start = Math.max(0, index - 50);
    const end = Math.min(text.length, index + query.length + 50);
    let excerpt = text.substring(start, end);

    if (start > 0) excerpt = '...' + excerpt;
    if (end < text.length) excerpt = excerpt + '...';

    return excerpt;
  }

  /**
   * Build match reason
   */
  private buildMatchReason(query: string, resource: SearchableResource): string {
    const lowerName = resource.name.toLowerCase();
    const lowerDesc = resource.description.toLowerCase();
    const lowerQuery = query.toLowerCase();

    if (lowerName.includes(lowerQuery)) {
      return `Name contains: "${query}"`;
    }
    if (lowerDesc.includes(lowerQuery)) {
      return `Description mentions: "${query}"`;
    }
    return `Content semantically matches: "${query}"`;
  }

  /**
   * Execute Tier 2 search
   */
  search(query: string, candidates: ResourceCandidate[]): ScoredResult[] {
    logger.debug({ query, candidateCount: candidates.length }, 'Tier 2 fuzzy search started');

    const searchableData = this.prepareSearchableData(candidates);
    const fuse = new Fuse(searchableData, this.fuseOptions);
    const fuseResults = fuse.search(query);

    const results: ScoredResult[] = fuseResults.map((result) => {
      const score = this.convertFuseScore(result.score);
      const resource = result.item;

      return {
        ...resource,
        score,
        match_tier: 2,
        match_reason: this.buildMatchReason(query, resource),
        excerpt: this.extractExcerpt(resource.description, query),
      };
    });

    // Filter low scores (< 40 for Tier 2, stricter than Tier 1)
    const filtered = results.filter((r) => r.score >= 40);

    logger.debug(
      { resultCount: filtered.length, topScore: filtered[0]?.score },
      'Tier 2 search completed'
    );

    return filtered;
  }
}
