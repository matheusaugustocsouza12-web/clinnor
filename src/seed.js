require('dotenv').config();
const bcrypt = require('bcryptjs');
const db = require('./db');

async function seed() {
  const email = (process.env.ADMIN_EMAIL || 'admin@brainmed.local').toLowerCase();
  const password = process.env.ADMIN_PASSWORD || 'ChangeMe123!';
  const passwordHash = await bcrypt.hash(password, 12);
  await db.query(
    `INSERT INTO users (name, email, password_hash, role, active)
     VALUES ('Administrador BrainMed', $1, $2, 'admin', true)
     ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash,
       role = 'admin', active = true`,
    [email, passwordHash]
  );
  await db.query(
    `INSERT INTO clinic_settings (business_name)
     VALUES ('Minha Clínica')
     ON CONFLICT (id) DO NOTHING`
  );
  console.log(`Administrador criado ou atualizado: ${email}`);
  await db.pool.end();
}

seed().catch(async error => {
  console.error(error);
  await db.pool.end();
  process.exit(1);
});
