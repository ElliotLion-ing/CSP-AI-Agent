/**
 * prompts module — public API
 *
 * Exports:
 *  - PromptGenerator utilities (parseMarkdownWithImports, replaceMDVariables,
 *    generatePromptContent, generatePromptContentFromString)
 *  - PromptCache class and the shared singleton `promptCache`
 *  - PromptManager class and the shared singleton `promptManager`
 */

export {
  parseMarkdownWithImports,
  replaceMDVariables,
  generatePromptContent,
  generatePromptContentFromString,
} from './generator.js';

export { PromptCache, promptCache } from './cache.js';

export { PromptManager, promptManager } from './manager.js';
