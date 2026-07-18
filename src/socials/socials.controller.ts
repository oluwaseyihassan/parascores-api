import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
} from '@nestjs/common';
import { SocialsService } from './socials.service';
import { AddSocialDto, UpdateSocialDto } from 'src/socials/dto/add-social.dto';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from 'src/auth/decorators/public.decorator';

@ApiTags('socials')
@Controller('socials')
export class SocialsController {
  constructor(private readonly socialsService: SocialsService) {}

  @Post('/tournaments/:tournamentId')
  @ApiOperation({ summary: 'Add a social link to a tournament' })
  async addSocial(
    @Param('tournamentId') tournamentId: string,
    @Body() dto: AddSocialDto,
  ) {
    return this.socialsService.addSocial(tournamentId, dto);
  }

  @Public()
  @Get('/tournaments/:tournamentId')
  @ApiOperation({ summary: 'Get social links of a tournament' })
  async getSocials(@Param('tournamentId') tournamentId: string) {
    return this.socialsService.getSocials(tournamentId);
  }

  @Post('/organizations/:organizationId')
  @ApiOperation({ summary: 'Add a social link to an organization' })
  async addOrganizationSocial(
    @Param('organizationId') organizationId: string,
    @Body() dto: AddSocialDto,
  ) {
    return this.socialsService.addOrganizationSocial(organizationId, dto);
  }

  @Public()
  @Get('/organizations/:organizationId')
  @ApiOperation({ summary: 'Get social links of an organization' })
  async getOrganizationSocials(
    @Param('organizationId') organizationId: string,
  ) {
    return this.socialsService.getOrganizationSocials(organizationId);
  }

  @Patch(':socialId')
  @ApiOperation({ summary: 'Update a social link' })
  async updateSocial(
    @Param('socialId') socialId: string,
    @Body() dto: UpdateSocialDto,
  ) {
    return this.socialsService.updateSocial(socialId, dto);
  }

  @Delete(':socialId')
  @ApiOperation({ summary: 'Remove a social link from a tournament' })
  async removeSocial(@Param('socialId') socialId: string) {
    return this.socialsService.removeSocial(socialId);
  }
}
