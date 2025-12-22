import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { UserCreateInput, UserUpdateInput } from 'prisma/generated/models';
import { DatabaseService } from 'src/database/database.service';
import { ResponseUtil } from 'src/utils/api-response';

@Injectable()
export class UsersService {
    constructor(private readonly db: DatabaseService) { }

    async findAll() {
        const users = await this.db.user.findMany()
        console.log(users.map((user) => {
            const {password, ...userWithoutPassword} = user
            return userWithoutPassword
        }))
        return ResponseUtil.success(users)
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

    async update(id: string, data: UserUpdateInput) {
        return this.db.user.update({ where: { id }, data });
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
