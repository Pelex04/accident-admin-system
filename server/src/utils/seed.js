const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const db = require('../db/database');
const config = require('../config');

function seedDemoData() {
  if (db.get('vehicles').size().value() > 0) {
    console.log('Demo vehicles already exist, skipping demo data seed.');
    return;
  }

  const vehicleId = uuidv4();

  db.get('vehicles')
    .push({
      id: vehicleId,
      name: 'Demo Vehicle - Toyota Corolla',
      arduinoSimNumber: '+265991000001',
      status: 'active',
      registeredAt: new Date().toISOString()
    })
    .write();

  db.get('contacts')
    .push({
      id: uuidv4(),
      vehicleId,
      name: 'Demo Emergency Contact',
      phoneNumber: '+265888000001',
      priority: 1
    })
    .write();

  db.get('simStatuses')
    .push({
      id: uuidv4(),
      vehicleId,
      lastHeartbeatAt: new Date().toISOString(),
      lastKnownBalanceText: 'Main balance MWK 500, valid until end of month',
      lowBalanceFlag: false,
      lastCheckedAt: new Date().toISOString()
    })
    .write();

  console.log('Demo vehicle, contact, and sim status created.');
}

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
seedDemoData();
