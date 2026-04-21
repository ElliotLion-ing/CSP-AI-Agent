/**
 * Tier 1: Keyword Matcher
 * Precise keyword matching with weighted scoring (name > description)
 */

import { logger } from '../utils/logger';

export interface ResourceCandidate {
  id: string;
  name: string;
  description: string;
  type: string;
  team: string;
  version: string;
  is_subscribed: boolean;
  download_url?: string;
  metadata?: unknown;
}

export interface ScoredResult extends ResourceCandidate {
  score: number;
  match_tier: 1 | 2;
  match_reason: string;
  excerpt?: string;
}

export class KeywordMatcher {
  private readonly STOP_WORDS = new Set([
    // English stop words
    'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'for', 'from',
    'has', 'he', 'in', 'is', 'it', 'its', 'of', 'on', 'that', 'the',
    'to', 'was', 'will', 'with',
    // Chinese stop words
    '的', '是', '在', '和', '了', '有', '与', '这', '个', '我',
  ]);

  /**
   * Extract keywords from query (supports Chinese and English)
   */
  private extractKeywords(query: string): string[] {
    // Split by spaces, underscores, hyphens, and Chinese characters
    const words = query
      .toLowerCase()
      .split(/[\s_\-]+/)
      .map((w) => w.trim())
      .filter((w) => w.length > 0);

    // Filter out stop words
    return words.filter((w) => !this.STOP_WORDS.has(w));
  }

  /**
   * Escape special regex characters
   */
  private escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /**
   * Calculate match score with weighted fields
   * 
   * Scoring rules:
   * - name field weight: 3x
   * - description field weight: 1x
   * - Whole word match > partial match
   * - If name doesn't match at all, force 70% penalty
   */
  private calculateScore(keywords: string[], resource: ResourceCandidate): number {
    const lowerName = resource.name.toLowerCase();
    const lowerDesc = resource.description.toLowerCase();

    let nameMatchCount = 0;
    let descMatchCount = 0;

    for (const keyword of keywords) {
      // Prefer whole word matching (using regex \b boundary)
      const wordBoundaryRegex = new RegExp(`\\b${this.escapeRegex(keyword)}\\b`, 'i');

      if (wordBoundaryRegex.test(resource.name)) {
        nameMatchCount++;
      } else if (lowerName.includes(keyword)) {
        nameMatchCount += 0.7; // Partial match penalty
      }

      if (wordBoundaryRegex.test(resource.description)) {
        descMatchCount++;
      } else if (lowerDesc.includes(keyword)) {
        descMatchCount += 0.5; // Description partial match penalty
      }
    }

    // ✅ Critical rule: If name doesn't match at all, force penalty
    if (nameMatchCount === 0 && descMatchCount > 0) {
      // Description matches but name doesn't, only give 30% of base score
      // This ensures resources like "release-log-review" (only mentions "build info" in description)
      // don't get high scores (e.g., 25 → 7)
      const baseScore = (descMatchCount * 1) / keywords.length * 25;
      return Math.floor(baseScore * 0.3); // Force 70% penalty
    }

    // Name has matches, calculate normally
    const weightedScore = (nameMatchCount * 3 + descMatchCount * 1) / keywords.length;
    let score = Math.floor(weightedScore * 25); // Map to 0-100

    // Bonus: All keywords match in name
    if (nameMatchCount >= keywords.length && keywords.length > 1) {
      score = Math.min(100, score + 20);
    }

    return score;
  }

  /**
   * Build human-readable match reason
   */
  private buildMatchReason(keywords: string[], resource: ResourceCandidate): string {
    const lowerName = resource.name.toLowerCase();
    const lowerDesc = resource.description.toLowerCase();

    const nameMatches = keywords.filter((k) => lowerName.includes(k));
    const descMatches = keywords.filter((k) => lowerDesc.includes(k) && !lowerName.includes(k));

    if (nameMatches.length === keywords.length) {
      return `Name matches all keywords: ${nameMatches.join(', ')}`;
    }
    if (nameMatches.length > 0) {
      return `Name matches: ${nameMatches.join(', ')}`;
    }
    if (descMatches.length > 0) {
      return `Description matches: ${descMatches.join(', ')}`;
    }
    return 'No keyword match';
  }

  /**
   * Execute Tier 1 search
   */
  search(query: string, candidates: ResourceCandidate[]): ScoredResult[] {
    const keywords = this.extractKeywords(query);

    if (keywords.length === 0) {
      logger.debug({ query }, 'No valid keywords extracted');
      return [];
    }

    logger.debug({ query, keywords }, 'Tier 1 keyword search started');

    const results: ScoredResult[] = [];

    for (const resource of candidates) {
      const score = this.calculateScore(keywords, resource);

      if (score > 0) {
        results.push({
          ...resource,
          score,
          match_tier: 1,
          match_reason: this.buildMatchReason(keywords, resource),
        });
      }
    }

    // Sort by score descending
    const sorted = results.sort((a, b) => b.score - a.score);

    logger.debug({ resultCount: sorted.length, topScore: sorted[0]?.score }, 'Tier 1 search completed');

    return sorted;
  }
}
