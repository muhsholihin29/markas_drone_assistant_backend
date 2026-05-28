const express = require('express');
const router = express.Router();
const financialLedgerController = require('../controllers/financialLedgerController');

router.get('/', financialLedgerController.getFinancialLedger);
router.post('/actions/:action', financialLedgerController.submitLedgerAction);

module.exports = router;
