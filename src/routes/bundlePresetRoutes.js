const express = require('express');
const router = express.Router();
const bundlePresetController = require('../controllers/bundlePresetController');

router.get('/:itemType/:id', bundlePresetController.getBundlePresets);

router.post('/', bundlePresetController.createBundlePreset);
router.get('/:id', bundlePresetController.getBundlePresetById);
router.put('/:id', bundlePresetController.updateBundlePreset);
router.delete('/:id', bundlePresetController.deleteBundlePreset);

module.exports = router;
