import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import * as fs from 'node:fs/promises'
import * as https from 'node:https'
import process from 'node:process'
import { consola } from 'consola'
import { $ } from 'execa'
import { dirname, resolve } from 'pathe'
import { array, literal, nullable, object, safeParse, string, union } from 'valibot'

const __dirname = dirname('.')
const srcDir = resolve(__dirname, '../src')
const dataDir = resolve(srcDir, 'data')
const nimiqAppJson = resolve(dataDir, 'nimiq-apps.json')
const nimiqAppArchiveJson = resolve(dataDir, 'archive/nimiq-apps.archive.json')
const nimiqExchangesJson = resolve(dataDir, 'nimiq-exchanges.json')
const nimiqExplorersJson = resolve(dataDir, 'nimiq-explorers.json')
const nimiqRpcServersJson = resolve(dataDir, 'nimiq-rpc-servers.json')
const exchangeLogosDir = resolve(dataDir, 'assets/exchanges')

try {
  if (!existsSync(exchangeLogosDir)) {
    mkdirSync(exchangeLogosDir, { recursive: true })
    consola.info(`Created directory for exchange logos: ${exchangeLogosDir}`)
  }
}
catch (error) {
  consola.error(`Failed to create directory for exchange logos: ${error}`)
}

async function getGitInfo() {
  try {
    const remoteUrl = (await $`git config --get remote.origin.url`).stdout
    const repoPath = remoteUrl.replace(/^.*github\.com[:/]/, '').replace(/\.git$/, '')
    const [owner, repo] = repoPath.split('/')
    return { owner, repo }
  }
  catch (error) {
    consola.warn('Failed to get git repository information:', error)
    return { owner: 'nimiq', repo: 'awesome' }
  }
}

function downloadImage(url: string, filepath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!url) {
      reject(new Error('No URL provided'))
      return
    }

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

async function fetchExchangesFromApi() {
  try {
    consola.info('Fetching exchange data from API...')
    const response = await fetch('https://api.nimiq.dev/api/exchanges')
    if (!response.ok) {
      throw new Error(`API responded with status: ${response.status}`)
    }
    const data = await response.json() as any

    const exchanges = await Promise.all(data.map(async (exchange: any) => {
      const name = exchange.name
      const logoUrl = exchange.logo?.url

      let fileExtension = 'svg'
      if (logoUrl) {
        const urlParts = logoUrl.split('.')
        const detectedExtension = urlParts[urlParts.length - 1].toLowerCase()

        const validExtensions = ['svg', 'png', 'jpg', 'jpeg', 'webp', 'avif']
        if (validExtensions.includes(detectedExtension.split('?')[0])) {
          fileExtension = detectedExtension.split('?')[0]
        }
      }

      const fileName = `${name.toLowerCase().replace(/\s+/g, '-')}.${fileExtension}`
      const localLogoPath = `assets/exchanges/${fileName}`
      const fullLocalPath = resolve(dataDir, localLogoPath)

      if (logoUrl) {
        consola.info(`Downloading logo for ${name} from ${logoUrl}`)
        try {
          await downloadImage(logoUrl, fullLocalPath)
          consola.success(`Logo for ${name} downloaded to ${fullLocalPath}`)
        }
        catch (error) {
          consola.error(`Failed to download logo for ${name}: ${error}`)
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

    writeFileSync(nimiqExchangesJson, JSON.stringify(exchanges, null, 2))
    consola.success(`Successfully fetched and saved exchange data to ${nimiqExchangesJson}`)
    return exchanges
  }
  catch (error) {
    consola.error('Failed to fetch exchange data from API:', error)
    consola.warn('Using existing exchange data from JSON file...')
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

interface Exchange {
  name: string
  logo: string
  url: string
  description?: string
  richDescription?: any[] | null
}

type NetworkType = 'mainnet' | 'testnet'

interface RPCServer {
  name: string
  endpoint: string
  maintainer: string
  statusLink?: string | null
  network: NetworkType
  description?: string | null
}

interface Explorer {
  name: string
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

const ExchangeSchema = object({
  name: string(),
  logo: string(),
  url: string(),
  description: nullable(string()),
  richDescription: nullable(array(object({}))),
})

const NetworkTypeSchema = union([literal('mainnet'), literal('testnet')])

const RPCServerSchema = object({
  name: string(),
  endpoint: string(),
  maintainer: string(),
  statusLink: nullable(string()),
  network: NetworkTypeSchema,
  description: nullable(string()),
})

const ExplorerSchema = object({
  name: string(),
  link: string(),
  logo: string(),
  developer: nullable(string()),
  network: NetworkTypeSchema,
})

const json = readFileSync(nimiqAppJson, 'utf-8')
const jsonArchive = readFileSync(nimiqAppArchiveJson, 'utf-8')
const parsedJson = JSON.parse(json) as App[]
const parsedArchiveJson = JSON.parse(jsonArchive) as App[]

const validationJson = parsedJson.map(app => ({
  ...app,
  richDescription: app.richDescription || null,
}))

const AppArraySchema = array(AppSchema)
const ExchangeArraySchema = array(ExchangeSchema)
const RPCServerArraySchema = array(RPCServerSchema)
const ExplorerArraySchema = array(ExplorerSchema)

const validationResult = safeParse(AppArraySchema, validationJson)

if (!validationResult.success) {
  consola.error('JSON validation failed')
  consola.error(validationResult.issues)
  process.exit(1)
}
else {
  consola.success('JSON validation successful')
}

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

const appTypeOrder = ['Wallets', 'Infrastructure', 'E-commerce', 'Games', 'Insights', 'Promotion', 'Bots', 'Miner', 'Faucet']

const sortedApps = [...parsedJson].sort((a, b) => {
  const indexA = appTypeOrder.indexOf(a.type)
  const indexB = appTypeOrder.indexOf(b.type)
  return indexA - indexB
})

function getAuthorLink(author: string | null): string {
  if (author === null || author.trim() === '')
    return 'Unknown'
  else if (!author.startsWith('@'))
    return author
  else
    return `[${author}](https://github.com/${author.slice(1)})`
}

function generateTOC(markdownContent: string): string {
  const lines = markdownContent.split('\n')
  const toc: string[] = []

  for (const line of lines) {
    const headingMatch = line.match(/^(#{2,3})[ \t]+([^ \t].*)$/)
    if (headingMatch && headingMatch[1] && headingMatch[2]) {
      const level = headingMatch[1].length
      const title = headingMatch[2]

      const anchor = title
        .toLowerCase()
        .replace(/[^\w\s-]/g, '')
        .replace(/\s+/g, '-')
        .replace(/-{2,}/g, '-')
        .replace(/^-+|-+$/g, '')

      const indent = '  '.repeat(level - 2)
      toc.push(`${indent}- [${title}](#${anchor})`)
    }
  }

  return toc.join('\n')
}

let markdown = '## Apps\n'
let currentType = ''

for (const app of sortedApps) {
  if (app.type !== currentType) {
    currentType = app.type
    markdown += `\n### ${currentType}\n\n`
  }

  const authorLink = getAuthorLink(app.developer)

  markdown += `- [${app.name}](${app.link}) (${authorLink}): ${app.description}\n`
}

const markdownPath = resolve(srcDir, 'apps.md')
writeFileSync(markdownPath, markdown)
consola.success(`Markdown file generated at ${markdownPath}`)

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
  await fetchExchangesFromApi()

  const exchangesJson = readFileSync(nimiqExchangesJson, 'utf-8')
  const parsedExchangesJson = JSON.parse(exchangesJson) as Exchange[]

  const validationExchangesJson = parsedExchangesJson.map(exchange => ({
    ...exchange,
    description: exchange.description || '',
    richDescription: exchange.richDescription || null,
  }))

  const exchangesValidationResult = safeParse(ExchangeArraySchema, validationExchangesJson)
  if (!exchangesValidationResult.success) {
    consola.error('Exchanges JSON validation failed')
    consola.error(exchangesValidationResult.issues)
    process.exit(1)
  }
  else {
    consola.success('Exchanges JSON validation successful')
  }

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

  const sortedExchanges = [...parsedExchangesJson].sort((a, b) => a.name.localeCompare(b.name))
  let exchangesMarkdown = '## Exchanges\n\nWhere you can buy, sell, or trade Nimiq:\n\n'

  for (const exchange of sortedExchanges) {
    let exchangeEntry = `- [${exchange.name}](${exchange.url})`
    if (exchange.description) {
      exchangeEntry += `: ${exchange.description}`
    }
    exchangesMarkdown += `${exchangeEntry}\n`
  }

  const exchangesMarkdownPath = resolve(srcDir, 'exchanges.md')
  writeFileSync(exchangesMarkdownPath, exchangesMarkdown)
  consola.success(`Exchanges markdown file generated at ${exchangesMarkdownPath}`)

  const nimiqResourcesJson = resolve(dataDir, 'nimiq-resources.json')
  const resourcesJson = readFileSync(nimiqResourcesJson, 'utf-8')
  const parsedResourcesJson = JSON.parse(resourcesJson) as Resource[]

  const validationResourcesJson = parsedResourcesJson.map(resource => ({
    ...resource,
    richDescription: resource.richDescription || null,
  }))

  const resourcesValidationResult = safeParse(ResourceArraySchema, validationResourcesJson)
  if (!resourcesValidationResult.success) {
    consola.error('Resources JSON validation failed')
    consola.error(resourcesValidationResult.issues)
    process.exit(1)
  }
  else {
    consola.success('Resources JSON validation successful')
  }

  const sortedResources = [...parsedResourcesJson].sort((a, b) => {
    const indexA = resourceTypeOrder.indexOf(a.type)
    const indexB = resourceTypeOrder.indexOf(b.type)
    return indexA - indexB
  })

  let resourcesMarkdown = '## Developer Resources\n'
  let currentResourceType = ''

  for (const resource of sortedResources) {
    if (resource.type !== currentResourceType) {
      currentResourceType = resource.type
      const formattedType = currentResourceType
        .split('-')
        .map((word) => {
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
    mainnet: mainnetExplorers.map(explorer => ({
      ...explorer,
      logo: explorer.logo?.startsWith('data:') ? explorer.logo : (explorer.logo ? `${baseGithubRawUrl}/${explorer.logo.replace(/^\.\//, '')}` : ''),
    })),
    testnet: testnetExplorers.map(explorer => ({
      ...explorer,
      logo: explorer.logo?.startsWith('data:') ? explorer.logo : (explorer.logo ? `${baseGithubRawUrl}/${explorer.logo.replace(/^\.\//, '')}` : ''),
    })),
  }
  const distExplorersJsonPath = resolve(distFolder, 'nimiq-explorers.json')
  writeFileSync(distExplorersJsonPath, JSON.stringify(distExplorers, null, 2))
  consola.success(`Distribution JSON for explorers generated at ${distExplorersJsonPath}`)

  // Use automd to update README.md file includes
  const readmePath = resolve(srcDir, '../README.md')
  consola.info('Using automd to update README.md file includes...')

  try {
    await $`automd --input=${readmePath}`
    consola.success('Successfully updated README.md using automd')
  }
  catch {
    consola.warn('automd had issues, continuing with TOC generation...')
  }

  // Update TOC manually (automd doesn't have native TOC generator)
  if (existsSync(readmePath)) {
    let readmeContent = readFileSync(readmePath, 'utf-8')
    const tocStartMarker = '<!-- automd:with options="toc" -->'
    const tocEndMarker = '<!-- /automd -->'
    const tocStartIndex = readmeContent.indexOf(tocStartMarker)
    const tocEndIndex = readmeContent.indexOf(tocEndMarker, tocStartIndex)

    if (tocStartIndex !== -1 && tocEndIndex !== -1) {
      const toc = generateTOC(readmeContent)
      readmeContent = `${readmeContent.substring(0, tocStartIndex + tocStartMarker.length)}\n${toc}\n${readmeContent.substring(tocEndIndex)}`
      writeFileSync(readmePath, readmeContent)
      consola.success('Successfully generated and updated TOC in README.md')
    }
  }

  consola.success('Build script completed successfully')
}

main().catch((error) => {
  consola.error('Build script failed:', error)
  process.exit(1)
})
