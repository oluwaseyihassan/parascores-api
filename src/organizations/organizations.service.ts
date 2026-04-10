import { Injectable, ConflictException, NotFoundException, ForbiddenException } from '@nestjs/common';
import { OrganizationRole } from 'prisma/generated/client';
import { DatabaseService } from 'src/database/database.service';
import { CreateOrganizationDto } from './dto/create-organization.dto';
import { ResponseUtil } from 'src/utils/api-response';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { EmailEvents, OrganizationMemberAddedPayload, OrganizationMemberRoleUpdatedPayload, OrganizationMemberRemovedPayload } from 'src/email/email.events';

@Injectable()
export class OrganizationsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly eventEmitter: EventEmitter2
  ) {}

  async create(userId: string, dto: CreateOrganizationDto) {
    let slug = this.generateSlug(dto.name);
    let isUnique = false;

    while (!isUnique) {
      const existingOrg = await this.db.organization.findUnique({
        where: { slug },
      });

      if (existingOrg) {
        // Append a short random string to make it unique
        const suffix = Math.random().toString(36).substring(2, 6);
        slug = `${this.generateSlug(dto.name)}-${suffix}`;
      } else {
        isUnique = true;
      }
    }

    // Create organization, member (OWNER), and update user role in a transaction
    const organization = await this.db.$transaction(async (tx) => {
      const org = await tx.organization.create({
        data: {
          ...dto,
          slug,
        },
      });

      await tx.organizationMember.create({
        data: {
          organizationId: org.id,
          userId,
          role: 'OWNER',
        },
      });

      await tx.user.update({
        where: { id: userId },
        data: { role: 'ORGANIZER' },
      });

      return org;
    });

    return ResponseUtil.success(organization, 'Organization created successfully');
  }

  async findOne(id: string) {
    const organization = await this.db.organization.findUnique({
      where: { id },
      include: {
        members: {
          include: {
            user: {
              select: {
                id: true,
                name: true,
                email: true,
                picture: true,
              },
            },
          },
        },
      },
    });

    if (!organization) {
      throw new NotFoundException('Organization not found');
    }

    return ResponseUtil.success(organization, 'Organization retrieved successfully');
  }

  async update(id: string, dto: any) {
    const org = await this.db.organization.findUnique({ where: { id } });
    if (!org) {
      throw new NotFoundException('Organization not found');
    }

    const updated = await this.db.organization.update({
      where: { id },
      data: dto,
    });

    return ResponseUtil.success(updated, 'Organization updated successfully');
  }

  async findAllMembers(organizationId: string) {
    const members = await this.db.organizationMember.findMany({
      where: { organizationId },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            picture: true,
          },
        },
      },
      orderBy: { role: 'asc' },
    });

    return ResponseUtil.success(members, 'Members retrieved successfully');
  }

  async addMember(organizationId: string, email: string, role: OrganizationRole) {
    // Find user by email
    const user = await this.db.user.findUnique({ where: { email } });
    if (!user) {
      throw new NotFoundException(`User with email ${email} not found.`);
    }

    // Check if already a member
    const existingMember = await this.db.organizationMember.findUnique({
      where: {
        organizationId_userId: {
          organizationId,
          userId: user.id,
        },
      },
    });

    if (existingMember) {
      throw new ConflictException('User is already a member of this organization.');
    }

    const member = await this.db.organizationMember.create({
      data: {
        organizationId,
        userId: user.id,
        role,
      },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            picture: true,
          },
        },
      },
    });

    // Ensure user has ORGANIZER role
    if (user.role !== 'ORGANIZER') {
      await this.db.user.update({
        where: { id: user.id },
        data: { role: 'ORGANIZER' },
      });
    }

    // Emit event for email notification
    const organization = await this.db.organization.findUnique({ where: { id: organizationId } });
    if (organization) {
      this.eventEmitter.emit(EmailEvents.ORGANIZATION_MEMBER_ADDED, {
        email: user.email,
        name: user.name,
        organizationName: organization.name,
        role: role,
      } as OrganizationMemberAddedPayload);
    }

    return ResponseUtil.success(member, 'Member added successfully');
  }

  async updateMemberRole(organizationId: string, userId: string, role: OrganizationRole) {
    // If demoting an owner, ensure there is at least one other owner
    if (role !== 'OWNER') {
      const owners = await this.db.organizationMember.count({
        where: { organizationId, role: 'OWNER' },
      });
      const currentMember = await this.db.organizationMember.findUnique({
        where: { organizationId_userId: { organizationId, userId } },
      });

      if (currentMember?.role === 'OWNER' && owners <= 1) {
        throw new ForbiddenException('Cannot demote the last owner of the organization.');
      }
    }

    const updated = await this.db.organizationMember.update({
      where: {
        organizationId_userId: {
          organizationId,
          userId,
        },
      },
      data: { role },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            picture: true,
          },
        },
      },
    });

    // Emit event for email notification
    const organization = await this.db.organization.findUnique({ where: { id: organizationId } });
    if (organization) {
      this.eventEmitter.emit(EmailEvents.ORGANIZATION_MEMBER_ROLE_UPDATED, {
        email: updated.user.email,
        name: updated.user.name,
        organizationName: organization.name,
        newRole: role,
      } as OrganizationMemberRoleUpdatedPayload);
    }

    return ResponseUtil.success(updated, 'Member role updated successfully');
  }

  async removeMember(organizationId: string, userId: string) {
    const member = await this.db.organizationMember.findUnique({
      where: {
        organizationId_userId: {
          organizationId,
          userId,
        },
      },
    });

    if (!member) {
      throw new NotFoundException('Member not found');
    }

    // Ensure we don't remove the last owner
    if (member.role === 'OWNER') {
      const owners = await this.db.organizationMember.count({
        where: { organizationId, role: 'OWNER' },
      });
      if (owners <= 1) {
        throw new ForbiddenException('Cannot remove the last owner of the organization.');
      }
    }

    const organization = await this.db.organization.findUnique({ where: { id: organizationId } });
    const user = await this.db.user.findUnique({ where: { id: userId } });

    await this.db.organizationMember.delete({
      where: {
        organizationId_userId: {
          organizationId,
          userId,
        },
      },
    });

    // Emit event for email notification
    if (organization && user) {
      this.eventEmitter.emit(EmailEvents.ORGANIZATION_MEMBER_REMOVED, {
        email: user.email,
        name: user.name,
        organizationName: organization.name,
      } as OrganizationMemberRemovedPayload);
    }

    return ResponseUtil.success(null, 'Member removed successfully');
  }

  /**
   * Validates that a user has one of the required roles in an organization.
   * Throws ForbiddenException if not authorized.
   */
  async validateMemberRole(organizationId: string, userId: string, requiredRoles: OrganizationRole[]) {
    const membership = await this.db.organizationMember.findUnique({
      where: {
        organizationId_userId: {
          organizationId,
          userId,
        },
      },
    });

    if (!membership || !requiredRoles.includes(membership.role)) {
      throw new ForbiddenException('You do not have the required permissions to perform this action.');
    }

    return membership;
  }

  async getPublicProfile(slug: string) {
    const organization = await this.db.organization.findUnique({
      where: { slug },
      select: {
        id: true,
        name: true,
        slug: true,
        logoUrl: true,
        color: true,
        isVerified: true,
        created_at: true,
      },
    });

    if (!organization) {
      throw new NotFoundException('Organization not found');
    }

    return ResponseUtil.success(organization, 'Organization public profile retrieved successfully');
  }

  private generateSlug(name: string): string {
    return name
      .toLowerCase()
      .trim()
      .replace(/[^\w\s-]/g, '')
      .replace(/[\s_-]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }
}
