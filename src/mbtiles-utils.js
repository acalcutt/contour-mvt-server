// src/mbtiles-utils.js
import MBTiles from "@mapbox/mbtiles";
import { existsSync } from "node:fs";
import path from "node:path"; // Added path for local file resolution

export const mbtilesTester = /^mbtiles:\/\//i;

export async function openMBTiles(FilePath, tileFileBaseDirectory = './data') { // Added base directory for local files
  const fullPath = path.isAbsolute(FilePath) ? FilePath : path.join(tileFileBaseDirectory, FilePath);

  if (!existsSync(fullPath)) {
    throw new Error(`MBTiles file not found at: ${fullPath}`);
  }

  return new Promise((resolve, reject) => {
    new MBTiles(fullPath, (err, mbtilesHandle) => {
      if (err) {
        console.error(
          `Failed to open MBTiles file ${fullPath}: ${err.message}`,
        );
        reject(err);
        return;
      }

      mbtilesHandle.getInfo((infoErr, info) => {
        if (infoErr) {
          console.warn(
            `Could not retrieve MBTiles info for ${fullPath}: ${infoErr.message}`,
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
