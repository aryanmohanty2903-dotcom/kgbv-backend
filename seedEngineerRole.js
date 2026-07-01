import prisma from './src/config/prisma.js';

async function main() {
  const role = await prisma.role.upsert({
    where: { code: 'FIELD_ENGINEER' },
    update: {},
    create: {
      code: 'FIELD_ENGINEER',
      name: 'Field Engineer',
      description: 'Technician responsible for resolving tickets in the field'
    }
  });
  console.log('Role FIELD_ENGINEER ensured in database:', role);
}

main()
  .catch(e => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
