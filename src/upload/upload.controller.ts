import {
  Controller,
  Post,
  UploadedFile,
  UseInterceptors,
  BadRequestException,
  Query,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiOperation, ApiConsumes, ApiBody, ApiQuery } from '@nestjs/swagger';
import { UploadService } from './upload.service';
import { Public } from 'src/auth/decorators/public.decorator';

@ApiTags('upload')
@Controller('upload')
export class UploadController {
  constructor(private readonly uploadService: UploadService) {}

  // @Public()
  @Post('image')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: {
        fileSize: 5 * 1024 * 1024, // 5MB max
      },
    }),
  )
  @ApiOperation({ summary: 'Upload an image to Cloudinary' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: {
          type: 'string',
          format: 'binary',
        },
      },
    },
  })
  @ApiQuery({ name: 'folder', required: false, description: 'Folder in Cloudinary (e.g., profiles, tournaments)' })
  async uploadImage(
    @UploadedFile() file: Express.Multer.File,
    @Query('folder') folder?: string,
  ) {
    if (!file) {
      throw new BadRequestException('No file uploaded');
    }

    const result = await this.uploadService.uploadImage(file, folder || 'parascores');
    
    return {
      success: true,
      message: 'Image uploaded successfully',
      data: result,
    };
  }
}
