import { Body, Controller, Get, Param, ParseUUIDPipe, Post, StreamableFile, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { IsEnum } from 'class-validator';
import { DocumentType } from '../generated/prisma/client.js';
import { CurrentUser, type AuthUser } from '../common/auth-user.js';
import { DocumentsService, MAX_UPLOAD_BYTES } from './documents.service.js';

class UploadDocumentDto {
  @IsEnum(DocumentType)
  type: DocumentType;
}

@Controller('documents')
export class DocumentsController {
  constructor(private readonly documents: DocumentsService) {}

  /** multipart/form-data with fields "type" and "file" (max 5 MB). */
  @Post()
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 } }))
  upload(@CurrentUser() user: AuthUser, @Body() dto: UploadDocumentDto, @UploadedFile() file?: Express.Multer.File) {
    return this.documents.upload(user.id, dto.type, file?.buffer);
  }

  @Get('mine')
  listMine(@CurrentUser() user: AuthUser) {
    return this.documents.listMine(user.id);
  }

  @Get(':id/file')
  async file(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    const { data, mimeType } = await this.documents.readFile(id, user);
    return new StreamableFile(data, { type: mimeType, disposition: 'inline' });
  }
}
