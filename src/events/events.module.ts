import { Module } from '@nestjs/common';
import { EventsGateway } from './events.gateway';
import { ClientModule } from '../clients/client.module';
import { MatchLogModule } from '../MatchLog/MatchLog.module';

@Module({
  imports: [MatchLogModule, ClientModule],
  providers: [EventsGateway],
})
export class EventsModule {}
