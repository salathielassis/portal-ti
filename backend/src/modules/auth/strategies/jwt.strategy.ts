import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';

export interface JwtPayload {
  sub: string;
  email: string;
  role: 'ADMIN' | 'FINANCEIRO' | 'SUPORTE';
}

/**
 * Estratégia Passport que valida o Bearer token e popula `request.user`.
 * Os dados vêm direto do payload assinado (sem round-trip ao banco a cada
 * request) — o payload já é reemitido no login com role/e-mail atualizados.
 */
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor() {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: process.env.JWT_SECRET ?? 'dev-secret-troque-em-producao',
    });
  }

  async validate(payload: JwtPayload) {
    return { id: payload.sub, email: payload.email, role: payload.role };
  }
}
