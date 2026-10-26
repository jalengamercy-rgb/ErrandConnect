import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DocumentType } from '../generated/prisma/client.js';
import type { AuthUser } from '../common/auth-user.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { detectFileType } from './file-type.js';
import { StorageService } from './storage.service.js';

export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

/** Fields returned to apps. storageKey stays internal. */
const PUBLIC_FIELDS = {
  id: true,
  type: true,
  mimeType: true,
  status: true,
  rejectionReason: true,
  reviewedAt: true,
  expiresAt: true,
  createdAt: true,
} as const;

@Injectable()
export class DocumentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  async upload(ownerId: string, type: DocumentType, data: Buffer | undefined) {
    if (!data?.length) throw new BadRequestException('Attach a file in the "file" field');
    const fileType = detectFileType(data);
    if (!fileType) throw new BadRequestException('Only JPEG, PNG, WebP images or PDF files are accepted');

    const storageKey = await this.storage.save(`documents/${ownerId}`, data, fileType.extension);
    const document = await this.prisma.document.create({
      data: { ownerId, type, storageKey, mimeType: fileType.mimeType },
      select: PUBLIC_FIELDS,
    });

    // A selfie also becomes the profile photo.
    if (type === 'SELFIE') {
      await this.prisma.user.update({ where: { id: ownerId }, data: { photoUrl: `/documents/${document.id}/file` } });
    }
    return document;
  }

  listMine(ownerId: string) {
    return this.prisma.document.findMany({ where: { ownerId }, select: PUBLIC_FIELDS, orderBy: { createdAt: 'desc' } });
  }

  /** The owner or any staff member may download a document. */
  async readFile(id: string, viewer: AuthUser) {
    const document = await this.prisma.document.findUnique({ where: { id } });
    if (!document || (document.ownerId !== viewer.id && !viewer.staffRole)) {
      throw new NotFoundException('Document not found');
    }
    return { data: await this.storage.read(document.storageKey), mimeType: document.mimeType };
  }

  /** Most recent upload of each type for a user, e.g. to check onboarding. */
  async latestByType(ownerId: string) {
    const documents = await this.prisma.document.findMany({ where: { ownerId }, orderBy: { createdAt: 'desc' } });
    const latest = new Map<DocumentType, (typeof documents)[number]>();
    for (const document of documents) if (!latest.has(document.type)) latest.set(document.type, document);
    return latest;
  }
}
