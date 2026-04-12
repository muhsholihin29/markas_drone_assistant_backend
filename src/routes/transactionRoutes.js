const express = require('express');
const router = express.Router();
const transactionController = require('../controllers/transactionController');

// GET /api/v1/transactions
router.get('/', transactionController.getTransactions);
// POST /api/v1/transactions/sale
router.post('/sale', transactionController.createSale);

module.exports = router;
