# API Access

You can use this repository as a data source by making HTTP requests to the distribution files. All data is available in JSON format with absolute URLs for easy consumption.

## Available Endpoints

**Apps & Wallets:**
```
https://raw.githubusercontent.com/onmax/nimiq-awesome/main/src/data/dist/nimiq-apps.json
```

**Developer Resources:**
```
https://raw.githubusercontent.com/onmax/nimiq-awesome/main/src/data/dist/nimiq-resources.json
```

**Exchanges:**
```
https://raw.githubusercontent.com/onmax/nimiq-awesome/main/src/data/dist/nimiq-exchanges.json
```

**Open RPC Servers:**
```
https://raw.githubusercontent.com/onmax/nimiq-awesome/main/src/data/dist/rpc-servers.json
```

## Features

- **Absolute URLs**: All assets (logos, screenshots) include full GitHub URLs
- **Auto-Generated**: Distribution files are automatically updated when source data changes
- **Structured Data**: Consistent JSON schema across all endpoints
- **Cross-Origin Friendly**: Raw GitHub URLs support CORS for browser requests
- **Always Available**: GitHub's CDN ensures high availability and performance

## Caching Considerations

> [!NOTE]
> Distribution files are automatically generated and may have slight delays between source updates and availability. For production applications, consider:
>
> - Implementing appropriate TTL values (recommended: 1-24 hours)
> - Using ETags for conditional requests
> - Having fallback mechanisms for network failures
> - Caching responses locally when possible

## Rate Limits

GitHub's raw file serving has rate limits:
- **Authenticated requests**: 5,000 requests per hour
- **Unauthenticated requests**: 60 requests per hour per IP

For high-volume applications, consider:
- Caching responses locally
- Using GitHub API with authentication
- Implementing exponential backoff for retries

## Support

If you encounter issues with the API endpoints or need additional data formats, please [open an issue](https://github.com/onmax/nimiq-awesome/issues) in the repository.