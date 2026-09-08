const express = require('express');
const { v4: uuidv4 } = require('uuid');
const db = require('../db/database');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

router.use(requireAuth);

router.get('/', (req, res) => {
  const vehicles = db.get('vehicles').value();
  return res.json(vehicles);
});

router.post('/', (req, res) => {
  const { name, arduinoSimNumber } = req.body || {};

  if (!name || !arduinoSimNumber) {
    return res.status(400).json({ error: 'name and arduinoSimNumber are required' });
  }

  const vehicle = {
    id: uuidv4(),
    name,
    arduinoSimNumber,
    status: 'active',
    registeredAt: new Date().toISOString()
  };

  db.get('vehicles').push(vehicle).write();

  return res.status(201).json(vehicle);
});

router.get('/:id', (req, res) => {
  const vehicle = db.get('vehicles').find({ id: req.params.id }).value();

  if (!vehicle) {
    return res.status(404).json({ error: 'Vehicle not found' });
  }

  return res.json(vehicle);
});

router.put('/:id', (req, res) => {
  const vehicle = db.get('vehicles').find({ id: req.params.id }).value();

  if (!vehicle) {
    return res.status(404).json({ error: 'Vehicle not found' });
  }

  const { name, arduinoSimNumber, status } = req.body || {};

  db.get('vehicles')
    .find({ id: req.params.id })
    .assign({
      name: name !== undefined ? name : vehicle.name,
      arduinoSimNumber: arduinoSimNumber !== undefined ? arduinoSimNumber : vehicle.arduinoSimNumber,
      status: status !== undefined ? status : vehicle.status
    })
    .write();

  const updated = db.get('vehicles').find({ id: req.params.id }).value();
  return res.json(updated);
});

router.delete('/:id', (req, res) => {
  const vehicle = db.get('vehicles').find({ id: req.params.id }).value();

  if (!vehicle) {
    return res.status(404).json({ error: 'Vehicle not found' });
  }

  db.get('vehicles').remove({ id: req.params.id }).write();
  db.get('contacts').remove({ vehicleId: req.params.id }).write();

  return res.status(204).send();
});

router.get('/:id/contacts', (req, res) => {
  const contacts = db.get('contacts').filter({ vehicleId: req.params.id }).value();
  return res.json(contacts);
});

router.post('/:id/contacts', (req, res) => {
  const vehicle = db.get('vehicles').find({ id: req.params.id }).value();

  if (!vehicle) {
    return res.status(404).json({ error: 'Vehicle not found' });
  }

  const { name, phoneNumber, priority } = req.body || {};

  if (!name || !phoneNumber) {
    return res.status(400).json({ error: 'name and phoneNumber are required' });
  }

  const contact = {
    id: uuidv4(),
    vehicleId: req.params.id,
    name,
    phoneNumber,
    priority: priority !== undefined ? priority : 1
  };

  db.get('contacts').push(contact).write();

  return res.status(201).json(contact);
});

module.exports = router;
