import { Controller, Get } from '@nestjs/common';
import { Public } from '../common/auth-user.js';
import { PrismaService } from '../prisma/prisma.service.js';

@Public()
@Controller('categories')
export class CategoriesController {
  constructor(private readonly prisma: PrismaService) {}

  /** Errand types shown in the apps (customer home, runner "Services Offered"). */
  @Get()
  list() {
    return this.prisma.serviceCategory.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: 'asc' },
      select: { slug: true, name: true, icon: true },
    });
  }
}
