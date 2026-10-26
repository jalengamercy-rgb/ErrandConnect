import { Global, Module } from '@nestjs/common';
import { DispatchService } from './dispatch.service.js';
import { RealtimeService } from './realtime.service.js';

@Global()
@Module({ providers: [RealtimeService, DispatchService], exports: [RealtimeService, DispatchService] })
export class RealtimeServiceModule {}
