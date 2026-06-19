import { Injectable, OnApplicationShutdown } from '@nestjs/common';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import Database = require('better-sqlite3');
import { v4 as uuidv4 } from 'uuid';
import { omit } from 'lodash';
import { Lobby, Player } from '../types/models.types';
import {
  Match,
  MatchRow,
  NewMatchRow,
  NewScoreRow,
  PlayerScore,
  ScoreRow,
  UpdateMatchBody,
} from './MatchLog.types';

@Injectable()
export class MatchLogService implements OnApplicationShutdown {
  private readonly db: Database.Database;

  constructor() {
    let dbPath =
      process.env.SQLITE3_DB_PATH ||
      path.join(__dirname, '../../data/matches.db');
    if (dbPath.startsWith('~')) {
      dbPath = path.join(os.homedir(), dbPath.slice(1));
    }
    const dataDir = path.dirname(dbPath);
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }

    this.db = new Database(dbPath);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS matches (
        id TEXT PRIMARY KEY,
        dateAdded INTEGER NOT NULL,
        lobbyCode TEXT NOT NULL,
        label TEXT,
        songTitle TEXT,
        songArtist TEXT,
        songPath TEXT,
        totalSteps INTEGER,
        totalHolds INTEGER,
        totalRolls INTEGER,
        totalMines INTEGER
      )
    `);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS scores (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        matchId TEXT NOT NULL,
        playerId TEXT NOT NULL,
        profileName TEXT NOT NULL,
        score INTEGER,
        exScore INTEGER,
        fantasticPlus INTEGER,
        fantastics INTEGER,
        excellents INTEGER,
        greats INTEGER,
        decents INTEGER,
        wayOffs INTEGER,
        misses INTEGER,
        minesHit INTEGER,
        holdsHeld INTEGER,
        rollsHeld INTEGER,
        isValid INTEGER NOT NULL
      )
    `);
  }

  /**
   * Records each player's score for a completed match, once all players in
   * the lobby have reached the evaluation/results screen. Song info and
   * chart totals are recorded once per match; each player gets their own
   * row in the `scores` table.
   */
  logMatch(lobby: Lobby): Match {
    const players = Object.values(lobby.machines).flatMap((machine) =>
      [machine.player1, machine.player2].filter(
        (player): player is Player => player !== undefined,
      ),
    );

    if (!lobby.songInfo?.title) {
      throw new Error('Cannot log a match without a song title.');
    }
    if (players.length === 0) {
      throw new Error('Cannot log a match with no players.');
    }

    const matchId = uuidv4();
    const dateAdded = Date.now();
    const chartTotals = players.find((player) => player.judgments)?.judgments;

    const matchRow: NewMatchRow = {
      id: matchId,
      dateAdded,
      lobbyCode: lobby.code,
      label: null,
      songTitle: lobby.songInfo?.title ?? null,
      songArtist: lobby.songInfo?.artist ?? null,
      songPath: lobby.songInfo?.songPath ?? null,
      totalSteps: chartTotals?.totalSteps ?? null,
      totalHolds: chartTotals?.totalHolds ?? null,
      totalRolls: chartTotals?.totalRolls ?? null,
      totalMines: chartTotals?.totalMines ?? null,
    };

    this.db
      .prepare(
        `INSERT INTO matches
          (id, dateAdded, lobbyCode, label, songTitle, songArtist, songPath,
           totalSteps, totalHolds, totalRolls, totalMines)
         VALUES
          (@id, @dateAdded, @lobbyCode, @label, @songTitle, @songArtist, @songPath,
           @totalSteps, @totalHolds, @totalRolls, @totalMines)`,
      )
      .run(matchRow);

    const insertScore = this.db.prepare(
      `INSERT INTO scores
        (matchId, playerId, profileName, score, exScore, fantasticPlus,
         fantastics, excellents, greats, decents, wayOffs, misses, minesHit,
         holdsHeld, rollsHeld, isValid)
       VALUES
        (@matchId, @playerId, @profileName, @score, @exScore, @fantasticPlus,
         @fantastics, @excellents, @greats, @decents, @wayOffs, @misses, @minesHit,
         @holdsHeld, @rollsHeld, @isValid)`,
    );

    const insertManyScores = this.db.transaction(() => {
      const scores: PlayerScore[] = [];
      for (const player of players) {
        const judgments = player.judgments;
        const judgmentSum =
          (judgments?.fantasticPlus ?? 0) +
          (judgments?.fantastics ?? 0) +
          (judgments?.excellents ?? 0) +
          (judgments?.greats ?? 0) +
          (judgments?.decents ?? 0) +
          (judgments?.wayOffs ?? 0) +
          (judgments?.misses ?? 0);

        const row: NewScoreRow = {
          matchId,
          playerId: player.playerId,
          profileName: player.profileName,
          score: player.score ?? null,
          exScore: player.exScore ?? null,
          fantasticPlus: judgments?.fantasticPlus ?? null,
          fantastics: judgments?.fantastics ?? null,
          excellents: judgments?.excellents ?? null,
          greats: judgments?.greats ?? null,
          decents: judgments?.decents ?? null,
          wayOffs: judgments?.wayOffs ?? null,
          misses: judgments?.misses ?? null,
          minesHit: judgments?.minesHit ?? null,
          holdsHeld: judgments?.holdsHeld ?? null,
          rollsHeld: judgments?.rollsHeld ?? null,
          isValid: judgmentSum === matchRow.totalSteps ? 1 : 0,
        };
        const { lastInsertRowid } = insertScore.run(row);
        scores.push({ ...omit(row, ['matchId']), id: Number(lastInsertRowid) });
      }
      return scores;
    });
    const scores = insertManyScores();

    return {
      ...matchRow,
      scores,
    };
  }

  updateMatch(id: string, updates: UpdateMatchBody): Match | undefined {
    const setClauses = (Object.keys(updates) as (keyof UpdateMatchBody)[])
      .map((key) => `${key} = @${key}`)
      .join(', ');
    if (!setClauses) return this.getMatch(id);
    this.db
      .prepare(`UPDATE matches SET ${setClauses} WHERE id = @id`)
      .run({ ...updates, id });
    return this.getMatch(id);
  }

  private getMatch(id: string): Match | undefined {
    const matchRow = this.db
      .prepare<{ id: string }, MatchRow>('SELECT * FROM matches WHERE id = @id')
      .get({ id });
    if (!matchRow) return undefined;
    const scoreRows = this.db
      .prepare<{ matchId: string }, ScoreRow>(
        'SELECT * FROM scores WHERE matchId = @matchId',
      )
      .all({ matchId: id });
    return {
      ...matchRow,
      scores: scoreRows.map((row) => omit(row, ['matchId'])),
    };
  }

  /**
   * Returns all logged matches, sorted reverse chronologically (most recent
   * first).
   */
  getMatches(): Match[] {
    const matchRows = this.db
      .prepare<[], MatchRow>('SELECT * FROM matches ORDER BY dateAdded DESC')
      .all();

    const scoreRows = this.db
      .prepare<[], ScoreRow>('SELECT * FROM scores')
      .all();

    const scoresByMatchId = new Map<string, PlayerScore[]>();
    for (const row of scoreRows) {
      const scores = scoresByMatchId.get(row.matchId) ?? [];
      scores.push(omit(row, ['matchId']));
      scoresByMatchId.set(row.matchId, scores);
    }

    return matchRows.map((match) => ({
      ...match,
      scores: scoresByMatchId.get(match.id) ?? [],
    }));
  }

  onApplicationShutdown(): void {
    this.db.close();
  }
}
