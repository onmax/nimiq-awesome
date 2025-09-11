# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Essential Commands

### Development Workflow
- `cd src && pnpm install` - Install dependencies (project uses pnpm)
- `cd src && pnpm run build` - Build the project (generates markdown files and distribution JSONs)
- `cd src && pnpm run lint` - Check for linting issues
- `cd src && pnpm run lint:fix` - Automatically fix linting issues

### Testing
- No specific test commands are configured in this project

## Architecture & Structure

This is a curated collection of Nimiq ecosystem projects with an automated build system that generates documentation and distribution files.

### Key Components

**Data Sources (`src/data/`):**
- `nimiq-apps.json` - Apps/wallets/games in the Nimiq ecosystem
- `nimiq-resources.json` - Developer tools, documentation, and infrastructure
- `nimiq-exchanges.json` - Exchanges supporting Nimiq (auto-fetched from API)
- `assets/` - Screenshots, logos, and other media files
- `dist/` - Generated distribution files with absolute GitHub URLs

**Generated Files:**
- `src/apps.md`, `src/resources.md`, `src/exchanges.md` - Generated markdown content
- `README.md` - Auto-updated with content from markdown files using automd markers

**Build Process (`src/scripts/build.ts`):**
1. Validates JSON data using Valibot schemas
2. Fetches exchange data from `https://api.nimiq.dev/api/exchanges`
3. Downloads exchange logos automatically
4. Generates categorized markdown files
5. Creates distribution JSONs with absolute GitHub URLs
6. Updates README.md sections between automd markers
7. Generates table of contents

### Data Structure

**Apps:** Categorized by type (Wallets, Infrastructure, E-commerce, Games, Insights, Promotion, Bots)
**Resources:** Categorized by type (developer-tool, documentation, core, rpc, ui, utils, validator, node, infrastructure)
**Exchanges:** Alphabetically sorted list with logos and descriptions

### Automated Systems

- **GitHub Action** (`.github/workflows/update-apps.yml`): Automatically runs build, lint-fix, and commits changes when src files are modified
- **Content Synchronization**: README.md is automatically updated with generated content using automd markers
- **Asset Management**: Exchange logos are automatically downloaded and managed

## Important Notes

- All changes should be made to JSON files in `src/data/`, not to the generated markdown files
- The build system automatically handles README.md updates - do not manually edit automd sections
- Exchange data is automatically fetched from Nimiq's API during build
- Asset paths in JSON should be relative (e.g., `"./assets/logo.svg"`)
- Distribution files contain absolute GitHub URLs for external consumption
- ESLint uses @antfu/eslint-config with TypeScript support