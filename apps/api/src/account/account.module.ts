import { Module } from '@nestjs/common';
import { DocumentsModule } from '../documents/documents.module.js';
import { AccountController } from './account.controller.js';
import { AccountService } from './account.service.js';

@Module({
  imports: [DocumentsModule],
  controllers: [AccountController],
  providers: [AccountService],
})
export class AccountModule {}
