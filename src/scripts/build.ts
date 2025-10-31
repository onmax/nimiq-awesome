import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import * as fs from 'node:fs/promises'
import * as https from 'node:https'
import process from 'node:process'
import { consola } from 'consola'
import { $ } from 'execa'
import { dirname, resolve } from 'pathe'
import { array, literal, nullable, object, safeParse, string, union } from 'valibot'

// Use standard Node.js path for cross-platform compatibility
const __dirname = dirname('.')
const srcDir = resolve(__dirname, '../src')
const dataDir = resolve(srcDir, 'data')
const nimiqAppJson = resolve(dataDir, 'nimiq-apps.json')
const nimiqAppArchiveJson = resolve(dataDir, 'archive/nimiq-apps.archive.json')
const nimiqExchangesJson = resolve(dataDir, 'nimiq-exchanges.json')
const nimiqExplorersJson = resolve(dataDir, 'nimiq-explorers.json')
const nimiqRpcServersJson = resolve(dataDir, 'nimiq-rpc-servers.json')
const exchangeLogosDir = resolve(dataDir, 'assets/exchanges')

// Ensure exchange logos directory exists
try {
  if (!existsSync(exchangeLogosDir)) {
    mkdirSync(exchangeLogosDir, { recursive: true })
    consola.info(`Created directory for exchange logos: ${exchangeLogosDir}`)
  }
}
catch (error) {
  consola.error(`Failed to create directory for exchange logos: ${error}`)
}

// Get git repository information
async function getGitInfo() {
  try {
    const remoteUrl = (await $`git config --get remote.origin.url`).stdout
    const repoPath = remoteUrl.replace(/^.*github\.com[:/]/, '').replace(/\.git$/, '')
    const [owner, repo] = repoPath.split('/')
    return { owner, repo }
  }
  catch (error) {
    consola.warn('Failed to get git repository information:', error)
    return { owner: 'nimiq', repo: 'awesome' } // Fallback values
  }
}

// Process rich text to extract plain text
// function richTextToPlainText(richText: any[]): string {
//   if (!richText || !Array.isArray(richText) || richText.length === 0) {
//     return ''
//   }

//   return richText
//     .map((node) => {
//       if (node.text) {
//         return node.text
//       }
//       else if (node.type === 'image') {
//         return `[Image: ${node.alt || 'No description'}]`
//       }
//       else if (node.type === 'embed') {
//         return '[Embedded content]'
//       }
//       return ''
//     })
//     .join('\n')
// }

// Function to download an image from a URL
function downloadImage(url: string, filepath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!url) {
      reject(new Error('No URL provided'))
      return
    }

    // Use the Node.js native fs module
    import('node:fs').then((fs_standard) => {
      https.get(url, { rejectUnauthorized: false }, (response) => {
        if (response.statusCode === 200) {
          const writeStream = fs_standard.createWriteStream(filepath)
          response.pipe(writeStream)

          writeStream.on('finish', () => {
            writeStream.close()
            consola.success(`Downloaded image to ${filepath}`)
            resolve()
          })

          writeStream.on('error', (err) => {
            fs.unlink(filepath).catch(console.error)
            reject(err)
          })
        }
        else if (response.statusCode === 301 || response.statusCode === 302) {
          // Handle redirects
          if (response.headers.location) {
            downloadImage(response.headers.location, filepath)
              .then(resolve)
              .catch(reject)
          }
          else {
            reject(new Error(`Redirect with no location header: ${response.statusCode}`))
          }
        }
        else {
          reject(new Error(`Failed to download image, status code: ${response.statusCode}`))
        }
      }).on('error', (err) => {
        reject(err)
      })
    }).catch((err) => {
      reject(err)
    })
  })
}

// Fetch exchange data from API
async function fetchExchangesFromApi() {
  try {
    consola.info('Fetching exchange data from API...')
    const response = await fetch('https://api.nimiq.dev/api/exchanges')
    if (!response.ok) {
      throw new Error(`API responded with status: ${response.status}`)
    }
    const data = await response.json() as any

    // Transform the data to match our Exchange interface
    const exchanges = await Promise.all(data.map(async (exchange: any) => {
      const name = exchange.name
      const logoUrl = exchange.logo?.url

      // Extract file extension from URL if available, default to svg
      let fileExtension = 'svg'
      if (logoUrl) {
        const urlParts = logoUrl.split('.')
        const detectedExtension = urlParts[urlParts.length - 1].toLowerCase()

        // Check if the URL contains a valid image extension
        const validExtensions = ['svg', 'png', 'jpg', 'jpeg', 'webp', 'avif']
        if (validExtensions.includes(detectedExtension.split('?')[0])) {
          fileExtension = detectedExtension.split('?')[0] // Remove query parameters
        }
      }

      const fileName = `${name.toLowerCase().replace(/\s+/g, '-')}.${fileExtension}`
      const localLogoPath = `assets/exchanges/${fileName}`
      const fullLocalPath = resolve(dataDir, localLogoPath)

      // Download the logo if it exists in the API response
      if (logoUrl) {
        consola.info(`Downloading logo for ${name} from ${logoUrl}`)
        try {
          await downloadImage(logoUrl, fullLocalPath)
          consola.success(`Logo for ${name} downloaded to ${fullLocalPath}`)
        }
        catch (error) {
          consola.error(`Failed to download logo for ${name}: ${error}`)
          // If download fails but we have an existing file, we'll keep using it
          if (!existsSync(fullLocalPath)) {
            consola.warn(`No existing logo found for ${name}, using empty string`)
          }
        }
      }

      return {
        name,
        logo: existsSync(fullLocalPath) ? localLogoPath : '',
        url: exchange.link,
        description: exchange.description || '',
        richDescription: exchange.richDescription || null,
      }
    }))

    // Write the data to the JSON file
    writeFileSync(nimiqExchangesJson, JSON.stringify(exchanges, null, 2))
    consola.success(`Successfully fetched and saved exchange data to ${nimiqExchangesJson}`)
    return exchanges
  }
  catch (error) {
    consola.error('Failed to fetch exchange data from API:', error)
    consola.warn('Using existing exchange data from JSON file...')
    // Return null to indicate we should use the existing file
    return null
  }
}

consola.info(`Running build script from ${srcDir}`)

type AppType = 'Insights' | 'E-commerce' | 'Games' | 'Faucet' | 'Promotion' | 'Miner' | 'Wallets' | 'Infrastructure' | 'Bots'

interface App {
  name: string
  description: string
  link: string
  type: AppType
  logo: string
  screenshot: string
  developer: string | null
  richDescription?: any[] | null
}

// Define Exchange interface
interface Exchange {
  name: string
  logo: string
  url: string
  description?: string
  richDescription?: any[] | null
}

// Define RPC Server types and interface
type NetworkType = 'mainnet' | 'testnet'

interface RPCServer {
  name: string
  endpoint: string
  maintainer: string
  statusLink?: string | null
  network: NetworkType
  description?: string | null
}

// Define Explorer interface
interface Explorer {
  name: string
  description: string
  link: string
  logo: string
  developer: string | null
  network: NetworkType
}

const AppTypeSchema = union([literal('Insights'), literal('E-commerce'), literal('Games'), literal('Faucet'), literal('Promotion'), literal('Miner'), literal('Wallets'), literal('Infrastructure'), literal('Bots')])

const AppSchema = object({
  name: string(),
  description: string(),
  link: string(),
  type: AppTypeSchema,
  logo: string(),
  screenshot: string(),
  developer: nullable(string()),
  richDescription: nullable(array(object({}))),
})

// Define Exchange Schema
const ExchangeSchema = object({
  name: string(),
  logo: string(),
  url: string(),
  description: nullable(string()),
  richDescription: nullable(array(object({}))),
})

// Define RPC Server Schema
const NetworkTypeSchema = union([literal('mainnet'), literal('testnet')])

const RPCServerSchema = object({
  name: string(),
  endpoint: string(),
  maintainer: string(),
  statusLink: nullable(string()),
  network: NetworkTypeSchema,
  description: nullable(string()),
})

// Define Explorer Schema
const ExplorerSchema = object({
  name: string(),
  description: string(),
  link: string(),
  logo: string(),
  developer: nullable(string()),
  network: NetworkTypeSchema,
})

const json = readFileSync(nimiqAppJson, 'utf-8')
const jsonArchive = readFileSync(nimiqAppArchiveJson, 'utf-8')
const parsedJson = JSON.parse(json) as App[]
const parsedArchiveJson = JSON.parse(jsonArchive) as App[]

// For validation, create a temporary copy with richDescription added
const validationJson = parsedJson.map(app => ({
  ...app,
  richDescription: app.richDescription || null,
}))

const AppArraySchema = array(AppSchema)
const ExchangeArraySchema = array(ExchangeSchema)
const RPCServerArraySchema = array(RPCServerSchema)
const ExplorerArraySchema = array(ExplorerSchema)

// Validate the JSON using valibot (using the temporary copy that includes richDescription)
const validationResult = safeParse(AppArraySchema, validationJson)

if (!validationResult.success) {
  consola.error('JSON validation failed')
  consola.error(validationResult.issues)
  process.exit(1)
}
else {
  consola.success('JSON validation successful')
}

// Skip empty paths as they're valid (not all apps have logos/screenshots)
function checkPathExists(filePath: string, baseDir: string): boolean {
  if (!filePath || filePath.trim() === '')
    return true

  const absolutePath = resolve(baseDir, filePath)
  const exists = existsSync(absolutePath)

  if (!exists) {
    console.error(`File does not exist: ${filePath} (resolved to ${absolutePath})`)
  }

  return exists
}

// Verify asset files exist to prevent dead links
let allPathsValid = true

for (const app of parsedJson) {
  if (app.logo && !checkPathExists(app.logo, dataDir)) {
    consola.error(`Invalid logo path for app "${app.name}": ${app.logo}`)
    allPathsValid = false
  }

  if (app.screenshot && !checkPathExists(app.screenshot, dataDir)) {
    consola.error(`Invalid screenshot path for app "${app.name}": ${app.screenshot}`)
    allPathsValid = false
  }
}

// Order by importance for better UX
const appTypeOrder = ['Wallets', 'Infrastructure', 'E-commerce', 'Games', 'Insights', 'Promotion', 'Bots', 'Miner', 'Faucet']

// Sort apps by type according to the defined order
const sortedApps = [...parsedJson].sort((a, b) => {
  const indexA = appTypeOrder.indexOf(a.type)
  const indexB = appTypeOrder.indexOf(b.type)
  return indexA - indexB
})

// Function to get author link
function getAuthorLink(author: string | null): string {
  if (author === null || author.trim() === '')
    return 'Unknown'
  else if (!author.startsWith('@'))
    return author
  else
    return `[${author}](https://github.com/${author.slice(1)})`
}

// Function to generate TOC from markdown content
function generateTOC(markdownContent: string): string {
  const lines = markdownContent.split('\n')
  const toc: string[] = []

  for (const line of lines) {
    // Match heading lines (## and ###)
    // Use a more specific pattern to avoid backtracking
    const headingMatch = line.match(/^(#{2,3})[ \t]+([^ \t].*)$/)
    if (headingMatch && headingMatch[1] && headingMatch[2]) {
      const level = headingMatch[1].length
      const title = headingMatch[2]

      // Create anchor link (GitHub style)
      const anchor = title
        .toLowerCase()
        .replace(/[^\w\s-]/g, '') // Remove special characters
        .replace(/\s+/g, '-') // Replace spaces with hyphens
        .replace(/-{2,}/g, '-') // Replace multiple hyphens with single
        .replace(/^-+|-+$/g, '') // Remove leading/trailing hyphens

      // Create indentation based on heading level
      const indent = '  '.repeat(level - 2)
      toc.push(`${indent}- [${title}](#${anchor})`)
    }
  }

  return toc.join('\n')
}

// Generate markdown
let markdown = '## Apps\n'
let currentType = ''

for (const app of sortedApps) {
  // Create section headers for each type
  if (app.type !== currentType) {
    currentType = app.type
    markdown += `\n### ${currentType}\n\n`
  }

  // Use linked author name
  const authorLink = getAuthorLink(app.developer)

  markdown += `- [${app.name}](${app.link}) (${authorLink}): ${app.description}\n`
}

// Write the markdown to apps.md file
const markdownPath = resolve(srcDir, 'apps.md')
writeFileSync(markdownPath, markdown)
consola.success(`Markdown file generated at ${markdownPath}`)

// Resource Types
type ResourceType = 'developer-tool' | 'validator' | 'documentation' | 'core' | 'utils' | 'node' | 'infrastructure' | 'rpc' | 'ui'

interface Resource {
  type: ResourceType
  name: string
  link: string
  source: string | null
  description: string
  author: string
  richDescription?: any[] | null
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
  literal('ui'),
])

const ResourceSchema = object({
  type: ResourceTypeSchema,
  name: string(),
  link: string(),
  source: nullable(string()),
  description: string(),
  author: string(),
  richDescription: nullable(array(object({}))),
})

const ResourceArraySchema = array(ResourceSchema)

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
  'infrastructure',
]

async function main() {
  // First try to fetch exchanges from API
  await fetchExchangesFromApi()

  // Now read the exchanges JSON file (either freshly updated or existing)
  const exchangesJson = readFileSync(nimiqExchangesJson, 'utf-8')
  const parsedExchangesJson = JSON.parse(exchangesJson) as Exchange[]

  // For validation, create a temporary copy with required fields added
  const validationExchangesJson = parsedExchangesJson.map(exchange => ({
    ...exchange,
    description: exchange.description || '',
    richDescription: exchange.richDescription || null,
  }))

  // Validate exchanges JSON using the validation copy
  const exchangesValidationResult = safeParse(ExchangeArraySchema, validationExchangesJson)
  if (!exchangesValidationResult.success) {
    consola.error('Exchanges JSON validation failed')
    consola.error(exchangesValidationResult.issues)
    process.exit(1)
  }
  else {
    consola.success('Exchanges JSON validation successful')
  }

  // Check exchange logo paths
  for (const exchange of parsedExchangesJson) {
    if (exchange.logo && !checkPathExists(exchange.logo, dataDir)) {
      consola.error(`Invalid logo path for exchange "${exchange.name}": ${exchange.logo}`)
      allPathsValid = false
    }
  }

  if (!allPathsValid) {
    consola.error('Some file paths are invalid')
    process.exit(1)
  }
  else {
    consola.success('All file paths are valid')
  }

  // Generate exchanges markdown
  // Sort exchanges alphabetically by name
  const sortedExchanges = [...parsedExchangesJson].sort((a, b) => a.name.localeCompare(b.name))
  let exchangesMarkdown = '## Exchanges\n\nWhere you can buy, sell, or trade Nimiq:\n\n'

  for (const exchange of sortedExchanges) {
    // Include description if available
    let exchangeEntry = `- [${exchange.name}](${exchange.url})`
    if (exchange.description) {
      exchangeEntry += `: ${exchange.description}`
    }
    exchangesMarkdown += `${exchangeEntry}\n`
  }

  // Write exchanges markdown to exchanges.md file
  const exchangesMarkdownPath = resolve(srcDir, 'exchanges.md')
  writeFileSync(exchangesMarkdownPath, exchangesMarkdown)
  consola.success(`Exchanges markdown file generated at ${exchangesMarkdownPath}`)

  // Validate JSON and generate markdown first
  const nimiqResourcesJson = resolve(dataDir, 'nimiq-resources.json')
  const resourcesJson = readFileSync(nimiqResourcesJson, 'utf-8')
  const parsedResourcesJson = JSON.parse(resourcesJson) as Resource[]

  // For validation, create a temporary copy with richDescription added
  const validationResourcesJson = parsedResourcesJson.map(resource => ({
    ...resource,
    richDescription: resource.richDescription || null,
  }))

  // Validate resources JSON using the validation copy
  const resourcesValidationResult = safeParse(ResourceArraySchema, validationResourcesJson)
  if (!resourcesValidationResult.success) {
    consola.error('Resources JSON validation failed')
    consola.error(resourcesValidationResult.issues)
    process.exit(1)
  }
  else {
    consola.success('Resources JSON validation successful')
  }

  // Sort resources by type
  const sortedResources = [...parsedResourcesJson].sort((a, b) => {
    const indexA = resourceTypeOrder.indexOf(a.type)
    const indexB = resourceTypeOrder.indexOf(b.type)
    return indexA - indexB
  })

  // Generate resources markdown
  let resourcesMarkdown = '## Developer Resources\n'
  let currentResourceType = ''

  for (const resource of sortedResources) {
    if (resource.type !== currentResourceType) {
      currentResourceType = resource.type
      const formattedType = currentResourceType
        .split('-')
        .map((word) => {
          // Handle acronyms that should be all uppercase
          const acronyms = ['rpc', 'ui', 'api', 'sdk', 'cli', 'ide', 'npm', 'cdn', 'url', 'html', 'css', 'js', 'ts']
          if (acronyms.includes(word.toLowerCase())) {
            return word.toUpperCase()
          }
          return word.charAt(0).toUpperCase() + word.slice(1)
        })
        .join(' ')
      resourcesMarkdown += `\n### ${formattedType}\n\n`
    }

    const sourceLink = resource.source ? ` ([Source](${resource.source}))` : ''
    // Link the author name to GitHub profile
    const authorLink = getAuthorLink(resource.author)
    resourcesMarkdown += `- [${resource.name}](${resource.link})${sourceLink} (${authorLink}): ${resource.description}\n`
  }

  // Write resources markdown to file
  const resourcesMarkdownPath = resolve(srcDir, 'resources.md')
  writeFileSync(resourcesMarkdownPath, resourcesMarkdown)
  consola.success(`Resources markdown file generated at ${resourcesMarkdownPath}`)

  // Process RPC servers
  const rpcServersJson = readFileSync(nimiqRpcServersJson, 'utf-8')
  const parsedRpcServersJson = JSON.parse(rpcServersJson) as RPCServer[]

  // Validate RPC servers JSON
  const rpcServersValidationResult = safeParse(RPCServerArraySchema, parsedRpcServersJson)
  if (!rpcServersValidationResult.success) {
    consola.error('RPC servers JSON validation failed')
    consola.error(rpcServersValidationResult.issues)
    process.exit(1)
  }
  else {
    consola.success('RPC servers JSON validation successful')
  }

  // Generate RPC servers markdown
  let rpcServersMarkdown = '## Open RPC Servers\n\n'
  rpcServersMarkdown += '> [!WARNING]\n'
  rpcServersMarkdown += '> These are public RPC servers that may not be suitable for production applications. '
  rpcServersMarkdown += 'They may log your data and have no uptime guarantees. Use at your own risk.\n\n'

  // Group servers by network
  const mainnetServers = parsedRpcServersJson.filter(server => server.network === 'mainnet')
  const testnetServers = parsedRpcServersJson.filter(server => server.network === 'testnet')

  if (mainnetServers.length > 0) {
    rpcServersMarkdown += '### Mainnet\n\n'
    for (const server of mainnetServers) {
      const maintainerLink = `[@${server.maintainer}](https://github.com/${server.maintainer})`
      const statusLink = server.statusLink ? ` - [Status & Limits](${server.statusLink})` : ''
      rpcServersMarkdown += `- **[${server.name}](${server.endpoint})** (${maintainerLink})${statusLink}\n`
      if (server.description) {
        rpcServersMarkdown += `  ${server.description}\n`
      }
    }
    rpcServersMarkdown += '\n'
  }

  if (testnetServers.length > 0) {
    rpcServersMarkdown += '### Testnet\n\n'
    for (const server of testnetServers) {
      const maintainerLink = `[@${server.maintainer}](https://github.com/${server.maintainer})`
      const statusLink = server.statusLink ? ` - [Status & Limits](${server.statusLink})` : ''
      rpcServersMarkdown += `- **[${server.name}](${server.endpoint})** (${maintainerLink})${statusLink}\n`
      if (server.description) {
        rpcServersMarkdown += `  ${server.description}\n`
      }
    }
  }

  // Write RPC servers markdown to file
  const rpcServersMarkdownPath = resolve(srcDir, 'rpc-servers.md')
  writeFileSync(rpcServersMarkdownPath, rpcServersMarkdown)
  consola.success(`RPC servers markdown file generated at ${rpcServersMarkdownPath}`)

  // Process explorers
  const explorersJson = readFileSync(nimiqExplorersJson, 'utf-8')
  const parsedExplorersJson = JSON.parse(explorersJson) as Explorer[]

  // Validate explorers JSON
  const explorersValidationResult = safeParse(ExplorerArraySchema, parsedExplorersJson)
  if (!explorersValidationResult.success) {
    consola.error('Explorers JSON validation failed')
    consola.error(explorersValidationResult.issues)
    process.exit(1)
  }
  else {
    consola.success('Explorers JSON validation successful')
  }

  // Generate explorers markdown
  let explorersMarkdown = '## Explorers\n\n'

  // Group explorers by network
  const mainnetExplorers = parsedExplorersJson.filter(explorer => explorer.network === 'mainnet')
  const testnetExplorers = parsedExplorersJson.filter(explorer => explorer.network === 'testnet')

  if (mainnetExplorers.length > 0) {
    explorersMarkdown += '### Mainnet\n\n'
    for (const explorer of mainnetExplorers) {
      const authorLink = getAuthorLink(explorer.developer)
      explorersMarkdown += `- [${explorer.name}](${explorer.link}) (${authorLink}): ${explorer.description}\n`
    }
    explorersMarkdown += '\n'
  }

  if (testnetExplorers.length > 0) {
    explorersMarkdown += '### Testnet\n\n'
    for (const explorer of testnetExplorers) {
      const authorLink = getAuthorLink(explorer.developer)
      explorersMarkdown += `- [${explorer.name}](${explorer.link}) (${authorLink}): ${explorer.description}\n`
    }
  }

  // Write explorers markdown to file
  const explorersMarkdownPath = resolve(srcDir, 'explorers.md')
  writeFileSync(explorersMarkdownPath, explorersMarkdown)
  consola.success(`Explorers markdown file generated at ${explorersMarkdownPath}`)

  const { owner, repo } = await getGitInfo()
  const baseGithubRawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/main/src/data`
  const distApps = parsedJson.map(app => ({
    ...app,
    logo: app.logo ? `${baseGithubRawUrl}/${app.logo.replace(/^\.\//, '')}` : '',
    screenshot: app.screenshot ? `${baseGithubRawUrl}/${app.screenshot.replace(/^\.\//, '')}` : '',
  }))

  const distFolder = resolve(dataDir, 'dist')
  const distJsonPath = resolve(distFolder, 'nimiq-apps.json')
  writeFileSync(distJsonPath, JSON.stringify(distApps, null, 2))
  consola.success(`Distribution JSON generated at ${distJsonPath}`)

  const baseArchiveGithubRawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/main/src/data/archive`
  const distArchiveApps = parsedArchiveJson.map(app => ({
    ...app,
    logo: app.logo ? `${baseArchiveGithubRawUrl}/${app.logo.replace(/^\.\//, '')}` : '',
    screenshot: app.screenshot ? `${baseArchiveGithubRawUrl}/${app.screenshot.replace(/^\.\//, '')}` : '',
  }))
  const distArchiveJsonPath = resolve(distFolder, 'nimiq-apps.archive.json')
  writeFileSync(distArchiveJsonPath, JSON.stringify(distArchiveApps, null, 2))

  // Process exchanges for distribution JSON
  const distExchanges = parsedExchangesJson.map(exchange => ({
    ...exchange,
    logo: exchange.logo ? `${baseGithubRawUrl}/${exchange.logo.replace(/^\.\//, '')}` : '',
  }))
  const distExchangesJsonPath = resolve(distFolder, 'nimiq-exchanges.json')
  writeFileSync(distExchangesJsonPath, JSON.stringify(distExchanges, null, 2))
  consola.success(`Distribution JSON for exchanges generated at ${distExchangesJsonPath}`)

  const distResourcesJsonPath = resolve(distFolder, 'nimiq-resources.json')
  writeFileSync(distResourcesJsonPath, JSON.stringify(parsedResourcesJson, null, 2))

  // Create RPC servers distribution JSON with network grouping
  const distRpcServers = {
    mainnet: mainnetServers,
    testnet: testnetServers,
  }
  const distRpcServersJsonPath = resolve(distFolder, 'rpc-servers.json')
  writeFileSync(distRpcServersJsonPath, JSON.stringify(distRpcServers, null, 2))
  consola.success(`Distribution JSON for RPC servers generated at ${distRpcServersJsonPath}`)

  // Create explorers distribution JSON
  const distExplorers = {
    mainnet: mainnetExplorers,
    testnet: testnetExplorers,
  }
  const distExplorersJsonPath = resolve(distFolder, 'nimiq-explorers.json')
  writeFileSync(distExplorersJsonPath, JSON.stringify(distExplorers, null, 2))
  consola.success(`Distribution JSON for explorers generated at ${distExplorersJsonPath}`)

  // Update the main README.md with the apps.md content
  const readmePath = resolve(__dirname, '../README.md')
  consola.info(`Looking for README.md at: ${readmePath}`)

  // Read the README.md content
  if (existsSync(readmePath)) {
    let readmeContent = readFileSync(readmePath, 'utf-8')

    // Define the markers for automatic content insertion in README.md
    const startMarker = '<!-- automd:file src="./src/apps.md" -->'
    const endMarker = '<!-- /automd -->'

    // Find the section in README.md to update
    const startIndex = readmeContent.indexOf(startMarker)
    const endIndex = readmeContent.indexOf(endMarker, startIndex)

    if (startIndex !== -1 && endIndex !== -1) {
      // Replace the content between the markers with the new apps.md content
      const updatedReadmeContent
        = `${readmeContent.substring(0, startIndex + startMarker.length)
        }\n${markdown}\n${
          readmeContent.substring(endIndex)}`

      // Write the updated README.md
      writeFileSync(readmePath, updatedReadmeContent)
      consola.success(`Successfully updated ${readmePath} with apps.md content`)
    }
    else {
      consola.error('Could not find the automd markers in README.md')
    }

    // Update resources section
    const resourcesStartMarker = '<!-- automd:file src="./src/resources.md" -->'
    const resourcesEndMarker = '<!-- /automd -->'
    const resourcesStartIndex = readmeContent.indexOf(resourcesStartMarker)
    const resourcesEndIndex = readmeContent.indexOf(resourcesEndMarker, resourcesStartIndex)

    if (resourcesStartIndex !== -1 && resourcesEndIndex !== -1) {
      readmeContent
        = `${readmeContent.substring(0, resourcesStartIndex + resourcesStartMarker.length)
        }\n${resourcesMarkdown}\n${
          readmeContent.substring(resourcesEndIndex)}`
    }

    // Update exchanges section
    const exchangesStartMarker = '<!-- automd:file src="./src/exchanges.md" -->'
    const exchangesEndMarker = '<!-- /automd -->'
    const exchangesStartIndex = readmeContent.indexOf(exchangesStartMarker)
    const exchangesEndIndex = readmeContent.indexOf(exchangesEndMarker, exchangesStartIndex)

    if (exchangesStartIndex !== -1 && exchangesEndIndex !== -1) {
      readmeContent
        = `${readmeContent.substring(0, exchangesStartIndex + exchangesStartMarker.length)
        }\n${exchangesMarkdown}\n${
          readmeContent.substring(exchangesEndIndex)}`
      consola.success('Successfully updated README.md with exchanges content')
    }
    else {
      // If markers don't exist, append the exchanges section at the end
      readmeContent += `\n\n${exchangesStartMarker}\n${exchangesMarkdown}\n${exchangesEndMarker}`
      consola.success('Added exchanges section to README.md')
    }

    // Update RPC servers section
    const rpcServersStartMarker = '<!-- automd:file src="./src/rpc-servers.md" -->'
    const rpcServersEndMarker = '<!-- /automd -->'
    const rpcServersStartIndex = readmeContent.indexOf(rpcServersStartMarker)
    const rpcServersEndIndex = readmeContent.indexOf(rpcServersEndMarker, rpcServersStartIndex)

    if (rpcServersStartIndex !== -1 && rpcServersEndIndex !== -1) {
      readmeContent
        = `${readmeContent.substring(0, rpcServersStartIndex + rpcServersStartMarker.length)
        }\n${rpcServersMarkdown}\n${
          readmeContent.substring(rpcServersEndIndex)}`
      consola.success('Successfully updated README.md with RPC servers content')
    }
    else {
      // If markers don't exist, append the RPC servers section after exchanges
      readmeContent += `\n\n${rpcServersStartMarker}\n${rpcServersMarkdown}\n${rpcServersEndMarker}`
      consola.success('Added RPC servers section to README.md')
    }

    // Update explorers section
    const explorersStartMarker = '<!-- automd:file src="./src/explorers.md" -->'
    const explorersEndMarker = '<!-- /automd -->'
    const explorersStartIndex = readmeContent.indexOf(explorersStartMarker)
    const explorersEndIndex = readmeContent.indexOf(explorersEndMarker, explorersStartIndex)

    if (explorersStartIndex !== -1 && explorersEndIndex !== -1) {
      readmeContent
        = `${readmeContent.substring(0, explorersStartIndex + explorersStartMarker.length)
        }\n${explorersMarkdown}\n${
          readmeContent.substring(explorersEndIndex)}`
      consola.success('Successfully updated README.md with explorers content')
    }
    else {
      // If markers don't exist, append the explorers section
      readmeContent += `\n\n${explorersStartMarker}\n${explorersMarkdown}\n${explorersEndMarker}`
      consola.success('Added explorers section to README.md')
    }

    // Update apps section again to ensure it's properly updated
    const appsStartIndex = readmeContent.indexOf(startMarker)
    const appsEndIndex = readmeContent.indexOf(endMarker, appsStartIndex)

    if (appsStartIndex !== -1 && appsEndIndex !== -1) {
      readmeContent
        = `${readmeContent.substring(0, appsStartIndex + startMarker.length)
        }\n${markdown}\n${
          readmeContent.substring(appsEndIndex)}`
    }

    // Generate and update TOC after all sections have been processed
    const tocStartMarker = '<!-- automd:with options="toc" -->'
    const tocEndMarker = '<!-- /automd -->'
    const tocStartIndex = readmeContent.indexOf(tocStartMarker)
    const tocEndIndex = readmeContent.indexOf(tocEndMarker, tocStartIndex)

    if (tocStartIndex !== -1 && tocEndIndex !== -1) {
      // Generate TOC from the current README content
      const toc = generateTOC(readmeContent)
      readmeContent = `${readmeContent.substring(0, tocStartIndex + tocStartMarker.length)}\n${toc}\n${readmeContent.substring(tocEndIndex)}`
      consola.success('Successfully generated and updated TOC in README.md')
    }

    writeFileSync(readmePath, readmeContent)
    consola.success('Successfully updated README.md with all content sections')
  }

  consola.success('Build script completed successfully')
}

main().catch((error) => {
  consola.error('Build script failed:', error)
  process.exit(1)
})
