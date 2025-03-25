import { resolve, dirname } from 'pathe';
import { readFileSync, existsSync, writeFileSync } from 'fs';
import { $ } from 'execa';
import { safeParse, object, string, boolean, array, literal, union, nullable } from 'valibot';
import { consola } from 'consola';

// Use standard Node.js path for cross-platform compatibility
const __dirname = dirname('.');
const srcDir = resolve(__dirname, '../src');
const dataDir = resolve(srcDir, 'data');
const nimiqAppJson = resolve(dataDir, 'nimiq-apps.json');
const nimiqAppArchiveJson = resolve(dataDir, 'archive/nimiq-apps.archive.json');

// Get git repository information
async function getGitInfo() {
  try {
    const remoteUrl = (await $`git config --get remote.origin.url`).stdout;
    const repoPath = remoteUrl.replace(/^.*github\.com[:/]/, '').replace(/\.git$/, '');
    const [owner, repo] = repoPath.split('/');
    return { owner, repo };
  } catch (error) {
    consola.warn('Failed to get git repository information:', error);
    return { owner: 'nimiq', repo: 'awesome' }; // Fallback values
  }
}

consola.info(`Running build script from ${srcDir}`);

type AppType = 'Insights' | 'E-commerce' | 'Games' | 'Faucet' | 'Promotion' | 'Miner' | 'Wallets' | 'Infrastructure' | 'Bots';

interface App {
  isOfficial: boolean;
  name: string;
  description: string;
  link: string;
  type: AppType;
  logo: string;
  screenshot: string;
  developer: string | null;
}

const AppTypeSchema = union([literal('Insights'), literal('E-commerce'), literal('Games'), literal('Faucet'), literal('Promotion'), literal('Miner'), literal('Wallets'), literal('Infrastructure'), literal('Bots')]);

const AppSchema = object({
  isOfficial: boolean(),
  name: string(),
  description: string(),
  link: string(),
  type: AppTypeSchema,
  logo: string(),
  screenshot: string(),
  developer: nullable(string()),
});

const json = readFileSync(nimiqAppJson, 'utf-8');
const jsonArchive = readFileSync(nimiqAppArchiveJson, 'utf-8');
const parsedJson = JSON.parse(json) as App[];
const parsedArchiveJson = JSON.parse(jsonArchive) as App[];

const AppArraySchema = array(AppSchema);

// Validate the JSON using valibot
const validationResult = safeParse(AppArraySchema, parsedJson);

if (!validationResult.success) {
  consola.error('JSON validation failed');
  consola.error(validationResult.issues);
  process.exit(1);
} else {
  consola.success('JSON validation successful');
}

// Skip empty paths as they're valid (not all apps have logos/screenshots)
function checkPathExists(filePath: string, baseDir: string): boolean {
  if (!filePath || filePath.trim() === '') return true;

  const absolutePath = resolve(baseDir, filePath);
  const exists = existsSync(absolutePath);

  if (!exists) {
    console.error(`File does not exist: ${filePath} (resolved to ${absolutePath})`);
  }

  return exists;
}

// Verify asset files exist to prevent dead links
let allPathsValid = true;

for (const app of parsedJson) {
  if (app.logo && !checkPathExists(app.logo, dataDir)) {
    consola.error(`Invalid logo path for app "${app.name}": ${app.logo}`);
    allPathsValid = false;
  }

  if (app.screenshot && !checkPathExists(app.screenshot, dataDir)) {
    consola.error(`Invalid screenshot path for app "${app.name}": ${app.screenshot}`);
    allPathsValid = false;
  }
}

if (!allPathsValid) {
  consola.error('Some file paths are invalid');
  process.exit(1);
} else {
  consola.success('All file paths are valid');
}

// Order by importance for better UX
const appTypeOrder = ['Wallets', 'Infrastructure', 'E-commerce', 'Games', 'Insights', 'Promotion', 'Bots', 'Miner', 'Faucet'];

// Sort apps by type according to the defined order
const sortedApps = [...parsedJson].sort((a, b) => {
  const indexA = appTypeOrder.indexOf(a.type);
  const indexB = appTypeOrder.indexOf(b.type);
  return indexA - indexB;
});

// Function to get author link
function getAuthorLink(author: string | null): string {
  if (author === null || author.trim() === '')
    return "Unknown";
  else if (!author.startsWith('@'))
    return author;
  else 
    return `[${author}](https://github.com/${author.slice(1)})`;
  
}

// Generate markdown
let markdown = "## Apps\n";
let currentType = '';

for (const app of sortedApps) {
  // Create section headers for each type
  if (app.type !== currentType) {
    currentType = app.type;
    markdown += `\n### ${currentType}\n\n`;
  }

  // Use linked author name
  const authorLink = getAuthorLink(app.developer);

  markdown += `- [${app.name}](${app.link}) (${authorLink}): ${app.description}\n`;
}

// Write the markdown to apps.md file
const markdownPath = resolve(srcDir, 'apps.md');
writeFileSync(markdownPath, markdown);
consola.success(`Markdown file generated at ${markdownPath}`);

// Create distribution version with GitHub raw URLs for assets
// Resource Types
type ResourceType = 'developer-tool' | 'validator' | 'documentation' | 'core' | 'utils' | 'node' | 'infrastructure' | 'rpc' | 'ui';

interface Resource {
  type: ResourceType;
  name: string;
  link: string;
  source: string | null;
  description: string;
  author: string;
}

const ResourceTypeSchema = union([
  literal('developer-tool'),
  literal('validator'),
  literal('documentation'),
  literal('core'),
  literal('utils'),
  literal('node'),
  literal('infrastructure'),
  literal('rpc'),
  literal('ui')
]);

const ResourceSchema = object({
  type: ResourceTypeSchema,
  name: string(),
  link: string(),
  source: nullable(string()),
  description: string(),
  author: string()
});

const ResourceArraySchema = array(ResourceSchema);

// Resources order by importance
const resourceTypeOrder = [
  'developer-tool',
  'documentation',
  'core',
  'rpc',
  'ui',
  'utils',
  'validator',
  'node',
  'infrastructure'
];

async function main() {
  // Validate JSON and generate markdown first
  const nimiqResourcesJson = resolve(dataDir, 'nimiq-resources.json');
  const resourcesJson = readFileSync(nimiqResourcesJson, 'utf-8');
  const parsedResourcesJson = JSON.parse(resourcesJson) as Resource[];

  // Validate resources JSON
  const resourcesValidationResult = safeParse(ResourceArraySchema, parsedResourcesJson);
  if (!resourcesValidationResult.success) {
    consola.error('Resources JSON validation failed');
    consola.error(resourcesValidationResult.issues);
    process.exit(1);
  } else {
    consola.success('Resources JSON validation successful');
  }

  // Sort resources by type
  const sortedResources = [...parsedResourcesJson].sort((a, b) => {
    const indexA = resourceTypeOrder.indexOf(a.type);
    const indexB = resourceTypeOrder.indexOf(b.type);
    return indexA - indexB;
  });

  // Generate resources markdown
  let resourcesMarkdown = "## Developer Resources\n";
  let currentResourceType = '';

  for (const resource of sortedResources) {
    if (resource.type !== currentResourceType) {
      currentResourceType = resource.type;
      const formattedType = currentResourceType
        .split('-')
        .map(word => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ');
      resourcesMarkdown += `\n### ${formattedType}\n\n`;
    }

    const sourceLink = resource.source ? ` ([Source](${resource.source}))` : '';
    // Link the author name to GitHub profile
    const authorLink = `[${resource.author}](https://github.com/onmax)`;
    resourcesMarkdown += `- [${resource.name}](${resource.link})${sourceLink} (${authorLink}): ${resource.description}\n`;
  }

  // Write resources markdown to file
  const resourcesMarkdownPath = resolve(srcDir, 'resources.md');
  writeFileSync(resourcesMarkdownPath, resourcesMarkdown);
  consola.success(`Resources markdown file generated at ${resourcesMarkdownPath}`);

  // ...existing code for apps...

  const { owner, repo } = await getGitInfo();
  const baseGithubRawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/main/src/data`;
  const distApps = parsedJson.map(app => ({
    ...app,
    logo: app.logo ? `${baseGithubRawUrl}/${app.logo.replace(/^\.\//, '')}` : "",
    screenshot: app.screenshot ? `${baseGithubRawUrl}/${app.screenshot.replace(/^\.\//, '')}` : ""
  }));

  const distFolder = resolve(dataDir, 'dist');
  const distJsonPath = resolve(distFolder, 'nimiq-apps.json');
  writeFileSync(distJsonPath, JSON.stringify(distApps, null, 2));
  consola.success(`Distribution JSON generated at ${distJsonPath}`);
  
  const baseArchiveGithubRawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/main/src/data/archive`;
  const distArchiveApps = parsedArchiveJson.map(app => ({
    ...app,
    logo: app.logo ? `${baseArchiveGithubRawUrl}/${app.logo.replace(/^\.\//, '')}` : "",
    screenshot: app.screenshot ? `${baseArchiveGithubRawUrl}/${app.screenshot.replace(/^\.\//, '')}` : ""
  }));
  const distArchiveJsonPath = resolve(distFolder, 'nimiq-apps.archive.json');
  writeFileSync(distArchiveJsonPath, JSON.stringify(distArchiveApps, null, 2));

  const distResourcesJsonPath = resolve(distFolder, 'nimiq-resources.json');
  writeFileSync(distResourcesJsonPath, JSON.stringify(parsedResourcesJson, null, 2));

  // Update the main README.md with the apps.md content
  const readmePath = resolve(__dirname, '../README.md');
  consola.info(`Looking for README.md at: ${readmePath}`);

  // Read the README.md content
  if (existsSync(readmePath)) {
    let readmeContent = readFileSync(readmePath, 'utf-8');

    // Define the markers for automatic content insertion in README.md
    const startMarker = '<!-- automd:file src="./src/apps.md" -->';
    const endMarker = '<!-- /automd -->';

    // Find the section in README.md to update
    const startIndex = readmeContent.indexOf(startMarker);
    const endIndex = readmeContent.indexOf(endMarker, startIndex);

    if (startIndex !== -1 && endIndex !== -1) {
      // Replace the content between the markers with the new apps.md content
      const updatedReadmeContent =
        readmeContent.substring(0, startIndex + startMarker.length) +
        '\n' + markdown + '\n' +
        readmeContent.substring(endIndex);

      // Write the updated README.md
      writeFileSync(readmePath, updatedReadmeContent);
      consola.success(`Successfully updated ${readmePath} with apps.md content`);
    } else {
      consola.error('Could not find the automd markers in README.md');
    }

    // Update resources section
    const resourcesStartMarker = '<!-- automd:file src="./src/resources.md" -->';
    const resourcesEndMarker = '<!-- /automd -->';
    const resourcesStartIndex = readmeContent.indexOf(resourcesStartMarker);
    const resourcesEndIndex = readmeContent.indexOf(resourcesEndMarker, resourcesStartIndex);

    if (resourcesStartIndex !== -1 && resourcesEndIndex !== -1) {
      readmeContent =
        readmeContent.substring(0, resourcesStartIndex + resourcesStartMarker.length) +
        '\n' + resourcesMarkdown + '\n' +
        readmeContent.substring(resourcesEndIndex);
    }

    // Update apps section (existing code)
    const appsStartMarker = '<!-- automd:file src="./src/apps.md" -->';
    const appsEndMarker = '<!-- /automd -->';
    const appsStartIndex = readmeContent.indexOf(appsStartMarker);
    const appsEndIndex = readmeContent.indexOf(appsEndMarker, appsStartIndex);

    if (appsStartIndex !== -1 && appsEndIndex !== -1) {
      readmeContent =
        readmeContent.substring(0, appsStartIndex + appsStartMarker.length) +
        '\n' + markdown + '\n' +
        readmeContent.substring(appsEndIndex);
    }

    writeFileSync(readmePath, readmeContent);
    consola.success('Successfully updated README.md with both resources and apps content');
  }

  consola.success('Build script completed successfully');
}

main().catch(error => {
  consola.error('Build script failed:', error);
  process.exit(1);
});
