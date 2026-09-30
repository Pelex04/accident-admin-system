const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../db/database');
const config = require('../config');

const router = express.Router();

router.post('/login', (req, res) => {
  const rawEmail = (req.body && req.body.email) || '';
  const rawPassword = (req.body && req.body.password) || '';

  const email = rawEmail.trim().toLowerCase();
  const password = rawPassword.trim();

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  const admin = db.get('adminUsers').find({ email }).value();

  if (!admin) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const passwordMatches = bcrypt.compareSync(password, admin.passwordHash);

  if (!passwordMatches) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const token = jwt.sign(
    { id: admin.id, email: admin.email, role: admin.role },
    config.jwtSecret,
    { expiresIn: config.jwtExpiresIn }
  );

  return res.json({
    token,
    admin: { id: admin.id, email: admin.email, role: admin.role }
  });
});

module.exports = router;
