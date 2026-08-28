/**
 * Troca a senha de um usuário existente direto no banco (produção ou local).
 *
 * Uso:
 *   npm run set-password -- admin@portalti.com "NovaSenhaForte123"
 *
 * Para rodar contra o banco de produção (Neon) sem mexer no seu .env local,
 * defina DATABASE_URL só para esse comando (PowerShell):
 *   $env:DATABASE_URL="postgresql://...string-do-neon...";  npm run set-password -- admin@portalti.com "NovaSenhaForte123"
 */
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  const [, , email, newPassword] = process.argv;

  if (!email || !newPassword) {
    console.error('Uso: npm run set-password -- <email> <nova-senha>');
    process.exit(1);
  }

  if (newPassword.length < 8) {
    console.error('A nova senha precisa ter pelo menos 8 caracteres.');
    process.exit(1);
  }

  const existing = await prisma.user.findUnique({ where: { email } });
  if (!existing) {
    console.error(`Nenhum usuário encontrado com o e-mail "${email}".`);
    process.exit(1);
  }

  const passwordHash = await bcrypt.hash(newPassword, 10);
  await prisma.user.update({ where: { email }, data: { passwordHash } });

  console.log(`Senha atualizada com sucesso para ${email}.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
