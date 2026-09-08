const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const db = require('../db/database');
const config = require('../config');

function seedAdmin() {
  const existing = db.get('adminUsers').find({ email: config.seedAdminEmail }).value();

  if (existing) {
    console.log('Seed admin already exists, skipping: ' + config.seedAdminEmail);
    return;
  }

  const passwordHash = bcrypt.hashSync(config.seedAdminPassword, 10);

  db.get('adminUsers')
    .push({
      id: uuidv4(),
      email: config.seedAdminEmail,
      passwordHash,
      role: 'super_admin',
      createdAt: new Date().toISOString()
    })
    .write();

  console.log('Seed admin created: ' + config.seedAdminEmail);
  console.log('Change the password after first login.');
}

seedAdmin();
