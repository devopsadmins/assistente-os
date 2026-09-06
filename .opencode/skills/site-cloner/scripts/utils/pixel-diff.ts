import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';
import sharp from 'sharp';

export interface ComparisonOptions {
  threshold?: number;
  includeAA?: boolean;
  alpha?: number;
}

export interface ComparisonResult {
  similarity: number;
  pixelDiffRatio: number;
  ssimScore: number;
  diffBuffer: Buffer;
  width: number;
  height: number;
  diffImagePath?: string;
}

// SSIM Implementation (Structural Similarity Index)
// Based on the standard SSIM algorithm
function calculateSSIM(img1: Uint8Array, img2: Uint8Array, width: number, height: number): number {
  const K1 = 0.01;
  const K2 = 0.03;
  const L = 255; // Dynamic range for 8-bit images

  const C1 = (K1 * L) ** 2;
  const C2 = (K2 * L) ** 2;

  // Convert to grayscale luminance
  const toLuminance = (data: Uint8Array): Float32Array => {
    const lum = new Float32Array(width * height);
    for (let i = 0, j = 0; i < data.length; i += 4, j++) {
      // Standard luminance formula: 0.299*R + 0.587*G + 0.114*B
      lum[j] = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    }
    return lum;
  };

  const lum1 = toLuminance(img1);
  const lum2 = toLuminance(img2);

  // Calculate means
  const mean1 = lum1.reduce((a, b) => a + b, 0) / (width * height);
  const mean2 = lum2.reduce((a, b) => a + b, 0) / (width * height);

  // Calculate variances and covariance
  let var1 = 0;
  let var2 = 0;
  let covar = 0;

  for (let i = 0; i < width * height; i++) {
    const d1 = lum1[i] - mean1;
    const d2 = lum2[i] - mean2;
    var1 += d1 * d1;
    var2 += d2 * d2;
    covar += d1 * d2;
  }

  var1 /= width * height;
  var2 /= width * height;
  covar /= width * height;

  // SSIM formula
  const numerator = (2 * mean1 * mean2 + C1) * (2 * covar + C2);
  const denominator = (mean1 * mean1 + mean2 * mean2 + C1) * (var1 + var2 + C2);

  return numerator / denominator;
}

export async function compareImages(
  img1Buffer: Buffer,
  img2Buffer: Buffer,
  options: ComparisonOptions = {}
): Promise<ComparisonResult> {
  const { threshold = 0.1, includeAA = true, alpha = 0.1 } = options;

  // Probe dimensions (metadata is cheap and avoids decoding twice)
  const [meta1, meta2] = await Promise.all([
    sharp(img1Buffer).metadata(),
    sharp(img2Buffer).metadata(),
  ]);

  const width = Math.max(meta1.width ?? 0, meta2.width ?? 0);
  const height = Math.max(meta1.height ?? 0, meta2.height ?? 0);

  if (width === 0 || height === 0) {
    throw new Error('compareImages: could not determine image dimensions');
  }

  // Resize both to the same size and force RGBA (4 channels) so the buffers
  // line up with `diffData` and pixelmatch's expectations.
  const [resized1, resized2] = await Promise.all([
    sharp(img1Buffer).resize(width, height, { fit: 'fill' }).ensureAlpha().raw().toBuffer({ resolveWithObject: true }),
    sharp(img2Buffer).resize(width, height, { fit: 'fill' }).ensureAlpha().raw().toBuffer({ resolveWithObject: true }),
  ]);

  const data1 = new Uint8Array(resized1.data);
  const data2 = new Uint8Array(resized2.data);
  const diffData = new Uint8Array(width * height * 4);

  // Pixelmatch comparison
  const pixelDiff = pixelmatch(data1, data2, diffData, width, height, {
    threshold,
    includeAA,
    alpha,
    diffColor: [255, 0, 0],
    diffColorAlt: [255, 165, 0],
  });

  const pixelDiffRatio = pixelDiff / (width * height);

  // SSIM comparison (perceptual) - pure JS implementation
  const ssimScore = calculateSSIM(data1, data2, width, height);

  // Combined similarity (50% pixelmatch, 50% SSIM)
  const similarity = (1 - pixelDiffRatio) * 0.5 + ssimScore * 0.5;

  // Create diff PNG
  const diffPng = new PNG({ width, height });
  diffPng.data = Buffer.from(diffData);
  const diffBuffer = PNG.sync.write(diffPng);

  return {
    similarity: Math.max(0, Math.min(1, similarity)),
    pixelDiffRatio,
    ssimScore,
    diffBuffer,
    width,
    height,
  };
}

export async function compareImagesWithRegions(
  img1Buffer: Buffer,
  img2Buffer: Buffer,
  regions: Array<{ left: number; top: number; width: number; height: number }>,
  options: ComparisonOptions = {}
): Promise<ComparisonResult[]> {
  const results: ComparisonResult[] = [];

  for (const region of regions) {
    // Re-encode the crops to PNG so compareImages() can decode them again.
    const [crop1, crop2] = await Promise.all([
      sharp(img1Buffer).extract(region).png().toBuffer(),
      sharp(img2Buffer).extract(region).png().toBuffer(),
    ]);

    const result = await compareImages(crop1, crop2, options);
    results.push(result);
  }

  return results;
}