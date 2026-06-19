import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
} from '@nestjs/common';
import { AppService } from './app.service';
import { ClientService } from './clients/client.service';
import { MatchLogService } from './MatchLog/MatchLog.service';
import { Match, UpdateMatchBody } from './MatchLog/MatchLog.types';
import { Lobby, LOBBYMAN } from './types/models.types';

@Controller()
export class AppController {
  constructor(
    private readonly appService: AppService,
    private readonly matchLogService: MatchLogService,
    private readonly clients: ClientService,
  ) {}

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  @Get('match/list')
  getMatchList(): Match[] {
    return this.matchLogService.getMatches();
  }

  @Post('match/:id')
  updateMatch(@Param('id') id: string, @Body() body: UpdateMatchBody): Match {
    const match = this.matchLogService.updateMatch(id, body);
    if (!match) throw new NotFoundException(`Match ${id} not found`);
    this.clients.sendAll({ event: 'matchUpdated', data: match });
    return match;
  }

  @Get('lobby/list')
  getLobbyList(): Lobby[] {
    return Object.values(LOBBYMAN.lobbies);
  }
}
