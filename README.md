# Contour Server

A dedicated server for generating contour vector tiles from terrain data sources. Built with Express and [maplibre-contour](https://github.com/onthegomap/maplibre-contour), this server provides on-demand contour line generation from raster DEM (Digital Elevation Model) sources.

## Features

- 🗺️ **On-demand contour generation** - Generate contour vector tiles dynamically from raster terrain sources
- ⚙️ **Flexible configuration** - Support for multiple terrain sources with customizable contour options
- 🎯 **Zoom-dependent contours** - Configure different contour intervals for different zoom levels
- 🚀 **Fast and efficient** - Uses sharp for image processing and includes caching support
- 🌐 **CORS enabled** - Ready to use from web applications
- 📦 **Standard tile format** - Outputs gzipped Mapbox Vector Tiles (.pbf)

## Installation

```bash
npm install
```

## Usage

Create a `config.json` file (see Configuration section below), then start the server:

```bash
node . config.json
```

The server will start on port 3000 (or the port specified in your config) and display available endpoints.

## Configuration

Create a `config.json` file to define your terrain sources and contour options:

```json
{
  "sources": {
    "terrain-rgb": {
      "type": "raster-dem",
      "tiles": [
        "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"
      ],
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
      "type": "raster-dem",
      "tiles": [
        "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"
      ],
      "encoding": "terrarium",
      "maxzoom": 14,
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
    }
  },
  "server": {
    "port": 3000
  }
}
```

### Source Configuration

Each source in the `sources` object supports the following options:

#### Required Options

- **`tiles`** (array) - Array of tile URL templates (e.g., `["https://example.com/{z}/{x}/{y}.png"]`)
- **`encoding`** (string) - DEM encoding format: `"terrarium"` or `"mapbox"`

#### Optional Options

- **`type`** (string) - Source type, typically `"raster-dem"` (default: `"raster-dem"`)
- **`maxzoom`** (number) - Maximum zoom level of the source DEM (default: `14`)
- **`tileSize`** (number) - Tile size in pixels (default: `256`)
- **`cacheSize`** (number) - Number of tiles to cache in memory (default: `100`)
- **`timeoutMs`** (number) - Timeout for fetching source tiles in milliseconds (default: `10000`)

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

The server automatically selects the appropriate interval based on the tile's zoom level.

## API Endpoints

### Contour Tiles

```
GET /contours/{sourceName}/{z}/{x}/{y}.pbf
```

Returns a gzipped Mapbox Vector Tile containing contour lines for the specified tile coordinates.

**Response Headers:**
- `Content-Type: application/x-protobuf`
- `Content-Encoding: gzip`
- `Cache-Control: public, max-age=86400`

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

Returns detailed information about all configured sources.

**Example Response:**
```json
{
  "terrain-rgb": {
    "tiles": ["https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"],
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
  maxzoom: 14
});

map.addLayer({
  id: 'contour-lines',
  type: 'line',
  source: 'contours',
  'source-layer': 'contours',
  paint: {
    'line-color': '#877b59',
    'line-width': 1
  }
});

map.addLayer({
  id: 'contour-labels',
  type: 'symbol',
  source: 'contours',
  'source-layer': 'contours',
  filter: ['==', ['get', 'level'], 1],
  layout: {
    'symbol-placement': 'line',
    'text-field': ['concat', ['get', 'ele'], 'm'],
    'text-font': ['Open Sans Regular'],
    'text-size': 10
  },
  paint: {
    'text-color': '#877b59',
    'text-halo-color': '#fff',
    'text-halo-width': 1
  }
});
```

## Development

Run with automatic restart on file changes:

```bash
npm run dev
```

## Dependencies

- **express** - Web framework
- **maplibre-contour** - Contour line generation
- **sharp** - High-performance image processing

## License

BSD 2-Clause License

## Credits

Built with [maplibre-contour](https://github.com/onthegomap/maplibre-contour) by @onthegomap.

## Related Projects

- [tileserver-gl](https://github.com/maptiler/tileserver-gl) - Vector and raster tile server
- [contour-generator](https://github.com/acalcutt/contour-generator) - Batch contour tile generation tool

