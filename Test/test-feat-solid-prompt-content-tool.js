/**
 * Test Suite: Solid Prompt Content Tool
 * Feature: FEAT-2026-03-27-001
 *
 * Verifies:
 * 1. resolve_prompt_content resolves by prompt_name
 * 2. resolve_prompt_content resolves by resource_id
 * 3. cache miss regenerates prompt content
 * 4. not-found path returns PROMPT_NOT_FOUND
 */

'use strict';

const path = require('path');

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  ✅ ${message}`);
    passed++;
  } else {
    console.error(`  ❌ FAIL: ${message}`);
    failed++;
  }
}

function assertEqual(actual, expected, message) {
  assert(actual === expected, `${message} (expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)})`);
}

function assertIncludes(value, expected, message) {
  assert(typeof value === 'string' && value.includes(expected), `${message} (missing ${JSON.stringify(expected)})`);
}

async function run() {
  const distPath = path.resolve(__dirname, '../SourceCode/dist');

  let promptManager;
  let promptCache;
  let resolvePromptContent;

  try {
    ({ promptManager } = await import(`file://${distPath}/prompts/index.js`));
    ({ promptCache } = await import(`file://${distPath}/prompts/cache.js`));
    ({ resolvePromptContent } = await import(`file://${distPath}/tools/resolve-prompt-content.js`));
  } catch (err) {
    console.error('❌ Cannot import compiled modules. Run npm run build first.\n', err.message);
    process.exit(1);
  }

  const userToken = 'test-user-solid-prompt-tool';
  const meta = {
    resource_id: 'cmd-solid-tool-001',
    resource_type: 'command',
    resource_name: 'solid-tool-demo',
    team: 'csp',
    description: 'Solid prompt tool demo',
    rawContent: '# Solid Prompt Demo\nUse this prompt body.\n',
  };
  const promptName = 'command/solid-tool-demo';

  console.log('\n=== Solid Prompt Content Tool Tests ===\n');

  try {
    await promptManager.registerPrompt(meta, userToken);

    console.log('Group 1: resolve by prompt_name');
    {
      const result = await resolvePromptContent({
        prompt_name: promptName,
        user_token: userToken,
        jira_id: 'ZOOM-12345',
      });
      assert(result.success, 'tool returns success for prompt_name lookup');
      assertEqual(result.data.prompt_name, promptName, 'prompt_name matches');
      assertEqual(result.data.resource_id, meta.resource_id, 'resource_id matches');
      assertEqual(result.data.content_source, 'cache', 'content_source is cache after register');
      assertEqual(result.data.usage_tracked, true, 'usage_tracked=true when user_token present');
      assertIncludes(result.data.content, '# Solid Prompt Demo', 'content includes prompt body');
      assert(!result.data.content.includes('MANDATORY FIRST ACTION'),
        'tool response strips tracking header after server-side usage recording');
    }

    console.log('\nGroup 2: resolve by resource_id');
    {
      const result = await resolvePromptContent({
        resource_id: meta.resource_id,
        user_token: userToken,
      });
      assert(result.success, 'tool returns success for resource_id lookup');
      assertEqual(result.data.prompt_name, promptName, 'resource_id resolves to correct prompt_name');
      assertIncludes(result.data.content, 'Use this prompt body.', 'resolved content returned');
    }

    console.log('\nGroup 3: cache miss regenerates');
    {
      promptCache.delete('command', meta.resource_id);
      const result = await resolvePromptContent({
        prompt_name: promptName,
        user_token: userToken,
      });
      assert(result.success, 'tool still succeeds after cache deletion');
      assert(result.data.content_source === 'generated' || result.data.content_source === 'raw_fallback',
        'content_source indicates regeneration or raw fallback');
      assert(promptCache.exists('command', meta.resource_id), 'cache file recreated after cache miss');
      assertIncludes(result.data.content, '# Solid Prompt Demo', 'regenerated content includes prompt body');
    }

    console.log('\nGroup 4: not found');
    {
      const result = await resolvePromptContent({
        prompt_name: 'command/does-not-exist',
        user_token: userToken,
      });
      assert(!result.success, 'tool returns failure for unknown prompt');
      assertEqual(result.error.code, 'PROMPT_NOT_FOUND', 'error code is PROMPT_NOT_FOUND');
    }
  } finally {
    promptManager.unregisterPrompt(meta.resource_id, meta.resource_type, meta.resource_name, userToken);
    promptCache.delete(meta.resource_type, meta.resource_id);
  }

  console.log(`\n${'─'.repeat(50)}`);
  console.log(`📊 Test Summary: ${passed + failed} total | ✅ ${passed} passed | ❌ ${failed} failed`);

  if (failed > 0) {
    process.exit(1);
  }
}

run().catch((err) => {
  console.error('Unexpected error:', err);
  process.exit(1);
});
