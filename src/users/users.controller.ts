import { Controller, Delete, Get, Param, Req, UnauthorizedException } from '@nestjs/common';
import { UsersService } from './users.service';
import { ApiOperation, ApiResponse } from '@nestjs/swagger';
import { Public } from 'src/auth/decorators/public.decorator';
import { Role } from 'src/auth/enums/role.enum';
import { Roles } from 'src/auth/decorators/roles.decorator';

@Controller('users')
export class UsersController {
    constructor(private readonly usersService: UsersService) { }

    @Roles(Role.SUPER_ADMIN)
    @Get()
    @ApiOperation({ summary: 'Get all users' })
    @ApiResponse({ status: 200, description: 'Users retrieved' })
    @ApiResponse({ status: 401, description: 'Unauthorized' })
    @ApiResponse({ status: 403, description: 'Forbidden' })
    getAllUsers() {
        return this.usersService.findAll()
    }
    // delete user
    // @Roles(Role.SUPER_ADMIN)
    @Delete(':id')
    @ApiOperation({ summary: 'Delete user' })
    @ApiResponse({ status: 200, description: 'User deleted' })
    @ApiResponse({ status: 401, description: 'Unauthorized' })
    @ApiResponse({ status: 403, description: 'Forbidden' })
    deleteUser(@Param('id') id: string, @Req() req: any) {
        const user = req.user
        if (user.role !== Role.SUPER_ADMIN && user.sub !== id) {
            throw new UnauthorizedException('Unauthorized')
        }
        return this.usersService.delete(id)
    }
}
