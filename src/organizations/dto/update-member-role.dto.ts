import { IsEnum, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { OrganizationRole } from 'prisma/generated/client';

export class UpdateMemberRoleDto {
  @ApiProperty({
    description: 'New role for the member',
    enum: OrganizationRole,
  })
  @IsEnum(OrganizationRole)
  @IsNotEmpty()
  role: OrganizationRole;
}
