import { Buffer } from 'node:buffer'
import { readFileSync, writeFileSync } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { consola } from 'consola'
import { join, resolve } from 'pathe'
import { optimize } from 'svgo'

interface OptimizationResult {
  filePath: string
  originalSize: number
  optimizedSize: number
  hadSingleColor: boolean
  colors: string[]
}

async function findAllSvgs(dir: string): Promise<string[]> {
  const svgFiles: string[] = []
  const entries = await readdir(dir, { withFileTypes: true })

  for (const entry of entries) {
    const fullPath = join(dir, entry.name)
    if (entry.isDirectory()) {
      const subFiles = await findAllSvgs(fullPath)
      svgFiles.push(...subFiles)
    }
    else if (entry.isFile() && entry.name.endsWith('.svg')) {
      svgFiles.push(fullPath)
    }
  }

  return svgFiles
}

function detectFillColors(svgContent: string): string[] {
  const fillRegex = /fill=["']([^"']+)["']/g
  const colors = new Set<string>()
  let match = fillRegex.exec(svgContent)

  while (match !== null) {
    const color = match[1].toLowerCase()
    // Skip none, transparent, currentColor
    if (color !== 'none' && color !== 'transparent' && color !== 'currentcolor') {
      colors.add(color)
    }
    match = fillRegex.exec(svgContent)
  }

  return Array.from(colors)
}

function replaceWithCurrentColor(svgContent: string, color: string): string {
  // Escape regex metacharacters in color (e.g., rgb(255, 0, 0) -> rgb\(255, 0, 0\))
  const escapedColor = color.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  // Match fill with either single or double quotes
  const regex = new RegExp(`fill=["']${escapedColor}["']`, 'gi')
  return svgContent.replace(regex, 'fill="currentColor"')
}

async function optimizeSvg(filePath: string): Promise<OptimizationResult> {
  let content = readFileSync(filePath, 'utf-8')
  const originalSize = Buffer.byteLength(content, 'utf-8')

  // Detect colors before optimization
  const colors = detectFillColors(content)
  const hadSingleColor = colors.length === 1

  // Replace with currentColor if single color
  if (hadSingleColor) {
    content = replaceWithCurrentColor(content, colors[0])
  }

  // Run svgo optimization (which includes cleanup)
  const result = optimize(content, {
    multipass: true,
  })
  const optimized = result.data

  // Write back to original file
  writeFileSync(filePath, optimized)
  const optimizedSize = Buffer.byteLength(optimized, 'utf-8')

  return {
    filePath,
    originalSize,
    optimizedSize,
    hadSingleColor,
    colors,
  }
}

export async function optimizeAssets(): Promise<void> {
  consola.info('Optimizing SVGs...')

  const assetsDir = resolve('data/assets')
  const svgFiles = await findAllSvgs(assetsDir)

  consola.info(`Found ${svgFiles.length} SVG files`)

  const results: OptimizationResult[] = []

  for (const file of svgFiles) {
    try {
      const result = await optimizeSvg(file)
      results.push(result)

      const savedBytes = result.originalSize - result.optimizedSize
      const savedKb = (savedBytes / 1024).toFixed(1)
      const colorInfo = result.hadSingleColor ? '1 color → currentColor' : `${result.colors.length} colors`

      consola.success(`  ├─ ${file.replace(`${assetsDir}/`, '')} (${colorInfo}, ${savedKb}kb saved)`)
    }
    catch (error) {
      consola.error(`Failed to optimize ${file}:`, error)
      throw error // Fail build on any error
    }
  }

  const totalSaved = results.reduce((sum, r) => sum + (r.originalSize - r.optimizedSize), 0)
  const totalSavedKb = (totalSaved / 1024).toFixed(1)
  const currentColorCount = results.filter(r => r.hadSingleColor).length

  consola.success(`✓ Optimized ${results.length} SVGs (${currentColorCount} with currentColor, ${totalSavedKb}kb saved total)`)
}
