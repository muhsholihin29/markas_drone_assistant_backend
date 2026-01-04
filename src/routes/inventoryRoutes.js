const express = require('express');
const router = express.Router();
const inventoryController = require('../controllers/inventoryController');
const multer = require('multer');

// Konfigurasi Multer (Simpan di memory atau disk sementara)
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, 'uploads/') // Pastikan folder 'uploads' sudah dibuat manual: mkdir uploads
    },
    filename: function (req, file, cb) {
        // Penamaan file unik
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9)
        cb(null, file.fieldname + '-' + uniqueSuffix + '.jpg')
    }
})

const upload = multer({ storage: storage });

// ✅ Tambahkan middleware 'upload.array' atau 'upload.any' sebelum controller
// 'images' adalah key yang dikirim dari Flutter: request.files.add(..fromPath('images', ..))
router.post('/stocks', upload.array('images'), inventoryController.createStock);

router.get('/stocks', inventoryController.getStockItems);
router.put('/stocks/:id', inventoryController.updateStock); // Update
router.delete('/stocks/:id', inventoryController.deleteStock); // Delete

module.exports = router;
