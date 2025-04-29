import { resolve, dirname } from 'pathe';
import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'fs';
import { $ } from 'execa';
import { safeParse, object, string, boolean, array, literal, union, nullable } from 'valibot';
import { consola } from 'consola';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as https from 'https';

// Use standard Node.js path for cross-platform compatibility
const __dirname = dirname('.');
const srcDir = resolve(__dirname, '../src');
const dataDir = resolve(srcDir, 'data');
const nimiqAppJson = resolve(dataDir, 'nimiq-apps.json');
const nimiqAppArchiveJson = resolve(dataDir, 'archive/nimiq-apps.archive.json');
const nimiqExchangesJson = resolve(dataDir, 'nimiq-exchanges.json');
const exchangeLogosDir = resolve(dataDir, 'assets/exchanges');

// Ensure exchange logos directory exists
try {
  if (!existsSync(exchangeLogosDir)) {
    mkdirSync(exchangeLogosDir, { recursive: true });
    consola.info(`Created directory for exchange logos: ${exchangeLogosDir}`);
  }
} catch (error) {
  consola.error(`Failed to create directory for exchange logos: ${error}`);
}

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

// Process rich text to extract plain text
function richTextToPlainText(richText: any[]): string {
  if (!richText || !Array.isArray(richText) || richText.length === 0) {
    return '';
  }
  
  return richText
    .map(node => {
      if (node.text) {
        return node.text;
      } else if (node.type === 'image') {
        return `[Image: ${node.alt || 'No description'}]`;
      } else if (node.type === 'embed') {
        return '[Embedded content]';
      }
      return '';
    })
    .join('\n');
}

// Function to download an image from a URL
function downloadImage(url: string, filepath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!url) {
      reject(new Error('No URL provided'));
      return;
    }
    
    // Use the Node.js native fs module
    import('fs').then(fs_standard => {
      https.get(url, { rejectUnauthorized: false }, (response) => {
        if (response.statusCode === 200) {
          const writeStream = fs_standard.createWriteStream(filepath);
          response.pipe(writeStream);
          
          writeStream.on('finish', () => {
            writeStream.close();
            consola.success(`Downloaded image to ${filepath}`);
            resolve();
          });
          
          writeStream.on('error', (err) => {
            fs.unlink(filepath).catch(console.error);
            reject(err);
          });
        } else if (response.statusCode === 301 || response.statusCode === 302) {
          // Handle redirects
          if (response.headers.location) {
            downloadImage(response.headers.location, filepath)
              .then(resolve)
              .catch(reject);
          } else {
            reject(new Error(`Redirect with no location header: ${response.statusCode}`));
          }
        } else {
          reject(new Error(`Failed to download image, status code: ${response.statusCode}`));
        }
      }).on('error', (err) => {
        reject(err);
      });
    }).catch(err => {
      reject(err);
    });
  });
}

// Fetch exchange data from API
async function fetchExchangesFromApi() {
  try {
    consola.info('Fetching exchange data from API...');
    const response = await fetch('https://api.nimiq.dev/api/exchanges');
    if (!response.ok) {
      throw new Error(`API responded with status: ${response.status}`);
    }
    const data = await response.json() as any;
    
    // Transform the data to match our Exchange interface
    const exchanges = await Promise.all(data.map(async (exchange: any) => {
      const name = exchange.name;
      const logoUrl = exchange.logo?.url;
      
      // Extract file extension from URL if available, default to svg
      let fileExtension = 'svg';
      if (logoUrl) {
        const urlParts = logoUrl.split('.');
        const detectedExtension = urlParts[urlParts.length - 1].toLowerCase();
        
        // Check if the URL contains a valid image extension
        const validExtensions = ['svg', 'png', 'jpg', 'jpeg', 'webp', 'avif'];
        if (validExtensions.includes(detectedExtension.split('?')[0])) {
          fileExtension = detectedExtension.split('?')[0]; // Remove query parameters
        }
      }
      
      const fileName = `${name.toLowerCase().replace(/\s+/g, '-')}.${fileExtension}`;
      const localLogoPath = `assets/exchanges/${fileName}`;
      const fullLocalPath = resolve(dataDir, localLogoPath);
      
      // Download the logo if it exists in the API response
      if (logoUrl) {
        consola.info(`Downloading logo for ${name} from ${logoUrl}`);
        try {
          await downloadImage(logoUrl, fullLocalPath);
          consola.success(`Logo for ${name} downloaded to ${fullLocalPath}`);
        } catch (error) {
          consola.error(`Failed to download logo for ${name}: ${error}`);
          // If download fails but we have an existing file, we'll keep using it
          if (!existsSync(fullLocalPath)) {
            consola.warn(`No existing logo found for ${name}, using empty string`);
          }
        }
      }
      
      return {
        name: name,
        logo: existsSync(fullLocalPath) ? localLogoPath : "",
        url: exchange.link,
        description: exchange.description || "",
        richDescription: exchange.richDescription || null,
      };
    }));
    
    // Write the data to the JSON file
    writeFileSync(nimiqExchangesJson, JSON.stringify(exchanges, null, 2));
    consola.success(`Successfully fetched and saved exchange data to ${nimiqExchangesJson}`);
    return exchanges;
  } catch (error) {
    consola.error('Failed to fetch exchange data from API:', error);
    consola.warn('Using existing exchange data from JSON file...');
    // Return null to indicate we should use the existing file
    return null;
  }
}

consola.info(`Running build script from ${srcDir}`);

type AppType = 'Insights' | 'E-commerce' | 'Games' | 'Faucet' | 'Promotion' | 'Miner' | 'Wallets' | 'Infrastructure' | 'Bots';

interface App {
  name: string;
  description: string;
  link: string;
  type: AppType;
  logo: string;
  screenshot: string;
  developer: string | null;
  richDescription?: any[] | null;
}

// Define Exchange interface
interface Exchange {
  name: string;
  logo: string;
  url: string;
  description?: string;
  richDescription?: any[] | null;
}

const AppTypeSchema = union([literal('Insights'), literal('E-commerce'), literal('Games'), literal('Faucet'), literal('Promotion'), literal('Miner'), literal('Wallets'), literal('Infrastructure'), literal('Bots')]);

const AppSchema = object({
  name: string(),
  description: string(),
  link: string(),
  type: AppTypeSchema,
  logo: string(),
  screenshot: string(),
  developer: nullable(string()),
  richDescription: nullable(array(object({})))
});

// Define Exchange Schema
const ExchangeSchema = object({
  name: string(),
  logo: string(),
  url: string(),
  description: nullable(string()),
  richDescription: nullable(array(object({})))
});

const json = readFileSync(nimiqAppJson, 'utf-8');
const jsonArchive = readFileSync(nimiqAppArchiveJson, 'utf-8');
const parsedJson = JSON.parse(json) as App[];
const parsedArchiveJson = JSON.parse(jsonArchive) as App[];

// For validation, create a temporary copy with richDescription added
const validationJson = parsedJson.map(app => ({
  ...app,
  richDescription: app.richDescription || null
}));

const validationArchiveJson = parsedArchiveJson.map(app => ({
  ...app,
  richDescription: app.richDescription || null
}));

const AppArraySchema = array(AppSchema);
const ExchangeArraySchema = array(ExchangeSchema);

// Validate the JSON using valibot (using the temporary copy that includes richDescription)
const validationResult = safeParse(AppArraySchema, validationJson);

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

// Resource Types
type ResourceType = 'developer-tool' | 'validator' | 'documentation' | 'core' | 'utils' | 'node' | 'infrastructure' | 'rpc' | 'ui';

interface Resource {
  type: ResourceType;
  name: string;
  link: string;
  source: string | null;
  description: string;
  author: string;
  richDescription?: any[] | null;
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
  author: string(),
  richDescription: nullable(array(object({})))
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
  // First try to fetch exchanges from API
  await fetchExchangesFromApi();
  
  // Now read the exchanges JSON file (either freshly updated or existing)
  const exchangesJson = readFileSync(nimiqExchangesJson, 'utf-8');
  const parsedExchangesJson = JSON.parse(exchangesJson) as Exchange[];

  // For validation, create a temporary copy with required fields added
  const validationExchangesJson = parsedExchangesJson.map(exchange => ({
    ...exchange,
    description: exchange.description || "",
    richDescription: exchange.richDescription || null
  }));

  // Validate exchanges JSON using the validation copy
  const exchangesValidationResult = safeParse(ExchangeArraySchema, validationExchangesJson);
  if (!exchangesValidationResult.success) {
    consola.error('Exchanges JSON validation failed');
    consola.error(exchangesValidationResult.issues);
    process.exit(1);
  } else {
    consola.success('Exchanges JSON validation successful');
  }

  // Check exchange logo paths
  for (const exchange of parsedExchangesJson) {
    if (exchange.logo && !checkPathExists(exchange.logo, dataDir)) {
      consola.error(`Invalid logo path for exchange "${exchange.name}": ${exchange.logo}`);
      allPathsValid = false;
    }
  }

  if (!allPathsValid) {
    consola.error('Some file paths are invalid');
    process.exit(1);
  } else {
    consola.success('All file paths are valid');
  }

  // Generate exchanges markdown
  // Sort exchanges alphabetically by name
  const sortedExchanges = [...parsedExchangesJson].sort((a, b) => a.name.localeCompare(b.name));
  let exchangesMarkdown = "## Exchanges\n\nWhere you can buy, sell, or trade Nimiq:\n\n";

  for (const exchange of sortedExchanges) {
    // Include description if available
    let exchangeEntry = `- [${exchange.name}](${exchange.url})`;
    if (exchange.description) {
      exchangeEntry += `: ${exchange.description}`;
    }
    exchangesMarkdown += exchangeEntry + '\n';
  }

  // Write exchanges markdown to exchanges.md file
  const exchangesMarkdownPath = resolve(srcDir, 'exchanges.md');
  writeFileSync(exchangesMarkdownPath, exchangesMarkdown);
  consola.success(`Exchanges markdown file generated at ${exchangesMarkdownPath}`);

  // Validate JSON and generate markdown first
  const nimiqResourcesJson = resolve(dataDir, 'nimiq-resources.json');
  const resourcesJson = readFileSync(nimiqResourcesJson, 'utf-8');
  const parsedResourcesJson = JSON.parse(resourcesJson) as Resource[];

  // For validation, create a temporary copy with richDescription added
  const validationResourcesJson = parsedResourcesJson.map(resource => ({
    ...resource,
    richDescription: resource.richDescription || null
  }));
  
  // Validate resources JSON using the validation copy
  const resourcesValidationResult = safeParse(ResourceArraySchema, validationResourcesJson);
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
    const authorLink = getAuthorLink(resource.author);
    resourcesMarkdown += `- [${resource.name}](${resource.link})${sourceLink} (${authorLink}): ${resource.description}\n`;
  }

  // Write resources markdown to file
  const resourcesMarkdownPath = resolve(srcDir, 'resources.md');
  writeFileSync(resourcesMarkdownPath, resourcesMarkdown);
  consola.success(`Resources markdown file generated at ${resourcesMarkdownPath}`);

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

  // Process exchanges for distribution JSON
  const distExchanges = parsedExchangesJson.map(exchange => ({
    ...exchange,
    logo: exchange.logo ? `${baseGithubRawUrl}/${exchange.logo.replace(/^\.\//, '')}` : ""
  }));
  const distExchangesJsonPath = resolve(distFolder, 'nimiq-exchanges.json');
  writeFileSync(distExchangesJsonPath, JSON.stringify(distExchanges, null, 2));
  consola.success(`Distribution JSON for exchanges generated at ${distExchangesJsonPath}`);

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
    
    // Update exchanges section
    const exchangesStartMarker = '<!-- automd:file src="./src/exchanges.md" -->';
    const exchangesEndMarker = '<!-- /automd -->';
    const exchangesStartIndex = readmeContent.indexOf(exchangesStartMarker);
    const exchangesEndIndex = readmeContent.indexOf(exchangesEndMarker, exchangesStartIndex);
    
    if (exchangesStartIndex !== -1 && exchangesEndIndex !== -1) {
      readmeContent =
        readmeContent.substring(0, exchangesStartIndex + exchangesStartMarker.length) +
        '\n' + exchangesMarkdown + '\n' +
        readmeContent.substring(exchangesEndIndex);
      consola.success('Successfully updated README.md with exchanges content');
    } else {
      // If markers don't exist, append the exchanges section at the end
      readmeContent += '\n\n' + exchangesStartMarker + '\n' + exchangesMarkdown + '\n' + exchangesEndMarker;
      consola.success('Added exchanges section to README.md');
    }

    // Update apps section again to ensure it's properly updated
    const appsStartIndex = readmeContent.indexOf(startMarker);
    const appsEndIndex = readmeContent.indexOf(endMarker, appsStartIndex);

    if (appsStartIndex !== -1 && appsEndIndex !== -1) {
      readmeContent =
        readmeContent.substring(0, appsStartIndex + startMarker.length) +
        '\n' + markdown + '\n' +
        readmeContent.substring(appsEndIndex);
    }

    writeFileSync(readmePath, readmeContent);
    consola.success('Successfully updated README.md with all content sections');
  }

  consola.success('Build script completed successfully');
}

main().catch(error => {
  consola.error('Build script failed:', error);
  process.exit(1);
});
