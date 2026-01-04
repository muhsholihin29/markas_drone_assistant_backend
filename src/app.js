// src/app.js
require('dotenv').config();
const express = require('express');
const cors = require('cors');

// Import Routes
const dashboardRoutes = require('./routes/dashboardRoutes');
const catalogRoutes = require('./routes/catalogRoutes');
const inventoryRoutes = require('./routes/inventoryRoutes');
const transactionRoutes = require('./routes/transactionRoutes');
const path = require("path");

const app = express();
const PORT = process.env.APP_PORT || 3000;

// Middleware
app.use(cors()); // Agar bisa diakses dari Flutter
app.use(express.json()); // Agar bisa membaca JSON body

// Middleware Log Custom
app.use((req, res, next) => {
    const start = Date.now(); // Mulai hitung waktu

    // Log saat Request Masuk
    console.log(`\n[${new Date().toISOString()}] REQUEST MASUK:`);
    console.log(`Method : ${req.method}`);
    console.log(`URL    : ${req.url}`);
    if (req.body && Object.keys(req.body).length > 0) {
        console.log(`Body   :`, JSON.stringify(req.body, null, 2));
    }

    // Hook untuk Log saat Response Selesai dikirim
    res.on('finish', () => {
        const duration = Date.now() - start;
        console.log(`[${new Date().toISOString()}] RESPONSE SELESAI:`);
        console.log(`Status : ${res.statusCode}`);
        console.log(`Durasi : ${duration}ms`);
        console.log('--------------------------------------------------');
    });

    next(); // Lanjut ke route berikutnya
});

// Middleware untuk Log Response Body
app.use((req, res, next) => {
    // 1. Simpan method asli res.send agar tidak hilang
    const originalSend = res.send;

    // 2. Timpa (Override) res.send dengan fungsi kita sendiri
    res.send = function (body) {
        // 3. Log body yang akan dikirim
        console.log(`\n[${new Date().toISOString()}] RESPONSE KELUAR (${req.method} ${req.url}):`);

        // Cek jika body berupa object/json agar rapi saat diprint
        if (typeof body === 'object') {
            console.log(JSON.stringify(body, null, 2));
        } else {
            console.log(body);
        }
        console.log('--------------------------------------------------');

        // 4. Panggil method asli agar response tetap terkirim ke client
        return originalSend.call(this, body);
    };

    next();
});

// Routing
// Semua request ke /api/v1/dashboard akan diarahkan ke dashboardRoutes
app.use('/api/v1/dashboard', dashboardRoutes);
app.use('/api/v1/catalog', catalogRoutes);
app.use('/api/v1/inventory', inventoryRoutes);
app.use('/api/v1/transactions', transactionRoutes);
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// Root Endpoint (Cek server nyala/nggak)
app.use('/', (req, res) => {
    res.send('MD Assistant Backend is Running!');
});

// Start Server
app.listen(PORT, () => {
    console.log(`Server berjalan di http://localhost:${PORT}`);
    console.log(`Coba akses endpoint: http://localhost:${PORT}/api/v1/dashboard`);
});
