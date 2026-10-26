export interface DetectedFileType {
  mimeType: string;
  extension: string;
}

/**
 * Identifies a file from its first bytes. The type a phone *says* it is
 * uploading can't be trusted, so we check the actual content.
 * Only JPEG, PNG, WebP and PDF are accepted.
 */
export function detectFileType(data: Buffer): DetectedFileType | null {
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) {
    return { mimeType: 'image/jpeg', extension: 'jpg' };
  }
  if (data.length >= 8 && data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return { mimeType: 'image/png', extension: 'png' };
  }
  if (data.length >= 12 && data.toString('ascii', 0, 4) === 'RIFF' && data.toString('ascii', 8, 12) === 'WEBP') {
    return { mimeType: 'image/webp', extension: 'webp' };
  }
  if (data.length >= 5 && data.toString('ascii', 0, 5) === '%PDF-') {
    return { mimeType: 'application/pdf', extension: 'pdf' };
  }
  return null;
}
