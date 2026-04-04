// src/routes/catalogRoutes.js
const express = require('express');
const router = express.Router();
const catalogController = require('../controllers/catalogController');

router.get('/models', catalogController.getDroneModels);
router.post('/models', catalogController.createDroneModel);

router.get('/sub-models', catalogController.getDroneSubModels);
router.post('/sub-models', catalogController.createDroneSubModel);

router.get('/accessories', catalogController.getAccessories);
router.post('/accessories', catalogController.createAccessory);

// Models
router.put('/models/:id', catalogController.updateDroneModel);
router.delete('/models/:id', catalogController.deleteDroneModel);

// Sub Models
router.put('/sub-models/:id', catalogController.updateDroneSubModel);
router.delete('/sub-models/:id', catalogController.deleteDroneSubModel);

// Accessories
router.put('/accessories/:id', catalogController.updateAccessory);
router.delete('/accessories/:id', catalogController.deleteAccessory);

module.exports = router;
