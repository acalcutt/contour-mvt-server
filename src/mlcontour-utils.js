import sharp from 'sharp';
import mlcontour from '@acalcutt/maplibre-contour';

// Constants for Encoding (moved from server.js)
const TERRARIUM_MULT = 256;
const TERRARIUM_OFFSET = 32768;
const MAPBOX_INTERVAL_DEFAULT = 0.1;
const MAPBOX_OFFSET_DEFAULT = -10000;

/**
 * Image decoder using sharp for mlcontour.
 * @param {Blob} blob - The image blob to decode.
 * @param {import('maplibre-contour').Encoding} encoding - The DEM encoding ('mapbox' or 'terrarium').
 * @param {AbortController} [abortController] - An AbortController to signal early termination.
 * @returns {Promise<import('maplibre-contour').DemTile>} The decoded DEM tile data.
 */
export async function GetImageData(blob, encoding, abortController) {
  if (abortController?.signal?.aborted) {
    throw new Error('Image processing was aborted.');
  }
  try {
    const buffer = await blob.arrayBuffer();
    const image = sharp(Buffer.from(buffer));

    if (abortController?.signal?.aborted) {
      throw new Error('Image processing was aborted.');
    }

    const { data, info } = await image
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    if (abortController?.signal?.aborted) {
      throw new Error('Image processing was aborted.');
    }
    
    const parsed = mlcontour.decodeParsedImage(
      info.width,
      info.height,
      encoding,
      data
    );
    
    if (abortController?.signal?.aborted) {
      throw new Error('Image processing was aborted.');
    }

    return parsed;
  } catch (error) {
    console.error('Error processing image:', error);
    if (error instanceof Error) {
      throw error;
    }
    throw new Error('An unknown error has occurred.');
  }
}

/**
 * Generates a blank DEM tile image buffer using sharp.
 * @param {number} width - Tile width.
 * @param {number} height - Tile height.
 * @param {number} elevationValue - The elevation value to encode for the blank tile.
 * @param {import('maplibre-contour').Encoding} encoding - The DEM encoding ('mapbox' or 'terrarium').
 * @param {'png' | 'webp' | 'jpeg'} outputFormat - The desired output image format.
 * @returns {Promise<Buffer>} The image buffer.
 */
export async function createBlankTileImage(
  width,
  height,
  elevationValue,
  encoding,
  outputFormat,
) {
  const rgbData = new Uint8Array(width * height * 3);

  let r = 0, g = 0, b = 0;

  if (encoding === "terrarium") {
    const scaledValue = Math.round(
      (elevationValue + TERRARIUM_OFFSET) * TERRARIUM_MULT,
    );
    const clampedValue = Math.max(0, Math.min(0xffffff, scaledValue));
    r = (clampedValue >> 16) & 0xff;
    g = (clampedValue >> 8) & 0xff;
    b = clampedValue & 0xff;
  } else { // 'mapbox' encoding
    const rgbIntValue = Math.round(
      (elevationValue + MAPBOX_OFFSET_DEFAULT) * (1 / MAPBOX_INTERVAL_DEFAULT),
    );
    const clampedRgbIntValue = Math.max(0, Math.min(0xffffff, rgbIntValue));
    r = (clampedRgbIntValue >> 16) & 0xff;
    g = (clampedRgbIntValue >> 8) & 0xff;
    b = clampedRgbIntValue & 0xff;
  }

  for (let i = 0; i < width * height; i++) {
    rgbData[i * 3] = r;
    rgbData[i * 3 + 1] = g;
    rgbData[i * 3 + 2] = b;
  }

  const image = sharp(Buffer.from(rgbData), {
    raw: {
      width: width,
      height: height,
      channels: 3,
    },
  });

  if (outputFormat === "webp") {
    return image.toFormat("webp", { lossless: true }).toBuffer();
  } else {
    const quality = outputFormat === "jpeg" ? 80 : undefined;
    return image.toFormat(outputFormat, { quality }).toBuffer();
  }
}

/**
 * Helper to parse ZXY from a simple path (e.g., '/z/x/y').
 * @param {string} url - The URL string.
 * @returns {{z: number, x: number, y: number} | null} The parsed ZXY coordinates or null if invalid.
 */
export function parseZXYFromUrl(url) {
  const parts = url.split('/');
  if (parts.length >= 3) {
    const z = parseInt(parts[parts.length - 3], 10);
    const x = parseInt(parts[parts.length - 2], 10);
    const yWithExt = parts[parts.length - 1];
    const y = parseInt(yWithExt.split('.')[0], 10); // Remove .pbf or .png
    if (!isNaN(z) && !isNaN(x) && !isNaN(y)) {
      return { z, x, y };
    }
  }
  return null;
}

/**
 * Gets contour options for a specific zoom level, handling thresholds.
 * @param {import('maplibre-contour').GlobalContourTileOptions} options - The base contour options.
 * @param {number} zoom - The current zoom level.
 * @returns {import('maplibre-contour').GlobalContourTileOptions} The adjusted contour options for the zoom level.
 */
export function getOptionsForZoom(options, zoom) {
  const { thresholds, ...rest } = options;

  if (!thresholds) {
    return options;
  }

  let levels = [];
  let maxLessThanOrEqualTo = -Infinity;

  Object.entries(thresholds).forEach(([zString, value]) => {
    const z = Number(zString);
    if (z <= zoom && z > maxLessThanOrEqualTo) {
      maxLessThanOrEqualTo = z;
      levels = typeof value === 'number' ? [value] : value;
    }
  });

  return {
    levels,
    ...rest,
  };
}
