# Contour MVT Server

A dedicated server for generating contour vector tiles from terrain data sources. Built with Express and [maplibre-contour](https://github.com/onthegomap/maplibre-contour), this server provides on-demand contour line generation from raster DEM (Digital Elevation Model) sources.

## Features

- 🗺️ **On-demand contour generation** - Generate contour vector tiles dynamically from raster terrain sources
- ⚙️ **Flexible configuration** - Support for multiple terrain sources with customizable contour options
- 🎯 **Zoom-dependent contours** - Configure different contour intervals for different zoom levels
- 🚀 **Fast and efficient** - Uses sharp for image processing and includes caching support
- 🌐 **CORS enabled** - Ready to use from web applications
- 📦 **Standard tile format** - Outputs gzipped Mapbox Vector Tiles (.pbf)
- 📁 **Multiple source formats** - Supports HTTP(S) tile servers, PMTiles archives (local and remote), and MBTiles databases

## Use from docker

```bash
wget https://raw.githubusercontent.com/acalcutt/contour-mvt-server/refs/heads/main/config.json
docker run --rm -it -v $(pwd):/data -p 3000:3000 wifidb/contour-mvt-server:latest config.json
```

## Use from npm globally

```bash
wget https://raw.githubusercontent.com/acalcutt/contour-mvt-server/refs/heads/main/config.json
npm install -g contour-mvt-server
contour-mvt-server config.json
```

## Use from source

```bash
git clone https://github.com/acalcutt/contour-mvt-server.git
cd contour-mvt-server
npm install
wget https://raw.githubusercontent.com/acalcutt/contour-mvt-server/refs/heads/main/config.json
node . config.json
```

The server will start on port 3000 (or the port specified in your config) and display available endpoints.

## Configuration

Create a `config.json` file to define your terrain sources and contour options:

```json
{
  "server": {
    "port": 3000
  },
  "blankTileNoDataValue": 0,
  "blankTileSize": 256,
  "blankTileFormat": "png",
  "sources": {
    "terrain-rgb": {
      "tiles": "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png",
      "encoding": "terrarium",
      "maxzoom": 15,
      "contours": {
        "multiplier": 1,
        "levels": [100],
        "contourLayer": "contours",
        "elevationKey": "ele",
        "levelKey": "level",
        "extent": 4096,
        "buffer": 1
      }
    },
    "mapzen-detailed": {
      "tiles": "https://s3.amazonaws.com/elevation-ties-prod/terrarium/{z}/{x}/{y}.png",
      "encoding": "terrarium",
      "maxzoom": 15,
      "contours": {
        "multiplier": 1,
        "thresholds": {
          "1": [600, 3000],
          "4": [300, 1500],
          "8": [150, 750],
          "9": [80, 400],
          "10": [40, 200],
          "11": [20, 100],
          "12": [10, 50],
          "14": [5, 25],
          "16": [1, 5]
        }
      }
    },
    "terrain-pmtiles": {
      "tiles": "pmtiles://https://example.com/terrain.pmtiles",
      "encoding": "terrarium",
      "maxzoom": 14
    },
    "local-terrain": {
      "tiles": "mbtiles:///var/data/terrain.mbtiles",
      "encoding": "mapbox",
      "maxzoom": 12,
      "blankTileNoDataValue": -10000
    }
  }
}
```

### Global Configuration Options

The root level of the configuration file supports the following options:

- **`server.port`** (number) - Port number for the server to listen on (default: `3000`)
- **`blankTileNoDataValue`** (number) - Global default elevation value for blank tiles when DEM tile is missing (default: `0`)
- **`blankTileSize`** (number) - Global default size (width/height) for generated blank tiles (default: `256`)
- **`blankTileFormat`** (string) - Global default format for blank tiles: `"png"`, `"webp"`, or `"jpeg"` (default: `"png"`)

These global settings apply to all sources unless overridden at the source level.

### DEM Tile Source Formats

The server supports multiple formats for DEM tile sources in the `tiles` array:

#### HTTP/HTTPS Tile Servers

Standard tile server URLs with `{z}`, `{x}`, `{y}` placeholders:

```json
{
  "tiles": "https://example.com/dem/{z}/{x}/{y}.png"
}
```

#### PMTiles Archives

PMTiles archives can be served from local files or remote HTTP(S) URLs:

**Remote PMTiles (HTTP/HTTPS):**
```json
{
  "tiles": "pmtiles://https://example.com/terrain.pmtiles"
}
```

**Local PMTiles (Linux/macOS):**
```json
{
  "tiles": "pmtiles:///absolute/path/to/terrain.pmtiles"
}
```

**Local PMTiles (Windows):**
```json
{
  "tiles": "pmtiles://C://path//to//terrain.pmtiles"
}
```

*Note: For Windows paths, use `//` as path separators in the pmtiles:// URL.*

#### MBTiles Databases

MBTiles databases (local files only):

**Local MBTiles (Linux/macOS):**
```json
{
  "tiles": "mbtiles:///absolute/path/to/terrain.mbtiles"
}
```

**Local MBTiles (Windows):**
```json
{
  "tiles": "mbtiles://C://path//to//terrain.mbtiles"
}
```

*Note: For Windows paths, use `//` as path separators in the mbtiles:// URL.*

### Source Configuration

Each source in the `sources` object supports the following options:

#### Required Options

- **`tiles`** (string) - Tile URL or path. Supports HTTP(S), PMTiles, and MBTiles formats
- **`encoding`** (string) - DEM encoding format: `"terrarium"` or `"mapbox"`

#### Optional Options

- **`maxzoom`** (number) - Maximum zoom level of the source DEM (default: `14`)
- **`cacheSize`** (number) - Number of DEM tiles to cache in memory (default: `100`)
- **`timeoutMs`** (number) - Timeout for fetching source tiles in milliseconds (default: `10000`)
- **`blankTileNoDataValue`** (number) - Source-specific elevation value for blank tiles (overrides global setting)
- **`blankTileSize`** (number) - Source-specific size for blank tiles (overrides global setting)
- **`blankTileFormat`** (string) - Source-specific format for blank tiles: `"png"`, `"webp"`, or `"jpeg"` (overrides global setting)
- **`contours`** (object) - Contour generation options (see below)

### Blank Tile Handling

When a DEM tile is missing from the source, the server generates a blank tile instead of failing. This behavior can be configured globally and per-source:

- **Global defaults** apply to all sources unless overridden
- **Source-specific settings** override global defaults for that source
- Blank tiles use the specified `noDataValue` for all pixels
- The encoding format determines how the elevation value is stored in the image

Example configuration with blank tile settings:

```json
{
  "blankTileNoDataValue": 0,
  "blankTileSize": 256,
  "blankTileFormat": "png",
  "sources": {
    "high-res-terrain": {
      "tiles": "pmtiles:///data/terrain-high.pmtiles",
      "encoding": "terrarium",
      "blankTileNoDataValue": -32768,
      "blankTileFormat": "webp"
    },
    "low-res-terrain": {
      "tiles": "mbtiles:///data/terrain-low.mbtiles",
      "encoding": "mapbox"
      // Uses global blank tile settings
    }
  }
}
```

### Contour Options

The `contours` object within each source supports:

- **`multiplier`** (number) - Elevation multiplier (default: `1`)
- **`levels`** (array) - Fixed contour intervals (e.g., `[100]` for 100m contours)
- **`thresholds`** (object) - Zoom-dependent contour intervals (see below)
- **`contourLayer`** (string) - Layer name in the vector tile (default: `"contours"`)
- **`elevationKey`** (string) - Property name for elevation values (default: `"ele"`)
- **`levelKey`** (string) - Property name for contour level (default: `"level"`)
- **`extent`** (number) - Tile extent (default: `4096`)
- **`buffer`** (number) - Tile buffer (default: `1`)

**Note:** You cannot specify both `levels` and `thresholds` in the same source. Use `levels` for fixed intervals or `thresholds` for zoom-dependent intervals.

#### Thresholds Format

The `thresholds` object maps zoom levels to contour intervals:

```json
"thresholds": {
  "1": [600, 3000],    // At zoom 1-3: minor contours every 600m, major every 3000m
  "4": [300, 1500],    // At zoom 4-7: minor every 300m, major every 1500m
  "8": [150, 750],     // At zoom 8: minor every 150m, major every 750m
  "12": [10, 50]       // At zoom 12+: minor every 10m, major every 50m
}
```

The server automatically selects the appropriate interval based on the tile's zoom level. Each entry specifies `[minor_interval, major_interval]` in elevation units.

## API Endpoints

### Contour Tiles

```
GET /contours/{sourceName}/{z}/{x}/{y}.pbf
```

Returns a gzipped Mapbox Vector Tile containing contour lines for the specified tile coordinates.

**Response Headers:**
- `Content-Type: application/x-protobuf`
- `Content-Encoding: gzip`

**Response Status Codes:**
- `200` - Success (tile generated)
- `204` - No content (empty tile)
- `404` - Source not found
- `400` - Invalid tile coordinates
- `500` - Server error

### Health Check

```
GET /health
```

Returns server status and list of configured sources.

**Example Response:**
```json
{
  "status": "ok",
  "sources": ["terrain-rgb", "mapzen-detailed"],
  "version": "1.0.0"
}
```

### List Sources

```
GET /sources
```

Returns detailed information about all configured sources, including their settings and endpoints.

**Example Response:**
```json
{
  "terrain-rgb": {
    "type": "contour",
    "tiles": "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png",
    "encoding": "terrarium",
    "maxzoom": 15,
    "contours": {
      "multiplier": 1,
      "levels": [100],
      "contourLayer": "contours",
      "elevationKey": "ele",
      "levelKey": "level",
      "extent": 4096,
      "buffer": 1
    },
    "blankTileNoDataValue": 0,
    "blankTileSize": 256,
    "blankTileFormat": "png",
    "endpoint": "/contours/terrain-rgb/{z}/{x}/{y}.pbf"
  }
}
```

## Using with MapLibre GL JS

Add the contour tiles as a vector source in your MapLibre GL JS map:

```javascript
map.addSource('contours', {
  type: 'vector',
  tiles: ['http://localhost:3000/contours/terrain-rgb/{z}/{x}/{y}.pbf'],
  minzoom: 0,
  maxzoom: 16
});

map.addLayer({
  id: 'contour-lines',
  type: 'line',
  source: 'contours',
  'source-layer': 'contours',
  filter: ['>', ['get', 'ele'], 0],
  paint: {
    'line-color': 'rgba(0,0,0, 50%)',
    'line-width': ['match', ['get', 'level'], 1, 1, 0.5]
  }
});

map.addLayer({
  id: 'contour-labels',
  type: 'symbol',
  source: 'contours',
  'source-layer': 'contours',
  filter: [
    'all',
    ['>', ['get', 'ele'], 0],
    ['==', ['get', 'level'], 1]
  ],
  layout: {
    'symbol-placement': 'line',
    'text-field': ['concat', ['number-format', ['get', 'ele'], {}], 'm'],
    'text-font': ['Open Sans Regular'],
    'text-size': 11
  },
  paint: {
    'text-halo-color': '#fff',
    'text-halo-width': 1
  }
});
```

## Dependencies

- **express** - Web framework
- **maplibre-contour** - Contour line generation
- **sharp** - High-performance image processing
- **pmtiles** - PMTiles archive support
- **@mapbox/mbtiles** - MBTiles database support

## License

BSD 2-Clause License

## Credits

Built with [maplibre-contour](https://github.com/onthegomap/maplibre-contour) by @onthegomap.

## Related Projects

- [tileserver-gl](https://github.com/maptiler/tileserver-gl) - Vector and raster tile server
- [contour-generator](https://github.com/acalcutt/contour-generator) - Batch contour tile generation tool
