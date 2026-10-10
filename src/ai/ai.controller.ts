import {
  BadRequestException,
  Body,
  Controller,
  Post,
  Req,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Injectable, Logger } from '@nestjs/common';
import { IsInt, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { AiService } from './ai.service';
import { OrganizationsService } from 'src/organizations/organizations.service';
import { RedisService } from 'src/redis/redis.service';
import { ResponseUtil } from 'src/utils/api-response';

export class TournamentDraftDto {
  @IsString()
  organizationId!: string;

  @IsString()
  @MinLength(10)
  @MaxLength(600)
  prompt!: string;

  // Resolved client timezone — relative dates ("next Saturday") anchor to it
  @IsOptional()
  @IsString()
  @MaxLength(64)
  timezone?: string;
}

const TYPES = ['KNOCKOUT', 'LEAGUE', 'ROUND_ROBIN', 'GROUP', 'FRIENDLY', 'HYBRID', 'RACE'];
const VISIBILITY = ['PUBLIC', 'UNLISTED', 'PRIVATE'];
const PARTICIPANT_TYPE = ['TEAM', 'INDIVIDUAL'];

/** Draft fields the wizard can prefill — anything else is dropped. */
interface TournamentDraft {
  name?: string;
  description?: string;
  sport?: string;
  type?: string;
  participantType?: string;
  visibility?: string;
  location?: string;
  startDate?: string; // yyyy-mm-dd
  endDate?: string;
  maxParticipants?: number;
  twoLegsKnockout?: boolean;
  doubleRoundRobin?: boolean;
  thirdPlaceMatch?: boolean;
  isPaidRegistration?: boolean;
  registrationFee?: number | null; // NGN
  chatRules?: string;
}

@Controller('ai')
export class AiController {
  private readonly logger = new Logger(AiController.name);

  constructor(
    private readonly ai: AiService,
    private readonly orgs: OrganizationsService,
    private readonly redis: RedisService,
  ) {}

  /**
   * Plain-language → structured tournament draft. The draft is advisory JSON
   * for the create wizard; nothing is persisted here and every field is
   * validated before it reaches the client.
   */
  @Post('tournament-draft')
  async tournamentDraft(@Body() dto: TournamentDraftDto, @Req() req: any) {
    if (!this.ai.configured) {
      throw new ServiceUnavailableException('AI drafting is not configured on this server');
    }
    const userId = req.user.sub;
    // Same rights as tournament creation
    await this.orgs.validateMemberRole(dto.organizationId, userId, ['OWNER', 'ADMIN']);

    // 10 drafts per org per hour (Redis offline → permissive)
    const rlKey = `ai:draft:${dto.organizationId}`;
    const used = (await this.redis.get<number>(rlKey)) ?? 0;
    if (used >= 10) {
      throw new BadRequestException('Draft limit reached for this organization (10/hour) — try again later');
    }

    const tz = dto.timezone ?? 'UTC';
    const today = new Date().toLocaleDateString('en-CA', { timeZone: tz }); // yyyy-mm-dd
    const raw = await this.ai.complete({
      system: [
        'You convert plain-language tournament descriptions into strict JSON for the ParaScores create wizard.',
        'Return ONLY a JSON object — no prose, no markdown fences.',
        'Schema (omit any key you are not confident about):',
        '{ "name": string, "description": string, "sport": string (e.g. "Football", "FIFA / eFootball", "Basketball"),',
        '  "type": "KNOCKOUT"|"LEAGUE"|"ROUND_ROBIN"|"GROUP"|"FRIENDLY"|"HYBRID"|"RACE",',
        '  "participantType": "TEAM"|"INDIVIDUAL", "visibility": "PUBLIC"|"UNLISTED"|"PRIVATE",',
        '  "location": string, "startDate": "yyyy-mm-dd", "endDate": "yyyy-mm-dd",',
        '  "maxParticipants": integer 2-128, "twoLegsKnockout": boolean, "doubleRoundRobin": boolean,',
        '  "thirdPlaceMatch": boolean, "isPaidRegistration": boolean, "registrationFee": number (NGN) | null,',
        '  "chatRules": string (short house-rules draft for the tournament chat) }',
        `Today is ${today} in timezone ${tz}. Resolve relative dates ("next Saturday", "weekends in November") to absolute yyyy-mm-dd. End date must be after start date.`,
        'Never invent fees — only set isPaidRegistration/registrationFee when the prompt states an entry cost.',
        'Keep the name short and competition-like (no trailing "tournament"). Title-case the sport.',
      ].join('\n'),
      user: dto.prompt,
      maxTokens: 900,
      timeoutMs: 45_000, // one-shot structured draft — thinking models need the headroom
    });
    if (!raw) {
      throw new ServiceUnavailableException('The AI could not draft that right now — try again in a moment');
    }
    await this.redis.set(rlKey, used + 1, 3600);

    const parsed = extractJson(raw);
    if (!parsed) {
      this.logger.warn(`Tournament draft returned non-JSON: ${raw.slice(0, 200)}`);
      throw new ServiceUnavailableException('The AI returned an unreadable draft — try rephrasing');
    }
    const draft = sanitizeDraft(parsed, today);
    return ResponseUtil.success({
      draft,
      fields: Object.keys(draft),
    });
  }
}

/** Pull the first balanced {...} block out of an LLM response. */
function extractJson(text: string): Record<string, any> | null {
  const start = text.indexOf('{');
  if (start === -1) return null;
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}') {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(text.slice(start, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

/** Strict per-field validation — the LLM is advisory, never trusted. */
function sanitizeDraft(raw: Record<string, any>, today: string): TournamentDraft {
  const out: TournamentDraft = {};
  const str = (v: any, max: number) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined);
  const bool = (v: any) => (typeof v === 'boolean' ? v : undefined);

  const name = str(raw.name, 80);
  if (name && name.length >= 3) out.name = name;
  const description = str(raw.description, 500);
  if (description) out.description = description;
  const sport = str(raw.sport, 40);
  if (sport) out.sport = sport;
  if (TYPES.includes(raw.type)) out.type = raw.type;
  if (PARTICIPANT_TYPE.includes(raw.participantType)) out.participantType = raw.participantType;
  if (VISIBILITY.includes(raw.visibility)) out.visibility = raw.visibility;
  const location = str(raw.location, 120);
  if (location) out.location = location;

  const dateRe = /^\d{4}-\d{2}-\d{2}$/;
  const startDate = typeof raw.startDate === 'string' && dateRe.test(raw.startDate) ? raw.startDate : undefined;
  const endDate = typeof raw.endDate === 'string' && dateRe.test(raw.endDate) ? raw.endDate : undefined;
  if (startDate && startDate >= today) out.startDate = startDate;
  if (endDate && (!out.startDate || endDate > out.startDate)) out.endDate = endDate;

  if (Number.isInteger(raw.maxParticipants) && raw.maxParticipants >= 2 && raw.maxParticipants <= 128) {
    out.maxParticipants = raw.maxParticipants;
  }
  for (const key of ['twoLegsKnockout', 'doubleRoundRobin', 'thirdPlaceMatch'] as const) {
    const v = bool(raw[key]);
    if (v !== undefined) out[key] = v;
  }
  const paid = bool(raw.isPaidRegistration);
  if (paid !== undefined) out.isPaidRegistration = paid;
  if (typeof raw.registrationFee === 'number' && raw.registrationFee >= 0 && raw.registrationFee <= 10_000_000) {
    out.registrationFee = Math.round(raw.registrationFee);
  }
  const chatRules = str(raw.chatRules, 2000);
  if (chatRules) out.chatRules = chatRules;
  return out;
}
