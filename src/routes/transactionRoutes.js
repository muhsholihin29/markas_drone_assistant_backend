const express = require('express');
const router = express.Router();
const transactionController = require('../controllers/transactionController');

// GET /api/v1/transactions
router.get('/', transactionController.getTransactions);
// GET /api/v1/transactions/:id
router.get('/:id', transactionController.getTransactionDetails);
// DELETE /api/v1/transactions/:id
router.delete('/:id', transactionController.deleteTransaction);
// POST /api/v1/transactions/sale
router.post('/sale', transactionController.createSale);
// PATCH /api/v1/transactions/:id/status
router.patch('/:id/status', transactionController.updateTransactionStatus);

module.exports = router;
