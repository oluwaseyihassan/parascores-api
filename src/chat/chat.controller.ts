import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { Public } from 'src/auth/decorators/public.decorator';
import { jwtConstants } from 'src/auth/constants';
import { ResponseUtil } from 'src/utils/api-response';
import { ChatService } from './chat.service';
import {
  CreateChatMessageDto,
  PinChatMessageDto,
  ReactChatMessageDto,
  UpdateChatSettingsDto,
} from './dto/chat.dto';

@ApiTags('chat')
@Controller()
export class ChatController {
  constructor(
    private readonly chat: ChatService,
    private readonly jwt: JwtService,
  ) {}

  // Optional auth for @Public routes (global guard skips token verification):
  // verifies a bearer/cookie token when present so PRIVATE rooms can be read
  // by participants/organizers while public rooms stay open to everyone.
  private async optionalUserId(req: Request): Promise<string | null> {
    const header = req.headers.authorization;
    const token = header?.startsWith('Bearer ')
      ? header.slice(7)
      : req.cookies?.access_token;
    if (!token) return null;
    try {
      const payload = await this.jwt.verifyAsync(token, {
        secret: jwtConstants.secret,
      });
      return payload.sub ?? null;
    } catch {
      return null;
    }
  }

  @Public()
  @Get('tournaments/:id/chat-messages')
  @ApiOperation({ summary: 'List chat messages (cursor-paginated) + pinned message' })
  @ApiQuery({ name: 'cursor', required: false, type: String })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  async list(
    @Param('id') id: string,
    @Req() req: Request,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    const userId = await this.optionalUserId(req);
    const data = await this.chat.list(id, userId, {
      cursor,
      limit: limit ? parseInt(limit, 10) : 50,
    });
    return ResponseUtil.success(data, 'Chat messages retrieved');
  }

  @Post('tournaments/:id/chat-messages')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Post a chat message (confirmed participants + org members)' })
  async post(
    @Param('id') id: string,
    @Req() req: any,
    @Body() dto: CreateChatMessageDto,
  ) {
    const message = await this.chat.post(id, req.user.sub, dto);
    return ResponseUtil.success(message, 'Message sent');
  }

  @Delete('chat-messages/:messageId')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Soft-delete a message (org moderation)' })
  async remove(@Param('messageId') messageId: string, @Req() req: any) {
    await this.chat.remove(messageId, req.user.sub);
    return ResponseUtil.success(null, 'Message deleted');
  }

  @Post('chat-messages/:messageId/pin')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Pin or unpin a message (org moderation)' })
  async pin(
    @Param('messageId') messageId: string,
    @Req() req: any,
    @Body() dto: PinChatMessageDto,
  ) {
    const pinned = await this.chat.setPin(messageId, req.user.sub, dto.pin);
    return ResponseUtil.success(pinned, dto.pin ? 'Message pinned' : 'Message unpinned');
  }

  @Post('chat-messages/:messageId/react')
  @ApiOperation({ summary: 'Toggle an emoji reaction (participants + org members)' })
  async react(
    @Param('messageId') messageId: string,
    @Req() req: any,
    @Body() dto: ReactChatMessageDto,
  ) {
    const reactions = await this.chat.react(messageId, req.user.sub, dto.emoji);
    return ResponseUtil.success(reactions);
  }

  @Patch('tournaments/:id/chat-settings')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update chat settings (org OWNER/ADMIN)' })
  async updateSettings(
    @Param('id') id: string,
    @Req() req: any,
    @Body() dto: UpdateChatSettingsDto,
  ) {
    const settings = await this.chat.updateSettings(id, req.user.sub, dto);
    return ResponseUtil.success(settings, 'Chat settings updated');
  }
}
