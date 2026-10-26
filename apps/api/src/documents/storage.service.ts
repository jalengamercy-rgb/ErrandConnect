import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { randomToken } from '../common/crypto.js';

/**
 * Private file storage for uploaded documents. Saves to a local folder for
 * now; in production this will be swapped for S3-compatible storage with the
 * same save/read methods.
 */
@Injectable()
export class StorageService {
  private readonly root: string;

  constructor(config: ConfigService) {
    this.root = resolve(config.get<string>('STORAGE_DIR') ?? './uploads');
  }

  /** Stores the bytes under a random, unguessable key and returns the key. */
  async save(folder: string, data: Buffer, extension: string): Promise<string> {
    const key = `${folder}/${new Date().toISOString().slice(0, 7)}/${randomToken(18)}.${extension}`;
    const path = this.pathFor(key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, data);
    return key;
  }

  read(key: string): Promise<Buffer> {
    return readFile(this.pathFor(key));
  }

  /** Deletes a file; missing files are ignored. */
  remove(key: string): Promise<void> {
    return rm(this.pathFor(key), { force: true });
  }

  private pathFor(key: string): string {
    const path = resolve(join(this.root, key));
    if (!path.startsWith(this.root + '/')) throw new Error('Invalid storage key');
    return path;
  }
}
