const express = require('express');
const router = express.Router();
const buyAssistantController = require('../controllers/buyAssistantController');
const multer = require('multer');

const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, 'uploads/');
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, file.fieldname + '-' + uniqueSuffix + '.jpg');
    }
});

const upload = multer({storage: storage});

// POST /api/v1/buy-assistant — Create item Buy Assistant
router.post('/', upload.array('images'), buyAssistantController.createBuyAssistant);

// PUT /api/v1/buy-assistant/:id — Update item Buy Assistant
router.put('/:id', upload.array('images'), buyAssistantController.updateBuyAssistant);

// DELETE /api/v1/buy-assistant/:id — Delete item Buy Assistant
router.delete('/:id', buyAssistantController.deleteBuyAssistant);

// GET /api/v1/buy-assistant/recommendations — List semua rekomendasi
// Query params opsional: ?status=Pending&type=Drone
router.get('/recommendations', buyAssistantController.getRecommendations);

// POST /api/v1/buy-assistant/block-user — Blokir user/penjual
router.post('/block-user', buyAssistantController.blockUser);

// GET /api/v1/buy-assistant/blocked-users — Daftar user yang diblokir
router.get('/blocked-users', buyAssistantController.getBlockedUsers);

// POST /api/v1/buy-assistant/unblock-user/:id — Buka blokir user
router.post('/unblock-user/:id', buyAssistantController.unblockUser);

// DELETE /api/v1/buy-assistant/blocked-users/:id — Buka blokir user (RESTful alternate)
router.delete('/blocked-users/:id', buyAssistantController.unblockUser);

// GET /api/v1/buy-assistant/:id — Detail item Buy Assistant
router.get('/:id', buyAssistantController.getBuyAssistantDetail);

module.exports = router;
