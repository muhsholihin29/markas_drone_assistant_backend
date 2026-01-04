// src/routes/dashboardRoutes.js
const express = require('express');
const router = express.Router();
const dashboardController = require('../controllers/dashboardController');

// Definisi Route: GET /dashboard
router.get('/', dashboardController.getDashboardData);

module.exports = router;
