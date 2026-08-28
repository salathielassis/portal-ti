import { PartialType } from '@nestjs/swagger';
import { CreatePriceTierDto } from './create-price-tier.dto';

export class UpdatePriceTierDto extends PartialType(CreatePriceTierDto) {}
