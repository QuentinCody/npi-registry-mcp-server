#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_ROOT = path.resolve(__dirname, '..');

const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const BLUE = '\x1b[34m';
const RESET = '\x1b[0m';

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;

function assertContains(filePath, haystack, needle, testName) {
  totalTests++;
  if (haystack.includes(needle)) {
    console.log(`${GREEN}✓${RESET} ${testName}`);
    passedTests++;
  } else {
    console.log(`${RED}✗${RESET} ${testName}`);
    console.log(`  Missing: ${needle}`);
    console.log(`  File: ${filePath}`);
    failedTests++;
  }
}

function readFile(relPath) {
  const absPath = path.resolve(SERVER_ROOT, relPath);
  return fs.readFileSync(absPath, 'utf8');
}

console.log(`${BLUE}NPI Registry Structured Content Regression Tests${RESET}`);

// Check index.ts
const indexContent = readFile('src/index.ts');
assertContains('src/index.ts', indexContent, 'NpiRegistryDataDO', 'index.ts exports NpiRegistryDataDO');
assertContains('src/index.ts', indexContent, 'McpAgent', 'index.ts uses McpAgent');

// Check do.ts
const doContent = readFile('src/do.ts');
assertContains('src/do.ts', doContent, 'RestStagingDO', 'do.ts extends RestStagingDO');
assertContains('src/do.ts', doContent, 'NpiRegistryDataDO', 'do.ts exports NpiRegistryDataDO');

// Check code-mode.ts
const codeModeContent = readFile('src/tools/code-mode.ts');
assertContains('src/tools/code-mode.ts', codeModeContent, 'createSearchTool', 'code-mode.ts uses createSearchTool');
assertContains('src/tools/code-mode.ts', codeModeContent, 'createExecuteTool', 'code-mode.ts uses createExecuteTool');
assertContains('src/tools/code-mode.ts', codeModeContent, 'npiCatalog', 'code-mode.ts uses npiCatalog');

// Check query-data.ts
const queryDataContent = readFile('src/tools/query-data.ts');
assertContains('src/tools/query-data.ts', queryDataContent, 'createQueryDataHandler', 'query-data.ts uses createQueryDataHandler');
assertContains('src/tools/query-data.ts', queryDataContent, 'NPI_REGISTRY_DATA_DO', 'query-data.ts references correct DO binding');

// Check get-schema.ts
const getSchemaContent = readFile('src/tools/get-schema.ts');
assertContains('src/tools/get-schema.ts', getSchemaContent, 'createGetSchemaHandler', 'get-schema.ts uses createGetSchemaHandler');
assertContains('src/tools/get-schema.ts', getSchemaContent, 'NPI_REGISTRY_DATA_DO', 'get-schema.ts references correct DO binding');

// Check catalog.ts
const catalogContent = readFile('src/spec/catalog.ts');
assertContains('src/spec/catalog.ts', catalogContent, 'NPPES NPI Registry', 'catalog.ts has correct API name');
assertContains('src/spec/catalog.ts', catalogContent, '/providers/search', 'catalog.ts has search endpoint');
assertContains('src/spec/catalog.ts', catalogContent, '/providers/lookup', 'catalog.ts has lookup endpoint');

console.log(`\n${BLUE}Test Results Summary${RESET}`);
console.log(`Total tests: ${totalTests}`);
console.log(`${GREEN}Passed: ${passedTests}${RESET}`);
console.log(`${RED}Failed: ${failedTests}${RESET}`);

if (failedTests > 0) {
  console.log(`\n${RED}Regression tests failed.${RESET}`);
  process.exit(1);
}

console.log(`\n${GREEN}NPI Registry structured content regression tests passed.${RESET}`);
