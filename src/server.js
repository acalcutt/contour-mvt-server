#!/usr/bin/env node

import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { promisify } from 'util';
import { gzip } from 'zlib';
import mlcontour from 'maplibre-contour';
import cors from 'cors';
import {
  openPMtiles,
  getPMtilesTile,
  pmtilesTester,
  httpTester
} from './pmtiles-utils.js';
import {
  openMBTiles,
  getMBTilesTile,
  mbtilesTester,
} from './mbtiles-utils.js';
import {
  GetImageData,
  createBlankTileImage,
  parseZXYFromUrl,
  getOptionsForZoom,
} from './mlcontour-utils.js';

const gzipP = promisify(gzip);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// Default contour options (from your current server.js)
const DEFAULT_CONTOUR_OPTIONS = {
  multiplier: 1,
  contourLayer: 'contours',
  elevationKey: 'ele',
  levelKey: 'level',
  extent: 4096,
  buffer: 1,
  thresholds: {
    1: [600, 3000],
    4: [300, 1500],
    8: [150, 750],
    9: [80, 400],
    10: [40, 200],
    11: [20, 100],
    12: [10, 50],
    14: [5, 25],
    16: [1, 5],
  }
};

// Helper function to check if a path is a local file path (Unix or Windows)
function isLocalPath(pathStr) {
  // Check for Unix absolute path
  if (pathStr.startsWith('/')) {
    return true;
  }
  // Check for Windows absolute path (e.g., C:/, C://, C:\, etc.)
  if (/^[a-zA-Z]:[\\/]/.test(pathStr)) {
    return true;
  }
  return false;
}

// --- Global variables for parsed config and contour sources ---
let config = {};
let contourSources = {};
let GLOBAL_BLANK_TILE_SETTINGS = {}; // New global variable for blank tile settings

// Load and validate configuration
function loadConfig(configPath) {
  try {
    const configFile = fs.readFileSync(configPath, 'utf8');
    const parsedConfig = JSON.parse(configFile);
    
    if (!parsedConfig.sources || Object.keys(parsedConfig.sources).length === 0) {
      throw new Error('Config must contain at least one source');
    }

    // Set global blank tile defaults
    GLOBAL_BLANK_TILE_SETTINGS = {
      blankTileNoDataValue: parsedConfig.blankTileNoDataValue ?? 0,
      blankTileSize: parsedConfig.blankTileSize ?? 256,
      blankTileFormat: parsedConfig.blankTileFormat ?? 'png'
    };
    
    for (const [name, source] of Object.entries(parsedConfig.sources)) {
      // Normalize tiles to always be a string (accept both string and array)
      if (Array.isArray(source.tiles)) {
        if (source.tiles.length === 0) {
          throw new Error(`Source "${name}" must have a non-empty tiles value`);
        }
        source.tiles = source.tiles[0]; // Use first element if array
      } else if (typeof source.tiles !== 'string') {
        throw new Error(`Source "${name}" tiles must be a string or array`);
      }
      
      if (!source.encoding) {
        throw new Error(`Source "${name}" must specify encoding (e.g., "terrarium" or "mapbox")`);
      }
      
      const demUrl = source.tiles;

      if (pmtilesTester.test(demUrl)) {
        const actualPathOrUrl = demUrl.replace(pmtilesTester, "");
        if (!isLocalPath(actualPathOrUrl) && !httpTester.test(actualPathOrUrl)) {
          throw new Error(`Invalid PMTiles URL for source "${name}": ${demUrl}. Must be 'pmtiles:///local/path', 'pmtiles://C://path' (Windows), or 'pmtiles://http(s)://url'`);
        }
      } else if (mbtilesTester.test(demUrl)) {
        const actualPath = demUrl.replace(mbtilesTester, "");
        if (!isLocalPath(actualPath)) {
          throw new Error(`Invalid MBTiles URL for source "${name}": ${demUrl}. Must be 'mbtiles:///local/path' or 'mbtiles://C://path' (Windows)`);
        }
        if (!fs.existsSync(actualPath)) {
          throw new Error(`MBTiles file not found for source "${name}": ${actualPath}`);
        }
      } else if (!httpTester.test(demUrl)) {
        throw new Error(`Invalid DEM URL for source "${name}": ${demUrl}. Must start with 'pmtiles://', 'mbtiles://', 'http://', or 'https://'`);
      }
      
      if (source.contours) {
        if (source.contours.levels && source.contours.thresholds) {
          throw new Error(`Source "${name}" cannot specify both levels and thresholds`);
        }
      }

      // Validate blank tile format if specified at source level
      if (source.blankTileFormat && !['png', 'webp', 'jpeg'].includes(source.blankTileFormat)) {
        throw new Error(`Source "${name}" has an invalid blankTileFormat: "${source.blankTileFormat}". Must be 'png', 'webp', or 'jpeg'.`);
      }
    }
    
    return parsedConfig;
  } catch (error) {
    console.error('Error loading config:', error.message);
    process.exit(1);
  }
}

// Merge source-specific contour options with defaults
function getContourOptions(source) {
  const options = { ...DEFAULT_CONTOUR_OPTIONS };
  
  if (source.contours) {
    Object.assign(options, source.contours);
    
    if (source.contours.levels) {
      delete options.thresholds;
    }
  }
  
  return options;
}

// Cache for opened PMTiles/MBTiles files
const pmtilesCache = new Map();
const mbtilesCache = new Map();

// Initialize DEM managers for each source
async function setupContourEndpoints(currentConfig) {
  const currentContourSources = {};
  
  for (const [sourceName, source] of Object.entries(currentConfig.sources)) {
    const contourOptions = getContourOptions(source);
    const demUrl = source.tiles; // Now always a string
    
    let demManagerOptions = {
      cacheSize: source.cacheSize || 100,
      encoding: source.encoding,
      maxzoom: source.maxzoom || 14,
      timeoutMs: source.timeoutMs || 10000,
      decodeImage: GetImageData,
    };

    let pmtilesInstance = undefined;
    let mbtilesHandle = undefined;

    // Determine blank tile settings for this specific source, falling back to global defaults
    const sourceBlankTileNoDataValue = source.blankTileNoDataValue ?? GLOBAL_BLANK_TILE_SETTINGS.blankTileNoDataValue;
    const sourceBlankTileSize = source.blankTileSize ?? GLOBAL_BLANK_TILE_SETTINGS.blankTileSize;
    const sourceBlankTileFormat = source.blankTileFormat ?? GLOBAL_BLANK_TILE_SETTINGS.blankTileFormat;


    if (pmtilesTester.test(demUrl)) {
      const pmtilesActualPathOrUrl = demUrl.replace(pmtilesTester, "");
      pmtilesInstance = openPMtiles(pmtilesActualPathOrUrl);
      pmtilesCache.set(sourceName, pmtilesInstance); 

      demManagerOptions.getTile = async (url, abortController) => {
        const zxy = parseZXYFromUrl(url); 
        if (!zxy) {
          throw new Error(`Could not extract ZXY from DEM URL for PMTiles: ${url}`);
        }
        const { data, mimeType } = await getPMtilesTile(pmtilesInstance, zxy.z, zxy.x, zxy.y);
        
        if (!data) {
          console.warn(`PMTiles tile not found for ${sourceName} (${zxy.z}/${zxy.x}/${zxy.y}). Generating blank tile.`);
          const blankTileBuffer = await createBlankTileImage(
            sourceBlankTileSize,
            sourceBlankTileSize,
            sourceBlankTileNoDataValue,
            source.encoding,
            sourceBlankTileFormat,
          );
          return { data: new Blob([blankTileBuffer], { type: mimeType || `image/${sourceBlankTileFormat}` }), mimeType: mimeType || `image/${sourceBlankTileFormat}` };
        }
        return { data: new Blob([data], { type: mimeType || 'application/octet-stream' }), mimeType: mimeType };
      };
      demManagerOptions.demUrlPattern = '/{z}/{x}/{y}'; 
      
      console.log(`✓ Configured PMTiles terrain source: ${sourceName} from ${pmtilesActualPathOrUrl}`);

    } else if (mbtilesTester.test(demUrl)) {
      const mbtilesActualPath = demUrl.replace(mbtilesTester, "");
      mbtilesHandle = (await openMBTiles(demUrl)).handle;
      mbtilesCache.set(sourceName, mbtilesHandle); 

      demManagerOptions.getTile = async (url, abortController) => {
        const zxy = parseZXYFromUrl(url);
        if (!zxy) {
          throw new Error(`Could not extract ZXY from DEM URL for MBTiles: ${url}`);
        }
        const { data, contentType } = await getMBTilesTile(mbtilesHandle, zxy.z, zxy.x, zxy.y);
        
        if (!data) {
          console.warn(`MBTiles tile not found for ${sourceName} (${zxy.z}/${zxy.x}/${zxy.y}). Generating blank tile.`);
          const blankTileBuffer = await createBlankTileImage(
            sourceBlankTileSize,
            sourceBlankTileSize,
            sourceBlankTileNoDataValue,
            source.encoding,
            sourceBlankTileFormat,
          );
          return { data: new Blob([blankTileBuffer], { type: contentType || `image/${sourceBlankTileFormat}` }), mimeType: contentType || `image/${sourceBlankTileFormat}` };
        }
        return { data: new Blob([data], { type: contentType || 'application/octet-stream' }), mimeType: contentType };
      };
      demManagerOptions.demUrlPattern = '/{z}/{x}/{y}'; 

      console.log(`✓ Configured MBTiles terrain source: ${sourceName} from ${mbtilesActualPath}`);

    } else {
      // Default HTTP DEM tile fetching (URLs starting with http(s)://)
      demManagerOptions.demUrlPattern = demUrl;
      console.log(`✓ Configured HTTP DEM terrain source: ${sourceName} from ${demUrl}`);
    }
    
    // Always create a LocalDemManager
    const manager = new mlcontour.LocalDemManager(demManagerOptions);
    
    currentContourSources[sourceName] = {
      type: 'contour', 
      manager,
      contourOptions,
      sourceConfig: source, 
    };
  }
  
  return currentContourSources;
}

// Main initialization
const configPath = process.argv[2] || './config.json';
console.log(`Loading configuration from: ${configPath}`);

config = loadConfig(configPath); // Assign to global config
contourSources = await setupContourEndpoints(config); // Assign to global contourSources

// CORS middleware
app.use(cors());

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    sources: Object.keys(config.sources),
    version: '1.0.0'
  });
});

// List available sources
app.get('/sources', (req, res) => {
  const sourcesInfo = {};
  for (const [name, sourceData] of Object.entries(contourSources)) {
    sourcesInfo[name] = {
      type: sourceData.type,
      tiles: sourceData.sourceConfig.tiles,
      encoding: sourceData.sourceConfig.encoding,
      maxzoom: sourceData.sourceConfig.maxzoom || 14,
      contours: getContourOptions(sourceData.sourceConfig),
      // Include blank tile settings in the source info for debugging/API users
      blankTileNoDataValue: sourceData.sourceConfig.blankTileNoDataValue ?? GLOBAL_BLANK_TILE_SETTINGS.blankTileNoDataValue,
      blankTileSize: sourceData.sourceConfig.blankTileSize ?? GLOBAL_BLANK_TILE_SETTINGS.blankTileSize,
      blankTileFormat: sourceData.sourceConfig.blankTileFormat ?? GLOBAL_BLANK_TILE_SETTINGS.blankTileFormat,
      endpoint: `/contours/${name}/{z}/{x}/{y}.pbf`
    };
  }
  res.json(sourcesInfo);
});

// Contour tile endpoint (remains largely the same, but simplified)
app.get('/contours/:source/:z/:x/:y.pbf', async (req, res) => {
  const { source, z, x, y } = req.params;
  
  const sourceData = contourSources[source];
  if (!sourceData) { 
    return res.status(404).json({
      error: `Source "${source}" not found`,
      available: Object.keys(contourSources)
    });
  }
  
  const zoom = parseInt(z);
  const tileX = parseInt(x);
  const tileY = parseInt(y);
  
  if (isNaN(zoom) || isNaN(tileX) || isNaN(tileY)) {
    return res.status(400).json({ error: 'Invalid tile coordinates' });
  }
  
  try {
    const { manager, contourOptions } = sourceData;
    
    let tileOptions = contourOptions;
    if (contourOptions.thresholds) {
      tileOptions = getOptionsForZoom(contourOptions, zoom); 
    }
    
    const tile = await manager.fetchContourTile(
      zoom,
      tileX,
      tileY,
      tileOptions,
      new AbortController()
    );
    
    if (!tile || !tile.arrayBuffer) {
      return res.status(204).send();
    }
    
    let data = Buffer.from(tile.arrayBuffer);
    data = await gzipP(data);
    
    console.log(`Generated contour tile ${source}/${z}/${x}/${y}: ${data.length} bytes (gzipped)`);
    
    res.set('Content-Type', 'application/x-protobuf');
    res.set('Content-Encoding', 'gzip');
    res.set('Content-Length', data.length.toString());
    //res.set('Cache-Control', 'public, max-age=86400');
    
    res.send(data);
  } catch (error) {
    console.error(`Error generating contour tile ${source}/${z}/${x}/${y}:`, error);
    res.status(500).json({ error: 'Error generating contour tile' });
  }
});


// Graceful shutdown handler
let server;

function gracefulShutdown(signal) {
  console.log(`\n${signal} received, shutting down gracefully...`);
  
  if (server) {
    server.close(() => {
      console.log('Server closed');
      process.exit(0);
    });
    
    setTimeout(() => {
      console.error('Could not close connections in time, forcefully shutting down');
      process.exit(1);
    }, 10000);
  } else {
    process.exit(0);
  }
}

// Handle signals
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

// Start server and save reference
const port = config.server?.port || 3000;
server = app.listen(port, () => {
  console.log(`\n🗺️  Contour Server running on port ${port}`);
  console.log(`   Health check: http://localhost:${port}/health`);
  console.log(`   Sources list: http://localhost:${port}/sources`);
  console.log('\nConfigured contour endpoints:');
  Object.keys(config.sources).forEach(name => {
    console.log(`   -> ${name}: http://localhost:${port}/contours/${name}/{z}/{x}/{y}.pbf`);
  });
});

export default app;
