import { IsEmail, IsEnum, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { OrganizationRole } from 'prisma/generated/client';

export class AddMemberDto {
  @ApiProperty({ description: 'Email of the user to add' })
  @IsEmail()
  @IsNotEmpty()
  email: string;

  @ApiProperty({
    description: 'Role to assign to the user',
    enum: OrganizationRole,
  })
  @IsEnum(OrganizationRole)
  @IsNotEmpty()
  role: OrganizationRole;
}
