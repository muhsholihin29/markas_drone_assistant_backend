// src/routes/aiAssistantRoutes.js
const express = require('express');
const router = express.Router();
const aiAssistantController = require('../controllers/aiAssistantController');

router.get('/sessions', aiAssistantController.getSessions);
router.post('/sessions', aiAssistantController.createSession);
router.get('/sessions/:sessionId/messages', aiAssistantController.getSessionMessages);
router.delete('/sessions/:sessionId', aiAssistantController.deleteSession);

router.post('/chat', aiAssistantController.sendMessage);
router.get('/messages/:messageId', aiAssistantController.getMessageStatus);
router.post('/messages/:messageId/retry', aiAssistantController.retryMessage);

module.exports = router;
