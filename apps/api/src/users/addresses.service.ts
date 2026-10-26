import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PartialType } from '@nestjs/mapped-types';
import { PrismaService } from '../prisma/prisma.service.js';
import { AddressDto, EmergencyContactDto } from './users.dto.js';

export class UpdateAddressDto extends PartialType(AddressDto) {}

const MAX_ADDRESSES = 20;

@Injectable()
export class AddressesService {
  constructor(private readonly prisma: PrismaService) {}

  list(userId: string) {
    return this.prisma.address.findMany({ where: { userId }, orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }] });
  }

  async create(userId: string, dto: AddressDto) {
    return this.prisma.$transaction(async (tx) => {
      const count = await tx.address.count({ where: { userId } });
      if (count >= MAX_ADDRESSES) throw new BadRequestException(`You can save up to ${MAX_ADDRESSES} addresses`);
      // The first address becomes the default automatically.
      const isDefault = dto.isDefault ?? count === 0;
      if (isDefault) await tx.address.updateMany({ where: { userId }, data: { isDefault: false } });
      return tx.address.create({ data: { ...dto, userId, isDefault } });
    });
  }

  async update(userId: string, id: string, dto: UpdateAddressDto) {
    return this.prisma.$transaction(async (tx) => {
      await this.findOwned(userId, id, tx);
      if (dto.isDefault) await tx.address.updateMany({ where: { userId }, data: { isDefault: false } });
      return tx.address.update({ where: { id }, data: dto });
    });
  }

  async remove(userId: string, id: string) {
    await this.findOwned(userId, id);
    await this.prisma.address.delete({ where: { id } });
    return { deleted: true };
  }

  getEmergencyContact(userId: string) {
    return this.prisma.emergencyContact.findFirst({ where: { userId } });
  }

  /** One emergency contact per user; saving replaces it. */
  async setEmergencyContact(userId: string, dto: EmergencyContactDto) {
    return this.prisma.$transaction(async (tx) => {
      await tx.emergencyContact.deleteMany({ where: { userId } });
      return tx.emergencyContact.create({ data: { ...dto, userId } });
    });
  }

  private async findOwned(userId: string, id: string, tx: Pick<PrismaService, 'address'> = this.prisma) {
    const address = await tx.address.findFirst({ where: { id, userId } });
    if (!address) throw new NotFoundException('Address not found');
    return address;
  }
}
