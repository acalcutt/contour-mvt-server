// src/mbtiles-utils.js
import MBTiles from "@mapbox/mbtiles";
import { existsSync } from "node:fs";
import path from "node:path";

export const mbtilesTester = /^mbtiles:\/\//i;

export async function openMBTiles(mbtilesUri) {
  // Extract the actual file path from the mbtiles:// URI
  let filePath = mbtilesUri.replace(mbtilesTester, "");
  
  // Normalize the path to handle Windows paths properly
  // Replace double slashes with single slashes, but preserve the drive letter format
  filePath = filePath.replace(/\/\//g, '/');
  
  // Convert to native path format (will use backslashes on Windows)
  filePath = path.normalize(filePath);

  // Check if file exists
  if (!existsSync(filePath)) {
    throw new Error(`MBTiles file not found at: ${filePath}`);
  }

  return new Promise((resolve, reject) => {
    // Pass the normalized file path directly (not the mbtiles:// URI)
    // @mapbox/mbtiles doesn't actually need the mbtiles:// prefix for local files
    new MBTiles(filePath, (err, mbtilesHandle) => {
      if (err) {
        console.error(
          `Failed to open MBTiles file ${filePath}: ${err.message}`,
        );
        reject(err);
        return;
      }

      mbtilesHandle.getInfo((infoErr, info) => {
        if (infoErr) {
          console.warn(
            `Could not retrieve MBTiles info for ${filePath}: ${infoErr.message}`,
          );
          resolve({ handle: mbtilesHandle, metadata: undefined });
          return;
        }

        let metadata = undefined;
        if (info && info.format) {
          metadata = { format: info.format };
        } else {
          console.warn(
            "Could not retrieve MBTiles format from metadata, falling back to png for blank tiles.",
          );
        }

        resolve({ handle: mbtilesHandle, metadata });
      });
    });
  });
}

export async function getMBTilesTile(
  mbtilesHandle,
  z,
  x,
  y,
) {
  return new Promise((resolve, reject) => {
    mbtilesHandle.getTile(z, x, y, (err, tileData, headers) => {
      if (err) {
        if (
          err.message &&
          (err.message.includes("Tile does not exist") ||
            err.message.includes("no such row"))
        ) {
          resolve({ data: undefined, contentType: undefined });
          return;
        }
        console.error("Error fetching MBTiles tile:", err);
        reject(err);
        return;
      }

      if (!tileData) {
        resolve({ data: undefined, contentType: undefined });
        return;
      }

      const contentType = headers?.["Content-Type"] || headers?.contentType;
      resolve({ data: tileData, contentType });
    });
  });
}
