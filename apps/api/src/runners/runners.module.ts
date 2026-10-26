import { Module } from '@nestjs/common';
import { DocumentsModule } from '../documents/documents.module.js';
import { RunnersController } from './runners.controller.js';
import { RunnersService } from './runners.service.js';

@Module({
  imports: [DocumentsModule],
  controllers: [RunnersController],
  providers: [RunnersService],
  exports: [RunnersService],
})
export class RunnersModule {}
