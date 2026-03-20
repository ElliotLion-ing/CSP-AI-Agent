#!/usr/bin/env node
/**
 * Mock CSP Resource Management API Server for Local Testing
 * Implements all endpoints defined in CSP-AI-Agent-API-Mapping.md
 * Supports various test scenarios (success, failures, edge cases)
 * 
 * Authentication:
 * - Validates Bearer tokens from Authorization header
 * - Token is read from Test/CSP-Jwt-token.json
 * - Implements GET /csp/api/user/permissions for token validation
 * - Returns user_id, email, and groups (not roles)
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');
const zlib = require('zlib');
const { execSync } = require('child_process');

const PORT = parseInt(process.env.MOCK_RESOURCE_PORT || '6093', 10);
const TOKEN_FILE = path.join(__dirname, 'CSP-Jwt-token.json');
const AI_RESOURCES_CONFIG = path.join(__dirname, '../AI-Resources/ai-resources-config.json');
const AI_RESOURCES_BASE = path.join(__dirname, '../AI-Resources');

// Maps target_source values to their local git repo paths and GitLab project paths
const SOURCE_REPO_MAP = {
  'csp': {
    repoPath: path.join(__dirname, '../AI-Resources/csp'),
    resourceBase: path.join(__dirname, '../AI-Resources/csp/ai-resources'),
    // git@git.zoom.us:main/csp.git → https://git.zoom.us/main/csp
    gitlabProjectUrl: 'https://git.zoom.us/main/csp',
  },
  'client-sdk-ai-hub': {
    repoPath: path.join(__dirname, '../AI-Resources/client-sdk-ai-hub'),
    resourceBase: path.join(__dirname, '../AI-Resources/client-sdk-ai-hub'),
    gitlabProjectUrl: 'https://git.zoom.us/main/client-sdk-ai-hub',
  },
};

// Type → subdirectory name mapping (plural for directory layout)
const TYPE_SUBDIR = {
  command: 'commands',
  skill: 'skills',
  rule: 'rules',
  mcp: 'mcp',
};

// ✅ Load real AI resources from AI-Resources directory
function loadAIResources() {
  const resources = [];
  // Track loaded names per type to deduplicate (highest priority wins)
  const loadedKeys = new Set();

  /**
   * Determine how to load each resource type:
   *   directory-based : each sub-folder is one resource (skills, mcp)
   *   file-based      : each matching file is one resource (commands, rules)
   *
   * This table is the ONLY place that describes per-type loading behaviour.
   * Adding a new type to ai-resources-config.json resource_types only requires
   * adding one entry here.
   */
  const TYPE_LOADERS = {
    // skills: directory, must contain SKILL.md
    skills: {
      apiType: 'skill',
      idPrefix: 'skill',
      mode: 'directory',
      // Returns the representative content file inside the resource dir, or null
      contentFile: (dirPath, name) => {
        const f = path.join(dirPath, 'SKILL.md');
        return fs.existsSync(f) ? f : null;
      },
    },
    // mcp: directory, use first *.md as description; fall back to mcp-config.json for
    // remote-URL-only MCPs that carry no executable or markdown (e.g. acm).
    mcp: {
      apiType: 'mcp',
      idPrefix: 'mcp',
      mode: 'directory',
      contentFile: (dirPath) => {
        const entries = fs.readdirSync(dirPath);
        const md = entries.find(f => f.toLowerCase().endsWith('.md'));
        if (md) return path.join(dirPath, md);
        const cfg = entries.find(f => f === 'mcp-config.json');
        return cfg ? path.join(dirPath, cfg) : null;
      },
    },
    // commands: file-based *.md (exclude README.md)
    commands: {
      apiType: 'command',
      idPrefix: 'cmd',
      mode: 'file',
      fileFilter: (name) => name.endsWith('.md') && name !== 'README.md',
      stripExt: (name) => name.replace(/\.md$/, ''),
    },
    // rules: file-based *.mdc or *.md (exclude README.md)
    rules: {
      apiType: 'rule',
      idPrefix: 'rule',
      mode: 'file',
      fileFilter: (name) => (name.endsWith('.mdc') || name.endsWith('.md')) && name !== 'README.md',
      stripExt: (name) => name.replace(/\.(mdc|md)$/, ''),
    },
  };

  /**
   * Load all resource types defined in resourceTypes from a single source.
   * sourceName    - source name key (e.g. "csp", "client-sdk-ai-hub")
   * sourcePath    - absolute path to the source root directory
   * resCfg        - source.resources mapping: { skills: "...", commands: "...", ... }
   * team          - team label for the resource
   * resourceTypes - array of type keys to load (from config.resource_types)
   */
  function loadFromSource(sourceName, sourcePath, resCfg, team, resourceTypes) {
    resourceTypes.forEach(typeKey => {
      const loader = TYPE_LOADERS[typeKey];
      if (!loader) {
        log(`Warning: no loader defined for resource type "${typeKey}", skipping`);
        return;
      }

      const subdir = resCfg[typeKey];
      if (!subdir) return; // this source doesn't configure this type

      const typePath = path.join(sourcePath, subdir);
      if (!fs.existsSync(typePath)) return;

      if (loader.mode === 'directory') {
        // Each sub-directory is one resource.
        // Read ALL files inside the directory recursively and store as files[].
        fs.readdirSync(typePath, { withFileTypes: true })
          .filter(d => d.isDirectory())
          .forEach(d => {
            const name = d.name;
            const key = `${loader.apiType}:${name}`;
            if (loadedKeys.has(key)) return; // higher-priority source already loaded this

            const dirPath = path.join(typePath, name);
            // Verify sentinel file exists (e.g. SKILL.md for skills)
            if (!loader.contentFile(dirPath, name)) return;

            // Collect all files in this resource directory recursively
            const files = [];
            function collectFiles(dir, relBase) {
              fs.readdirSync(dir, { withFileTypes: true }).forEach(entry => {
                const relPath = relBase ? `${relBase}/${entry.name}` : entry.name;
                if (entry.isDirectory()) {
                  collectFiles(path.join(dir, entry.name), relPath);
                } else {
                  const content = fs.readFileSync(path.join(dir, entry.name), 'utf8');
                  files.push({ path: relPath, content });
                }
              });
            }
            collectFiles(dirPath, '');

            const totalSize = files.reduce((s, f) => s + f.content.length, 0);
            resources.push({
              id: `${loader.idPrefix}-${sourceName}-${name}`,
              name,
              type: loader.apiType,
              team,
              version: '1.0.0',
              description: `${name} ${loader.apiType} from ${sourceName}`,
              hash: `sha256:${name}${Date.now()}`,
              size_bytes: totalSize,
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
              created_by: `${sourceName}@zoom.us`,
              metadata: {
                module: team,
                source: sourceName,
                tags: [loader.apiType, name],
                author: `${sourceName}@zoom.us`,
                downloads: 0,
              },
              files, // full files array for download API
            });
            loadedKeys.add(key);
          });

      } else {
        // Each matching file is one resource.
        // files[] contains exactly one element: { path: filename, content }.
        fs.readdirSync(typePath, { withFileTypes: true })
          .filter(f => f.isFile() && loader.fileFilter(f.name))
          .forEach(f => {
            const name = loader.stripExt(f.name);
            const key = `${loader.apiType}:${name}`;
            if (loadedKeys.has(key)) return;

            const content = fs.readFileSync(path.join(typePath, f.name), 'utf8');
            resources.push({
              id: `${loader.idPrefix}-${sourceName}-${name}`,
              name,
              type: loader.apiType,
              team,
              version: '1.0.0',
              description: `${name} ${loader.apiType} from ${sourceName}`,
              hash: `sha256:${name}${Date.now()}`,
              size_bytes: content.length,
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
              created_by: `${sourceName}@zoom.us`,
              metadata: {
                module: team,
                source: sourceName,
                tags: [loader.apiType, name],
                author: `${sourceName}@zoom.us`,
                downloads: 0,
              },
              files: [{ path: f.name, content }], // single-file resource
            });
            loadedKeys.add(key);
          });
      }
    });
  }

  try {
    const config = JSON.parse(fs.readFileSync(AI_RESOURCES_CONFIG, 'utf8'));

    // Types to load — driven entirely by config.resource_types
    const resourceTypes = Array.isArray(config.resource_types) ? config.resource_types : ['commands', 'skills', 'mcp', 'rules'];

    // Collect all enabled sources, sort by priority descending (highest first wins dedup)
    const allSources = [];
    if (config.default_source && config.default_source.enabled) {
      allSources.push({ ...config.default_source, _priority: config.default_source.priority || 100 });
    }
    if (Array.isArray(config.extended_sources)) {
      config.extended_sources
        .filter(s => s.enabled)
        .forEach(s => allSources.push({ ...s, _priority: s.priority || 0 }));
    }
    allSources.sort((a, b) => b._priority - a._priority);

    allSources.forEach(source => {
      const sourcePath = path.join(AI_RESOURCES_BASE, source.path);
      const team = source.name === 'csp' ? 'Client-Public' : source.name;
      loadFromSource(source.name, sourcePath, source.resources, team, resourceTypes);
    });
    
    // Add some test resources for automated testing
    resources.push({
      id: 'test-resource-001',
      name: 'test-resource',
      type: 'command',
      team: 'Test',
      version: '1.0.0',
      description: 'Test resource for automated testing',
      hash: 'sha256:test123',
      size_bytes: 100,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      created_by: 'test@zoom.us',
      metadata: {
        module: 'Test',
        tags: ['test'],
        author: 'test@zoom.us',
        downloads: 0
      },
      files: [{ path: 'test-resource.md', content: 'Test resource content' }],
    });
    
    log(`Loaded ${resources.length} resources from AI-Resources`);
    return resources;
  } catch (error) {
    log(`Error loading AI resources: ${error.message}`);
    // Fallback to minimal mock data
    return [
      {
        id: 'test-resource-001',
        name: 'test-resource',
        type: 'command',
        team: 'Test',
        version: '1.0.0',
        description: 'Test resource',
        hash: 'sha256:test123',
        size_bytes: 100,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        created_by: 'test@zoom.us',
        metadata: {
          module: 'Test',
          tags: ['test'],
          author: 'test@zoom.us',
          downloads: 0
        },
        content: 'Test content'
      }
    ];
  }
}

// Mock data storage
let mockResources = loadAIResources();

// Re-export for legacy code compatibility
const legacyMockResources = [
  {
    id: 'zCodeReview-skill-002',
    name: 'debug-network',
    type: 'command',
    team: 'zNet',
    version: '1.0.1',
    description: 'Network debugging tool for SDK developers',
    hash: 'sha256:def456abc789xyz',
    size_bytes: 2048,
    created_at: '2026-03-01T10:00:00Z',
    updated_at: '2026-03-03T09:50:00Z',
    created_by: 'user@example.com',
    metadata: {
      module: 'zNet',
      tags: ['debugging', 'network', 'sdk'],
      author: 'user@example.com',
      downloads: 125
    },
    content: '# Debug Network Tool\n\nA comprehensive tool for debugging network issues in SDK development.'
  },
  {
    id: 'zDB-cmd-003',
    name: 'database-migration',
    type: 'command',
    team: 'zDB',
    version: '1.5.2',
    description: 'Database migration helper',
    hash: 'sha256:abc123xyz456def',
    size_bytes: 3072,
    created_at: '2026-01-10T12:00:00Z',
    updated_at: '2026-02-20T16:45:00Z',
    created_by: 'db-team@example.com',
    metadata: {
      module: 'zDB',
      tags: ['database', 'migration', 'sql'],
      author: 'db-team@example.com',
      downloads: 89
    },
    content: '# Database Migration Helper\n\nManage database schema migrations safely.'
  }
];

// Pre-seeded subscriptions for mock user (user@example.com / user123)
// These simulate resources the user has already subscribed to on the server.
const MOCK_USER_ID = 'user@example.com';
let mockSubscriptions = {
  [MOCK_USER_ID]: [
    // Skills
    {
      id: 'skill-client-sdk-ai-hub-analyze-conf-status',
      name: 'analyze-conf-status',
      type: 'skill',
      team: 'client-sdk-ai-hub',
      subscribed_at: '2026-03-01T00:00:00Z',
      auto_sync: true,
      scope: 'all',
      notify: true,
    },
    {
      id: 'skill-client-sdk-ai-hub-analyze-sdk-log',
      name: 'analyze-sdk-log',
      type: 'skill',
      team: 'client-sdk-ai-hub',
      subscribed_at: '2026-03-01T00:00:00Z',
      auto_sync: true,
      scope: 'all',
      notify: true,
    },
    {
      id: 'skill-client-sdk-ai-hub-analyze-zmb-log-errors',
      name: 'analyze-zmb-log-errors',
      type: 'skill',
      team: 'client-sdk-ai-hub',
      subscribed_at: '2026-03-01T00:00:00Z',
      auto_sync: true,
      scope: 'all',
      notify: true,
    },
    // Commands
    {
      id: 'cmd-client-sdk-ai-hub-generate-testcase',
      name: 'generate-testcase',
      type: 'command',
      team: 'client-sdk-ai-hub',
      subscribed_at: '2026-03-01T00:00:00Z',
      auto_sync: true,
      scope: 'all',
      notify: true,
    },
    {
      id: 'cmd-client-sdk-ai-hub-submit_zct_job',
      name: 'submit_zct_job',
      type: 'command',
      team: 'client-sdk-ai-hub',
      subscribed_at: '2026-03-01T00:00:00Z',
      auto_sync: true,
      scope: 'all',
      notify: true,
    },
    // MCP servers
    {
      id: 'mcp-client-sdk-ai-hub-jenkins',
      name: 'jenkins',
      type: 'mcp',
      team: 'client-sdk-ai-hub',
      subscribed_at: '2026-03-01T00:00:00Z',
      auto_sync: true,
      scope: 'all',
      notify: true,
    },
    {
      // Remote-URL MCP: only contains mcp-config.json (Format B) — no local executable.
      // sync_resources will merge the URL entries directly into ~/.cursor/mcp.json.
      id: 'mcp-csp-acm',
      name: 'acm',
      type: 'mcp',
      team: 'Client-Public',
      subscribed_at: '2026-03-01T00:00:00Z',
      auto_sync: true,
      scope: 'all',
      notify: true,
    },
  ],
};
let mockUploads = {};
let uploadCounter = 1;

function loadAllowedToken() {
  try {
    const raw = fs.readFileSync(TOKEN_FILE, 'utf8');
    const data = JSON.parse(raw);
    const token = data['CSP-Jwt-token'];
    return typeof token === 'string' ? token.trim() : null;
  } catch (err) {
    console.error('Failed to load CSP-Jwt-token.json:', err.message);
    return null;
  }
}

function getBearerToken(req) {
  const auth = req.headers.authorization;
  if (!auth || typeof auth !== 'string') return null;
  const prefix = 'Bearer ';
  if (!auth.startsWith(prefix)) return null;
  return auth.slice(prefix.length).trim();
}

function log(msg) {
  const ts = new Date().toISOString();
  console.log(`[${ts}] ${msg}`);
}

function validateToken(req) {
  const allowedToken = loadAllowedToken();
  if (!allowedToken) return false;
  const bearerToken = getBearerToken(req);
  return bearerToken === allowedToken;
}

function sendJSON(res, statusCode, data, extraHeaders) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json', ...(extraHeaders || {}) });
  res.end(JSON.stringify(data, null, 2));
}

function sendError(res, statusCode, code, message) {
  sendJSON(res, statusCode, {
    code: code,
    result: 'failed',
    message: message
  });
}

function readBody(req, callback) {
  let body = '';
  req.on('data', chunk => body += chunk.toString());
  req.on('end', () => {
    try {
      const data = body ? JSON.parse(body) : {};
      callback(null, data);
    } catch (err) {
      callback(err);
    }
  });
}

// Handler: GET /csp/api/resources/search
function handleSearch(req, res, query) {
  if (!validateToken(req)) {
    log('Search: Auth failed');
    return sendError(res, 401, 4010, 'Invalid or expired token');
  }

  const keyword = query.keyword || '';
  const detail = query.detail === 'true';
  const type = query.type || 'all';
  const page = parseInt(query.page || '1', 10);
  const pageSize = Math.min(parseInt(query.page_size || '20', 10), 100);

  let filtered = mockResources.filter(r => {
    const matchKeyword = !keyword || 
      r.name.includes(keyword) || 
      r.description.includes(keyword) ||
      (r.metadata.tags && r.metadata.tags.some(t => t.includes(keyword)));
    const matchType = type === 'all' || r.type === type;
    return matchKeyword && matchType;
  });

  const total = filtered.length;
  const start = (page - 1) * pageSize;
  const paged = filtered.slice(start, start + pageSize);

  const results = paged.map(r => {
    const base = {
      id: r.id,
      name: r.name,
      type: r.type,
      team: r.team,
      version: r.version,
      description: r.description,
      download_url: `http://127.0.0.1:${PORT}/csp/api/resources/download/${r.id}`
    };
    if (detail) {
      base.metadata = r.metadata;
    }
    return base;
  });

  log(`Search: keyword="${keyword}", type=${type}, page=${page}, found ${total} results`);
  sendJSON(res, 200, {
    code: 2000,
    result: 'success',
    data: {
      total: total,
      page: page,
      page_size: pageSize,
      results: results
    }
  });
}

// Handler: GET /csp/api/resources/{id}
function handleGetResource(req, res, resourceId) {
  if (!validateToken(req)) {
    log('GetResource: Auth failed');
    return sendError(res, 401, 4010, 'Invalid or expired token');
  }

  const resource = mockResources.find(r => r.id === resourceId);
  if (!resource) {
    log(`GetResource: Resource ${resourceId} not found`);
    return sendError(res, 404, 4008, 'not found');
  }

  // Simulate permission check for restricted resources
  if (resourceId.includes('restricted')) {
    log(`GetResource: Permission denied for ${resourceId}`);
    return sendError(res, 403, 4007, 'permission denied');
  }

  log(`GetResource: ${resourceId} success`);
  sendJSON(res, 200, {
    code: 2000,
    result: 'success',
    data: {
      id: resource.id,
      name: resource.name,
      type: resource.type,
      team: resource.team,
      version: resource.version,
      description: resource.description,
      hash: resource.hash,
      size_bytes: resource.size_bytes,
      download_url: `http://127.0.0.1:${PORT}/csp/api/resources/download/${resource.id}`,
      created_at: resource.created_at,
      updated_at: resource.updated_at,
      created_by: resource.created_by,
      metadata: resource.metadata
    }
  });
}

// Handler: GET /csp/api/resources/download/{id}
// Returns JSON { data: { resource_id, name, type, version, hash, files[] } }
// files[] contains all files for the resource with relative paths and content.
function handleDownload(req, res, resourceId) {
  if (!validateToken(req)) {
    log('Download: Auth failed');
    return sendError(res, 401, 4010, 'Invalid or expired token');
  }

  const resource = mockResources.find(r => r.id === resourceId);
  if (!resource) {
    log(`Download: Resource ${resourceId} not found`);
    return sendError(res, 404, 4008, 'not found');
  }

  const ifNoneMatch = req.headers['if-none-match'];
  if (ifNoneMatch && ifNoneMatch === `"${resource.hash}"`) {
    log(`Download: ${resourceId} not modified (304)`);
    res.writeHead(304, { 'ETag': `"${resource.hash}"` });
    res.end();
    return;
  }

  log(`Download: ${resourceId} success (${(resource.files || []).length} files)`);

  sendJSON(res, 200, {
    code: 2000,
    result: 'success',
    data: {
      resource_id: resource.id,
      name: resource.name,
      type: resource.type,
      version: resource.version,
      hash: resource.hash,
      files: resource.files || [],
    },
  }, { 'ETag': `"${resource.hash}"` });
}

// Handler: POST /csp/api/resources/upload
// New two-step API: accepts { type, name, files: [{path, content}] }
// Any file extension is allowed (mcp packages may include .py, .js, etc.)
function handleUpload(req, res) {
  if (!validateToken(req)) {
    log('Upload: Auth failed');
    return sendError(res, 401, 4010, 'Invalid or expired token');
  }

  readBody(req, (err, body) => {
    if (err) {
      log('Upload: Invalid JSON body');
      return sendError(res, 400, 4000, 'Invalid request body');
    }

    const { type, name, files, force, target_source } = body;
    if (!type || !name || !files) {
      log('Upload: Missing required fields (type, name, files)');
      return sendError(res, 400, 4000, 'Missing required fields: type, name, files');
    }

    if (!['command', 'skill', 'rule', 'mcp'].includes(type)) {
      log(`Upload: Invalid type ${type}`);
      return sendError(res, 400, 4000, 'Invalid type, must be: command, skill, rule, or mcp');
    }

    if (!Array.isArray(files) || files.length === 0) {
      log('Upload: files must be a non-empty array');
      return sendError(res, 400, 4000, 'files must be a non-empty array of {path, content} entries');
    }

    // Validate each file entry
    for (const f of files) {
      if (!f.path || typeof f.content !== 'string') {
        log(`Upload: Invalid file entry — missing path or content`);
        return sendError(res, 400, 4000, 'Each file entry must have path and content');
      }
      // Basic path traversal check
      if (f.path.includes('..') || f.path.startsWith('/')) {
        log(`Upload: Path traversal attempt: ${f.path}`);
        return sendError(res, 400, 4000, `Path traversal or absolute path not allowed: "${f.path}"`);
      }
    }

    // Total size check (10 MB)
    const totalSize = files.reduce((sum, f) => sum + Buffer.byteLength(f.content, 'utf8'), 0);
    if (totalSize > 10 * 1024 * 1024) {
      log('Upload: Total file size exceeds 10MB');
      return sendError(res, 400, 4001, 'Total file size exceeds 10MB limit');
    }

    // Name conflict check (skipped when force=true)
    const existingResource = mockResources.find(r => r.name === name && r.type === type);
    if (existingResource && !force) {
      log(`Upload: Name conflict for ${name}`);
      return sendError(res, 409, 4009, 'Resource name already exists');
    }

    const uploadId = `temp-${Date.now()}-${uploadCounter++}`;
    const expiresAt = new Date(Date.now() + 3600000).toISOString(); // 1 hour

    mockUploads[uploadId] = {
      files: files,       // store the full files array
      type: type,
      name: name,
      target_source: target_source || 'csp',
      created_at: new Date().toISOString(),
      expires_at: expiresAt,
      status: 'pending'
    };

    log(`Upload: Staged upload ${uploadId} for "${name}" (${type}), ${files.length} file(s)`);
    sendJSON(res, 200, {
      code: 2000,
      result: 'success',
      data: {
        upload_id: uploadId,
        status: 'pending',
        expires_at: expiresAt,
        preview_url: `http://127.0.0.1:${PORT}/preview/${uploadId}`
      }
    });
  });
}

// Handler: POST /csp/api/resources/finalize
function handleFinalize(req, res) {
  if (!validateToken(req)) {
    log('Finalize: Auth failed');
    return sendError(res, 401, 4010, 'Invalid or expired token');
  }

  readBody(req, (err, body) => {
    if (err) {
      log('Finalize: Invalid JSON body');
      return sendError(res, 400, 4000, 'Invalid request body');
    }

    const { upload_id, commit_message } = body;
    if (!upload_id || !commit_message) {
      log('Finalize: Missing required fields');
      return sendError(res, 400, 4000, 'Missing required fields: upload_id, commit_message');
    }

    const upload = mockUploads[upload_id];
    if (!upload) {
      log(`Finalize: Upload ${upload_id} not found or expired`);
      return sendError(res, 404, 4009, 'Upload not found or expired');
    }

    // Check expiration
    if (new Date(upload.expires_at) < new Date()) {
      delete mockUploads[upload_id];
      log(`Finalize: Upload ${upload_id} expired`);
      return sendError(res, 404, 4009, 'Upload expired');
    }

    // Generate resource ID
    const teamAbbr = upload.type === 'command' ? 'cmd' :
                     upload.type === 'skill' ? 'skill' :
                     upload.type === 'rule' ? 'rule' : 'mcp';
    const resourceId = `Client-Public-${teamAbbr}-${String(mockResources.length + 1).padStart(3, '0')}`;
    const version = '1.0.0';
    const now = new Date().toISOString();

    // Support both new files[] format and old single-content format
    const files = upload.files || [{ path: 'resource.md', content: upload.content || '' }];
    const totalSize = files.reduce((sum, f) => sum + Buffer.byteLength(f.content || '', 'utf8'), 0);
    const primaryContent = files[0]?.content || '';

    // ===== Real Git operation =====
    let commitHash = `git-${Date.now().toString(36)}`; // fallback
    let resourceUrl = `https://git.example.com/resources/${resourceId}`;
    let mrUrl = null;

    const sourceKey = upload.target_source || 'csp';
    const repoConfig = SOURCE_REPO_MAP[sourceKey];

    if (repoConfig && fs.existsSync(repoConfig.repoPath)) {
      try {
        const repoPath = repoConfig.repoPath;
        const resourceBase = repoConfig.resourceBase;
        const subdir = TYPE_SUBDIR[upload.type] || upload.type + 's';
        const targetDir = path.join(resourceBase, subdir);

        // Create target directory if needed
        if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });

        // Write all uploaded files under targetDir/<resource-name>/
        // For single-file resources (rules, commands) write directly as-is if only one file
        const isSingleFile = files.length === 1 && (upload.type === 'rule' || upload.type === 'command');
        const writtenPaths = [];

        if (isSingleFile) {
          const destPath = path.join(targetDir, files[0].path);
          fs.writeFileSync(destPath, files[0].content, 'utf8');
          writtenPaths.push(destPath);
          log(`Finalize[git]: Written single file → ${destPath}`);
        } else {
          const resourceDir = path.join(targetDir, upload.name);
          if (!fs.existsSync(resourceDir)) fs.mkdirSync(resourceDir, { recursive: true });
          for (const f of files) {
            const destPath = path.join(resourceDir, f.path);
            const destDir = path.dirname(destPath);
            if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
            fs.writeFileSync(destPath, f.content, 'utf8');
            writtenPaths.push(destPath);
          }
          log(`Finalize[git]: Written ${files.length} file(s) → ${resourceDir}`);
        }

        // Get current user email for branch name
        let userEmail = 'csp-agent';
        try {
          userEmail = execSync('git config user.email', { cwd: repoPath }).toString().trim();
          userEmail = userEmail.split('@')[0].replace(/[^a-zA-Z0-9-]/g, '-');
        } catch (_) {}

        // Create a new branch
        const branchSuffix = Date.now().toString().slice(-6);
        const branchName = `dev-main-${userEmail}-upload-${branchSuffix}`;
        execSync(`git checkout main 2>/dev/null || git checkout master`, { cwd: repoPath });
        execSync(`git pull --ff-only origin main 2>/dev/null || true`, { cwd: repoPath });
        execSync(`git checkout -b ${branchName}`, { cwd: repoPath });

        // Stage written files
        for (const wp of writtenPaths) {
          execSync(`git add "${wp}"`, { cwd: repoPath });
        }

        // Commit
        const safeMessage = commit_message.replace(/"/g, "'");
        execSync(`git commit -m "${safeMessage}"`, { cwd: repoPath });
        commitHash = execSync('git rev-parse HEAD', { cwd: repoPath }).toString().trim();
        log(`Finalize[git]: Committed ${commitHash} on branch ${branchName}`);

        // Push to remote
        execSync(`git push -u origin ${branchName}`, { cwd: repoPath });
        log(`Finalize[git]: Pushed branch ${branchName} to origin`);

        // Construct GitLab MR URL
        const encodedBranch = encodeURIComponent(branchName);
        mrUrl = `${repoConfig.gitlabProjectUrl}/-/merge_requests/new?merge_request%5Bsource_branch%5D=${encodedBranch}`;
        resourceUrl = `${repoConfig.gitlabProjectUrl}/-/blob/${branchName}`;

        // Return to main branch so repo stays clean for next operation
        execSync(`git checkout main 2>/dev/null || git checkout master`, { cwd: repoPath });

      } catch (gitErr) {
        log(`Finalize[git]: Git operation failed — ${gitErr.message}`);
        // Clean up: try to go back to main if something went wrong
        try {
          execSync(`git checkout main 2>/dev/null || git checkout master`, {
            cwd: (repoConfig && repoConfig.repoPath) || '.'
          });
        } catch (_) {}
        return sendError(res, 500, 5000, `Git operation failed: ${gitErr.message}`);
      }
    } else {
      log(`Finalize[git]: No repo config for source "${sourceKey}", using fake response`);
    }
    // ===== End real Git operation =====

    const newResource = {
      id: resourceId,
      name: upload.name,
      type: upload.type,
      team: 'Client-Public',
      version: version,
      description: `Uploaded resource: ${upload.name}`,
      hash: `sha256:${Buffer.from(primaryContent).toString('base64').substring(0, 16)}`,
      size_bytes: totalSize,
      file_count: files.length,
      created_at: now,
      updated_at: now,
      created_by: 'user@example.com',
      metadata: {
        module: 'Client-Public',
        tags: [upload.type],
        author: 'user@example.com',
        downloads: 0
      },
      content: primaryContent,
      files: files
    };

    mockResources.push(newResource);
    delete mockUploads[upload_id];

    log(`Finalize: Created resource ${resourceId} from upload ${upload_id}, commit ${commitHash}`);
    const responseData = {
      resource_id: resourceId,
      version: version,
      url: resourceUrl,
      commit_hash: commitHash,
      download_url: `http://127.0.0.1:${PORT}/csp/api/resources/download/${resourceId}`
    };
    if (mrUrl) responseData.mr_url = mrUrl;

    sendJSON(res, 200, {
      code: 2000,
      result: 'success',
      data: responseData
    });
  });
}

// Handler: GET /csp/api/resources/subscriptions
function handleGetSubscriptions(req, res, query) {
  if (!validateToken(req)) {
    log('GetSubscriptions: Auth failed');
    return sendError(res, 401, 4010, 'Invalid or expired token');
  }

  const userId = 'user@example.com'; // Mock user ID from token
  const scope = query.scope || 'all';
  const detail = query.detail === 'true';
  const types = query.types ? query.types.split(',') : [];

  const userSubs = mockSubscriptions[userId] || [];
  let filtered = userSubs.filter(sub => {
    const matchScope = scope === 'all' || sub.scope === scope;
    const matchType = types.length === 0 || types.includes(sub.type);
    return matchScope && matchType;
  });

  const etag = `W/"subs-${filtered.length}-${Date.now()}"`;
  const ifNoneMatch = req.headers['if-none-match'];
  if (ifNoneMatch === etag) {
    log('GetSubscriptions: Not modified (304)');
    res.writeHead(304, { 'ETag': etag });
    res.end();
    return;
  }

  const subscriptions = filtered.map(sub => {
    const resource = mockResources.find(r => r.id === sub.id);
    const result = {
      id: sub.id,
      name: sub.name,
      type: sub.type,
      team: sub.team,
      subscribed_at: sub.subscribed_at,
      auto_sync: sub.auto_sync,
      scope: sub.scope,
      notify: sub.notify
    };
    if (detail && resource) {
      result.resource = {
        version: resource.version,
        hash: resource.hash,
        size_bytes: resource.size_bytes,
        download_url: `http://127.0.0.1:${PORT}/csp/api/resources/download/${resource.id}`,
        updated_at: resource.updated_at,
        metadata: resource.metadata
      };
    }
    return result;
  });

  log(`GetSubscriptions: scope=${scope}, types=${types}, count=${subscriptions.length}`);
  sendJSON(res, 200, {
    code: 2000,
    result: 'success',
    data: {
      version: '1.0.0',
      timestamp: new Date().toISOString(),
      total: subscriptions.length,
      subscriptions: subscriptions
    }
  });
}

// Handler: POST /csp/api/resources/subscriptions/add
function handleAddSubscriptions(req, res) {
  if (!validateToken(req)) {
    log('AddSubscriptions: Auth failed');
    return sendError(res, 401, 4010, 'Invalid or expired token');
  }

  readBody(req, (err, body) => {
    if (err) {
      log('AddSubscriptions: Invalid JSON body');
      return sendError(res, 400, 4000, 'Invalid request body');
    }

    const { resource_ids, scope } = body;
    if (!resource_ids || !Array.isArray(resource_ids)) {
      log('AddSubscriptions: Missing or invalid resource_ids');
      return sendError(res, 400, 4000, 'Missing or invalid resource_ids array');
    }

    const userId = 'user@example.com';
    if (!mockSubscriptions[userId]) {
      mockSubscriptions[userId] = [];
    }

    const invalidIds = [];
    const forbiddenIds = [];
    const addedIds = [];
    const subscriptions = [];
    const now = new Date().toISOString();

    resource_ids.forEach(id => {
      const resource = mockResources.find(r => r.id === id);
      if (!resource) {
        invalidIds.push(id);
        return;
      }

      // Simulate permission check
      if (id.includes('restricted')) {
        forbiddenIds.push(id);
        return;
      }

      // Check if already subscribed
      const existing = mockSubscriptions[userId].find(s => s.id === id);
      if (!existing) {
        const sub = {
          id: resource.id,
          name: resource.name,
          type: resource.type,
          team: resource.team,
          subscribed_at: now,
          auto_sync: true,
          scope: scope || 'all',
          notify: true
        };
        mockSubscriptions[userId].push(sub);
        subscriptions.push({
          id: sub.id,
          name: sub.name,
          subscribed_at: sub.subscribed_at
        });
      }
      addedIds.push(id);
    });

    // Partial failure: resources not found
    if (invalidIds.length > 0) {
      log(`AddSubscriptions: Invalid IDs: ${invalidIds.join(', ')}`);
      return sendJSON(res, 200, {
        code: 4008,
        result: 'failed',
        message: 'Resources not found',
        data: {
          invalid_ids: invalidIds,
          added_ids: addedIds
        }
      });
    }

    // Partial failure: permission denied
    if (forbiddenIds.length > 0) {
      log(`AddSubscriptions: Forbidden IDs: ${forbiddenIds.join(', ')}`);
      return sendJSON(res, 200, {
        code: 4007,
        result: 'failed',
        message: 'Permission denied',
        data: {
          forbidden_ids: forbiddenIds
        }
      });
    }

    log(`AddSubscriptions: Added ${subscriptions.length} subscriptions`);
    sendJSON(res, 200, {
      code: 2000,
      result: 'success',
      data: {
        added_count: subscriptions.length,
        subscriptions: subscriptions
      }
    });
  });
}

// Handler: DELETE /csp/api/resources/subscriptions/remove
function handleRemoveSubscriptions(req, res) {
  if (!validateToken(req)) {
    log('RemoveSubscriptions: Auth failed');
    return sendError(res, 401, 4010, 'Invalid or expired token');
  }

  readBody(req, (err, body) => {
    if (err) {
      log('RemoveSubscriptions: Invalid JSON body');
      return sendError(res, 400, 4000, 'Invalid request body');
    }

    const { resource_ids } = body;
    if (!resource_ids || !Array.isArray(resource_ids)) {
      log('RemoveSubscriptions: Missing or invalid resource_ids');
      return sendError(res, 400, 4000, 'Missing or invalid resource_ids array');
    }

    const userId = 'user@example.com';
    if (!mockSubscriptions[userId]) {
      mockSubscriptions[userId] = [];
    }

    const before = mockSubscriptions[userId].length;
    mockSubscriptions[userId] = mockSubscriptions[userId].filter(
      sub => !resource_ids.includes(sub.id)
    );
    const removed = before - mockSubscriptions[userId].length;

    log(`RemoveSubscriptions: Removed ${removed} subscriptions`);
    sendJSON(res, 200, {
      code: 2000,
      result: 'success',
      data: {
        removed_count: removed,
        message: 'Subscriptions removed successfully'
      }
    });
  });
}

// Handler: GET /csp/api/user/permissions
// This endpoint validates the token and returns user information
// Used by MCP Server to authenticate users on SSE connection
function handleUserPermissions(req, res) {
  if (!validateToken(req)) {
    log('UserPermissions: Auth failed - invalid or expired token');
    return sendError(res, 401, 4010, 'Invalid or expired token');
  }

  log('UserPermissions: Auth success, returning user groups');
  sendJSON(res, 200, {
    code: 2000,
    result: 'success',
    data: {
      user_id: 'user123',
      email: 'user@example.com',
      groups: ['zNet', 'Client-Public', 'zDB']  // Groups, not roles
    }
  });
}

/**
 * Handle Token Validation
 * POST /auth/validate-token
 */
function handleValidateToken(req, res) {
  let body = '';
  req.on('data', chunk => { body += chunk.toString(); });
  req.on('end', () => {
    try {
      const data = JSON.parse(body);
      const token = data.token || getBearerToken(req);
      
      if (!token) {
        log('ValidateToken: Missing token');
        return sendError(res, 400, 4001, 'Token is required');
      }
      
      // Check if token is valid
      const allowedToken = loadAllowedToken();
      if (token !== allowedToken) {
        log('ValidateToken: Token mismatch');
        return sendJSON(res, 200, {
          code: 4002,
          result: 'failed',
          message: 'Token validation failed',
          data: {
            valid: false,
            reason: 'invalid_token'
          }
        });
      }
      
      // Token is valid
      log('ValidateToken: Token validated successfully');
      sendJSON(res, 200, {
        code: 2000,
        result: 'success',
        data: {
          valid: true,
          user: {
            id: 'user123',
            email: 'elliot.ding@zoom.us',
            name: 'Elliot Ding',
            groups: ['zNet', 'Client-Public']  // Changed from roles to groups
          },
          expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() // 24 hours from now
        }
      });
    } catch (err) {
      log(`ValidateToken: Error parsing body - ${err.message}`);
      sendError(res, 400, 4000, 'Invalid request body');
    }
  });
}

// Main request router
const server = http.createServer((req, res) => {
  const parsedUrl = url.parse(req.url, true);
  const pathname = parsedUrl.pathname;
  const query = parsedUrl.query;

  log(`${req.method} ${pathname}`);

  // Enable CORS for testing
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, If-None-Match, Accept-Encoding');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // Route matching
  if (req.method === 'GET' && pathname === '/csp/api/resources/search') {
    return handleSearch(req, res, query);
  }
  
  if (req.method === 'GET' && pathname.startsWith('/csp/api/resources/download/')) {
    const resourceId = pathname.split('/').pop();
    return handleDownload(req, res, resourceId);
  }
  
  if (req.method === 'GET' && pathname.startsWith('/csp/api/resources/') && 
      pathname !== '/csp/api/resources/subscriptions') {
    const resourceId = pathname.split('/').pop();
    return handleGetResource(req, res, resourceId);
  }
  
  if (req.method === 'POST' && pathname === '/csp/api/resources/upload') {
    return handleUpload(req, res);
  }
  
  if (req.method === 'POST' && pathname === '/csp/api/resources/finalize') {
    return handleFinalize(req, res);
  }
  
  if (req.method === 'GET' && pathname === '/csp/api/resources/subscriptions') {
    return handleGetSubscriptions(req, res, query);
  }
  
  if (req.method === 'POST' && pathname === '/csp/api/resources/subscriptions/add') {
    return handleAddSubscriptions(req, res);
  }
  
  if (req.method === 'DELETE' && pathname === '/csp/api/resources/subscriptions/remove') {
    return handleRemoveSubscriptions(req, res);
  }
  
  if (req.method === 'GET' && pathname === '/csp/api/user/permissions') {
    return handleUserPermissions(req, res);
  }
  
  if (req.method === 'POST' && pathname === '/auth/validate-token') {
    return handleValidateToken(req, res);
  }

  // Admin: hot-reload resources from AI-Resources directory (no auth required for local dev)
  if (req.method === 'POST' && pathname === '/admin/reload-resources') {
    const before = mockResources.length;
    mockResources = loadAIResources();
    const after = mockResources.length;
    log(`Admin: Reloaded resources — ${before} → ${after} resources`);
    return sendJSON(res, 200, {
      code: 2000,
      result: 'success',
      data: { before, after, message: `Reloaded ${after} resources from AI-Resources directory` }
    });
  }

  // 404 Not Found
  log('404 Not Found');
  sendError(res, 404, 4004, 'Endpoint not found');
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} is already in use. Either:`);
    console.error(`  - Kill the process: lsof -ti :${PORT} | xargs kill`);
    console.error(`  - Or use another port: MOCK_RESOURCE_PORT=6093 node Test/mock-csp-resource-server.js`);
    process.exit(1);
  }
  throw err;
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n========================================`);
  console.log(`Mock CSP Resource API Server`);
  console.log(`========================================`);
  console.log(`Listening on http://0.0.0.0:${PORT}`);
  console.log(`\nAvailable Endpoints:`);
  console.log(`  POST /auth/validate-token`);
  console.log(`  GET  /csp/api/resources/search`);
  console.log(`  GET  /csp/api/resources/{id}`);
  console.log(`  GET  /csp/api/resources/download/{id}`);
  console.log(`  POST /csp/api/resources/upload`);
  console.log(`  POST /csp/api/resources/finalize`);
  console.log(`  GET  /csp/api/resources/subscriptions`);
  console.log(`  POST /csp/api/resources/subscriptions/add`);
  console.log(`  DELETE /csp/api/resources/subscriptions/remove`);
  console.log(`  GET  /csp/api/user/permissions`);
  console.log(`  POST /admin/reload-resources  (hot-reload, no auth)`);
  console.log(`\nAuth: Bearer Token required (from CSP-Jwt-token.json)`);
  console.log(`========================================\n`);
});
