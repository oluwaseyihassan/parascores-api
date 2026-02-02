import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { UserCreateInput } from 'prisma/generated/models';
import { DatabaseService } from 'src/database/database.service';
import { ResponseUtil } from 'src/utils/api-response';
import { UpdateUserDto } from './dto/update-user.dto';
import { CreateUserDto } from './dto/create-user.dto';
import * as bcrypt from 'bcrypt';

@Injectable()
export class UsersService {
    constructor(private readonly db: DatabaseService) { }

    async createUser(dto: CreateUserDto) {
        // Check if email already exists
        const existingUser = await this.db.user.findUnique({ where: { email: dto.email } });
        if (existingUser) {
            throw new ConflictException('Email already exists');
        }

        // Hash password
        const hashedPassword = await bcrypt.hash(dto.password, 10);

        const user = await this.db.user.create({
            data: {
                email: dto.email,
                name: dto.name,
                password: hashedPassword,
                picture: dto.picture,
                isEmailVerified: true, // Admin-created users are pre-verified
            },
        });

        // Remove password from response
        const { password, ...userWithoutPassword } = user;
        return ResponseUtil.success(userWithoutPassword, 'User created successfully');
    }

    async findAll(page: number = 1, limit: number = 10) {
        const skip = (page - 1) * limit;

        const [users, total] = await Promise.all([
            this.db.user.findMany({
                skip,
                take: limit,
                orderBy: { created_at: 'desc' },
                select: {
                    id: true,
                    email: true,
                    name: true,
                    picture: true,
                    role: true,
                    isEmailVerified: true,
                    organization_name: true,
                    organization_logo: true,
                    organization_color: true,
                    created_at: true,
                    updated_at: true,
                },
            }),
            this.db.user.count(),
        ]);

        return { users, total, page, limit };
    }

    async findOne(id: string) {
        return this.db.user.findUnique({ where: { id } });
    }

    async findByEmail(email: string) {
        return this.db.user.findUnique({ where: { email } });
    }

    async create(data: UserCreateInput) {
        return this.db.user.create({ data });
    }

    async update(id: string, data: UpdateUserDto) {
        const user = await this.db.user.findUnique({ where: { id } });
        if (!user) {
            throw new NotFoundException('User not found');
        }
        
        const updated = await this.db.user.update({ where: { id }, data });
        return ResponseUtil.success(updated, 'User updated successfully');
    }

    async delete(id: string) {
        const user = await this.db.user.findUnique({ where: { id } });
        if (!user) {
            throw new NotFoundException('User not found');
        }
        if (user.role === 'SUPER_ADMIN') {
            throw new BadRequestException('Super admin cannot be deleted');
        }
        
        await this.db.user.delete({ where: { id } });
        return ResponseUtil.success('User deleted successfully')
    }
}
