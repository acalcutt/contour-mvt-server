// pmtiles-utils.js
import fs from "node:fs";
import { PMTiles, FetchSource } from "pmtiles";
// path is no longer needed in this module, as server.js handles full path resolution
// import path from "node:path"; 

export const httpTester = /^https?:\/\//i; // Correctly detects http or https
export const pmtilesTester = /^pmtiles:\/\//i;

export class PMTilesFileSource {
  fd; 
  constructor(fd) {
    this.fd = fd;
  }
  getKey() {
    return String(this.fd);
  }
  async getBytes(
    offset,
    length,
  ) {
    const buffer = Buffer.alloc(length);
    await readFileBytes(this.fd, buffer, offset);
    return {
      data: buffer.buffer.slice(
        buffer.byteOffset,
        buffer.byteOffset + buffer.byteLength,
      ),
    };
  }
}

async function readFileBytes(
  fd,
  buffer,
  offset,
) {
  return new Promise((resolve, reject) => {
    fs.read(fd, buffer, 0, buffer.length, offset, (err, bytesRead, _buff) => {
      if (err) return reject(err);
      if (bytesRead !== buffer.length)
        return reject(
          new Error(`Failed to read ${buffer.length} bytes, got ${bytesRead}`),
        );
      resolve();
    });
  });
}

function getPmtilesMimeTypeFromTypeNum(tileTypeNum) {
  switch (tileTypeNum) {
    case 1:
      return "application/x-protobuf"; // pbf
    case 2:
      return "image/png";
    case 3:
      return "image/jpeg";
    case 4:
      return "image/webp";
    case 5:
      return "image/avif";
    default:
      return "application/octet-stream";
  }
}

/**
 * Opens a PMTiles file from a given path or URL.
 * Assumes the input `pmtilesPathOrUrl` is already stripped of `pmtiles://`
 * and is either a local absolute file path or an http(s) URL.
 * @param {string} pmtilesPathOrUrl - The full local path to the PMTiles file or its http(s) URL.
 * @returns {PMTiles} An opened PMTiles instance.
 */
export function openPMtiles(pmtilesPathOrUrl) {
  let pmtiles;

  try {
    if (httpTester.test(pmtilesPathOrUrl)) { // Check if it's an http(s) URL
      const source = new FetchSource(pmtilesPathOrUrl);
      pmtiles = new PMTiles(source);
    } else { // Assume it's a local file path
      // Server.js should ensure this path exists before calling openPMtiles
      const fd = fs.openSync(pmtilesPathOrUrl, "r");
      const source = new PMTilesFileSource(fd);
      pmtiles = new PMTiles(source);
    }
    return pmtiles;
  } catch (error) {
    console.error(
      `Failed to open PMTiles source ${pmtilesPathOrUrl}: ${error.message}`,
    );
    throw error;
  }
}

export async function getPMtilesTile(
  pmtiles,
  z,
  x,
  y,
) {
  try {
    const header = await pmtiles.getHeader();
    const mimeType = getPmtilesMimeTypeFromTypeNum(header.tileType);

    const zxyTile = await pmtiles.getZxy(z, x, y);

    if (zxyTile && zxyTile.data) {
      return { data: zxyTile.data, mimeType };
    } else {
      return { data: undefined, mimeType: mimeType };
    }
  } catch (error) {
    console.error(
      `Error fetching PMTiles tile (z:${z}, x:${x}, y:${y}):`,
      error.message,
    );
    return { data: undefined, mimeType: undefined };
  }
}
