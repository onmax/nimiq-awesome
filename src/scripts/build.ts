import { resolve, dirname } from 'pathe';
import { readFileSync, existsSync, writeFileSync } from 'fs';
import { $ } from 'execa';
import { safeParse, object, string, boolean, array, literal, union, nullable } from 'valibot';
import { consola } from 'consola';

// Use standard Node.js path for cross-platform compatibility
const __dirname = dirname('.');
const scriptDir = __dirname;
const dataDir = resolve(scriptDir, 'data');
const nimiqAppJson = resolve(dataDir, 'nimiq-apps.json');
const nimiqAppArchiveJson = resolve(dataDir, './archive/nimiq-apps.archive.json');

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

consola.info(`Running build script from ${scriptDir}`);

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

// Generate markdown
let markdown = "## Apps\n";
let currentType = '';

for (const app of sortedApps) {
  // Create section headers for each type
  if (app.type !== currentType) {
    currentType = app.type;
    markdown += `\n### ${currentType}\n\n`;
  }

  // Use Nimiq for official apps, otherwise use the developer name
  const author = app.isOfficial ? "Nimiq" : app.developer || "Unknown";

  markdown += `- [${app.name}](${app.link}) (@${author}): ${app.description}\n`;
}

// Write the markdown to apps.md file
const markdownPath = resolve(__dirname, 'apps.md');
writeFileSync(markdownPath, markdown);
consola.success(`Markdown file generated at ${markdownPath}`);

// Create distribution version with GitHub raw URLs for assets
async function main() {
  // Validate JSON and generate markdown first
  // ...existing code until dist generation...

  const { owner, repo } = await getGitInfo();
  const baseGithubRawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/main/src/data`;
  const distApps = parsedJson.map(app => ({
    ...app,
    logo: app.logo ? `${baseGithubRawUrl}/${app.logo.replace(/^\.\//, '')}` : "",
    screenshot: app.screenshot ? `${baseGithubRawUrl}/${app.screenshot.replace(/^\.\//, '')}` : ""
  }));

  const distFolder = resolve(dataDir, './dist');
  const distJsonPath = resolve(distFolder, 'nimiq.json');
  writeFileSync(distJsonPath, JSON.stringify(distApps, null, 2));
  consola.success(`Distribution JSON generated at ${distJsonPath}`);
  
  const baseArchiveGithubRawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/main/src/data/archive`;
  const distArchiveApps = parsedArchiveJson.map(app => ({
    ...app,
    logo: app.logo ? `${baseArchiveGithubRawUrl}/${app.logo.replace(/^\.\//, '')}` : "",
    screenshot: app.screenshot ? `${baseArchiveGithubRawUrl}/${app.screenshot.replace(/^\.\//, '')}` : ""
  }));
  const distArchiveJsonPath = resolve(distFolder, 'nimiq-archive.json');
  writeFileSync(distArchiveJsonPath, JSON.stringify(distArchiveApps, null, 2));

  // Update the main README.md with the apps.md content
  const scriptPath = __dirname;
  const appsPath = resolve(scriptPath, '..');
  const readmePath = resolve(appsPath, 'README.md');

  consola.info(`Looking for README.md at: ${readmePath}`);

  // Read the README.md content
  if (existsSync(readmePath)) {
    let readmeContent = readFileSync(readmePath, 'utf-8');

    // Define the markers for automatic content insertion in README.md
    const startMarker = '<!-- automd:file src="./src/src.md" -->';
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
  } else {
    consola.error(`README.md not found at ${readmePath}`);
  }

  consola.success('Build script completed successfully');
}

main().catch(error => {
  consola.error('Build script failed:', error);
  process.exit(1);
});
