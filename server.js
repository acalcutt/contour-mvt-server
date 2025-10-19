// contour-server - A dedicated server for generating contour vector tiles
// Based on maplibre-contour

import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mlcontour from 'maplibre-contour';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// Default contour options
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

// Load and validate configuration
function loadConfig(configPath) {
  try {
    const configFile = fs.readFileSync(configPath, 'utf8');
    const config = JSON.parse(configFile);
    
    // Validate config structure
    if (!config.sources || Object.keys(config.sources).length === 0) {
      throw new Error('Config must contain at least one source');
    }
    
    // Validate each source
    for (const [name, source] of Object.entries(config.sources)) {
      if (!source.tiles || !Array.isArray(source.tiles)) {
        throw new Error(`Source "${name}" must have a tiles array`);
      }
      if (!source.encoding) {
        throw new Error(`Source "${name}" must specify encoding (e.g., "terrarium" or "mapbox")`);
      }
      
      // Validate contour options if present
      if (source.contours) {
        if (source.contours.levels && source.contours.thresholds) {
          throw new Error(`Source "${name}" cannot specify both levels and thresholds`);
        }
      }
    }
    
    return config;
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
    
    // Remove thresholds if levels is specified
    if (source.contours.levels) {
      delete options.thresholds;
    }
  }
  
  return options;
}

// Get contour options for a specific zoom level (handles thresholds)
function getOptionsForZoom(contourOptions, zoom) {
  if (!contourOptions.thresholds) {
    return contourOptions;
  }

  // Find the appropriate threshold for this zoom level
  const zooms = Object.keys(contourOptions.thresholds)
    .map(Number)
    .sort((a, b) => a - b);
  
  let selectedZoom = zooms[0];
  for (const z of zooms) {
    if (zoom >= z) {
      selectedZoom = z;
    } else {
      break;
    }
  }

  const levels = contourOptions.thresholds[selectedZoom];
  
  return {
    ...contourOptions,
    levels: levels,
    thresholds: undefined
  };
}

// Initialize DEM managers for each source
function setupContourEndpoints(config) {
  const demManagers = {};
  
  for (const [sourceName, source] of Object.entries(config.sources)) {
    const contourOptions = getContourOptions(source);
    
    // Create DEM manager options
    const demManagerOptions = {
      cacheSize: source.cacheSize || 100,
      encoding: source.encoding,
      maxzoom: source.maxzoom || 14,
      timeoutMs: source.timeoutMs || 10000,
      demUrlPattern: source.tiles[0], // Use first tile URL as pattern
    };
    
    // Create LocalDemManager instance
    const manager = new mlcontour.LocalDemManager(demManagerOptions);
    
    demManagers[sourceName] = {
      manager,
      contourOptions,
      source
    };
    
    console.log(`✓ Configured contour endpoint: /contours/${sourceName}/{z}/{x}/{y}.pbf`);
  }
  
  return demManagers;
}

// Main initialization
const configPath = process.argv[2] || './config.json';
console.log(`Loading configuration from: ${configPath}`);

const config = loadConfig(configPath);
const demManagers = setupContourEndpoints(config);

// CORS middleware
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

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
  const sources = {};
  for (const [name, source] of Object.entries(config.sources)) {
    sources[name] = {
      tiles: source.tiles,
      encoding: source.encoding,
      maxzoom: source.maxzoom || 14,
      contours: getContourOptions(source),
      endpoint: `/contours/${name}/{z}/{x}/{y}.pbf`
    };
  }
  res.json(sources);
});

// Contour tile endpoint
app.get('/contours/:source/:z/:x/:y.pbf', async (req, res) => {
  const { source, z, x, y } = req.params;
  
  // Check if source exists
  if (!demManagers[source]) {
    return res.status(404).json({
      error: 'Source not found',
      available: Object.keys(demManagers)
    });
  }
  
  // Parse coordinates
  const zoom = parseInt(z);
  const tileX = parseInt(x);
  const tileY = parseInt(y);
  
  if (isNaN(zoom) || isNaN(tileX) || isNaN(tileY)) {
    return res.status(400).json({ error: 'Invalid tile coordinates' });
  }
  
  try {
    const { manager, contourOptions } = demManagers[source];
    
    // Get zoom-specific options if using thresholds
    let tileOptions = contourOptions;
    if (contourOptions.thresholds) {
      tileOptions = getOptionsForZoom(contourOptions, zoom);
    }
    
    // Fetch contour tile from maplibre-contour
    const tile = await manager.fetchContourTile(
      zoom,
      tileX,
      tileY,
      tileOptions,
      new AbortController()
    );
    
    if (!tile) {
      return res.status(204).send();
    }
    
    // Convert to Buffer
    const tileBuffer = Buffer.from(tile.arrayBuffer);
    
    // Set appropriate headers
    res.set('Content-Type', 'application/x-protobuf');
    res.set('Content-Encoding', 'gzip');
    res.set('Cache-Control', 'public, max-age=86400'); // Cache for 24 hours
    
    res.send(tileBuffer);
  } catch (error) {
    console.error(`Error generating contour tile ${source}/${z}/${x}/${y}:`, error);
    res.status(500).json({ error: 'Error generating contour tile' });
  }
});

// Start server
const port = config.server?.port || 3000;
app.listen(port, () => {
  console.log(`\n🗺️  Contour Server running on port ${port}`);
  console.log(`   Health check: http://localhost:${port}/health`);
  console.log(`   Sources list: http://localhost:${port}/sources`);
  console.log('\nConfigured sources:');
  Object.keys(config.sources).forEach(name => {
    console.log(`   - ${name}: http://localhost:${port}/contours/${name}/{z}/{x}/{y}.pbf`);
  });
});

export default app;
