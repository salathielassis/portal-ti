import { OmitType, PartialType } from '@nestjs/swagger';
import { CreateSiteDto } from './create-site.dto';

/** CNPJ não é editável — é a chave que liga o extrato da locadora ao estabelecimento. */
export class UpdateSiteDto extends PartialType(OmitType(CreateSiteDto, ['cnpj'] as const)) {}
