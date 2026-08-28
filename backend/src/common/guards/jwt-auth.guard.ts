import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

/** Valida o Bearer token JWT (estratégia 'jwt' registrada no AuthModule) */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {}
