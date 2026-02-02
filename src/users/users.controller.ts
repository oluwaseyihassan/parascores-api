import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UnauthorizedException } from '@nestjs/common';
import { UsersService } from './users.service';
import { ApiOperation, ApiQuery, ApiResponse } from '@nestjs/swagger';
import { Role } from 'src/auth/enums/role.enum';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { User } from 'src/auth/decorators/user.decorator';
import { PaginationQueryDto } from 'src/common/dto/pagination-query.dto';
import { ResponseUtil } from 'src/utils/api-response';
import { UpdateUserDto } from './dto/update-user.dto';
import { CreateUserDto } from './dto/create-user.dto';

@Controller('users')
export class UsersController {
    constructor(private readonly usersService: UsersService) { }

    // create user (admin only)
    @Roles(Role.SUPER_ADMIN)
    @Post()
    @ApiOperation({ summary: 'Create a new user (admin only)' })
    @ApiResponse({ status: 201, description: 'User created' })
    @ApiResponse({ status: 400, description: 'Bad request' })
    @ApiResponse({ status: 401, description: 'Unauthorized' })
    @ApiResponse({ status: 403, description: 'Forbidden' })
    createUser(@Body() createUserDto: CreateUserDto) {
        return this.usersService.createUser(createUserDto);
    }

    @Roles(Role.SUPER_ADMIN)
    @Get()
    @ApiOperation({ summary: 'Get all users (paginated)' })
    @ApiQuery({ name: 'page', required: false, type: Number, description: 'Page number' })
    @ApiQuery({ name: 'limit', required: false, type: Number, description: 'Items per page' })
    @ApiResponse({ status: 200, description: 'Users retrieved' })
    @ApiResponse({ status: 401, description: 'Unauthorized' })
    @ApiResponse({ status: 403, description: 'Forbidden' })
    async getAllUsers(@Query() paginationQuery: PaginationQueryDto) {
        const { page, limit } = paginationQuery;
        const result = await this.usersService.findAll(page, limit);
        return ResponseUtil.paginated(result.users, result.page, result.limit, result.total);
    }

    // delete user
    @Roles(Role.SUPER_ADMIN, Role.USER)
    @Delete(':id')
    @ApiOperation({ summary: 'Delete user' })
    @ApiResponse({ status: 200, description: 'User deleted' })
    @ApiResponse({ status: 401, description: 'Unauthorized' })
    @ApiResponse({ status: 403, description: 'Forbidden' })
    deleteUser(@Param('id') id: string, @User() user: any) {
        // if (user.role !== Role.SUPER_ADMIN && user.sub !== id) {
        //     throw new UnauthorizedException('Unauthorized')
        // }
        return this.usersService.delete(id)
    }

    // partial update user
    @Roles(Role.SUPER_ADMIN, Role.USER)
    @Patch(':id')
    @ApiOperation({ summary: 'Partial update user' })
    @ApiResponse({ status: 200, description: 'User updated' })
    @ApiResponse({ status: 401, description: 'Unauthorized' })
    @ApiResponse({ status: 403, description: 'Forbidden' })
    updateUser(@Param('id') id: string, @Body() updateUserDto: UpdateUserDto, @User() user: any) {
        if (user.role !== Role.SUPER_ADMIN && user.sub !== id) {
            throw new UnauthorizedException('Unauthorized')
        }
        return this.usersService.update(id, updateUserDto)
    }
}
