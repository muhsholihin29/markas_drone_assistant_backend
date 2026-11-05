# 📑 Buy Assistant API Specification for Frontend

Dokumentasi spesifikasi endpoint API Buy Assistant lengkap dengan sampel Request dan Response Payload untuk integrasi Frontend.

---

## 🌐 Base URL & Header
- **Base Endpoint:** `/api/v1/buy-assistant`
- **Headers:**
  - `Accept: application/json`
  - `Content-Type: application/json` *(untuk request tanpa file)*
  - `Content-Type: multipart/form-data` *(untuk POST dan PUT dengan file gambar)*

---

## 1. GET List Rekomendasi (List View)
Mengambil daftar listing pasar dengan filter opsional.

- **Endpoint:** `GET /api/v1/buy-assistant/recommendations`
- **Method:** `GET`
- **Query Parameters (Opsional):**
  - `status` : `Active` | `Watchlist` | `Bought` | `Skipped` | `Sold`
  - `type`   : `Drone` | `Accessory`

### Contoh Request
```http
GET /api/v1/buy-assistant/recommendations?type=Drone&status=Active HTTP/1.1
Host: api.markasdrone.com
Accept: application/json
```

### Contoh Response (`200 OK`)
```json
[
  {
    "id": 82,
    "type": "Drone",
    "source_platform": "Tokopedia",
    "link": "https://www.tokopedia.com/item/123456",
    "price": 9500000,
    "status": "Active",
    "title": "DJI Mini 2 Combo Like New Fullset Mulus Normal",
    "description": "Dijual santai DJI Mini 2 kondisi mulus 98%, no crash, baterai cc 15, kelengkapan fullset tas dus.",
    "drone_model_id": 4,
    "model_name": "Mini 2",
    "sub_model_id": 3,
    "sub_model_name": "Mini 2 Fly More Combo",
    "drone_name": "Mini 2 Fly More Combo",
    "completeness": "Fly More Combo",
    "location": "Surabaya",
    "seller_reputation": "Power Merchant Pro",
    "accessory_id": null,
    "accessory_name": null,
    "condition": "Bekas",
    "condition_score": 5,
    "notes": "Unit mulus siap pakai, baterai prima",
    "fair_price": 9800000,
    "price_score": 5,
    "analysis_condition_score": 5,
    "completeness_score": 5,
    "profit_prediction": 300000,
    "buy_recommendation": "CONSIDER",
    "image_urls": [
      "https://i.ibb.co/example1/image1.jpg",
      "https://i.ibb.co/example2/image2.jpg"
    ],
    "created_at": "2026-08-23T23:03:45.503Z"
  },
  {
    "id": 83,
    "type": "Accessory",
    "source_platform": "Shopee",
    "link": "https://shopee.co.id/item/789012",
    "price": 450000,
    "status": "Active",
    "title": "Baterai DJI Mini 2 Original Normal CC 10",
    "description": "Baterai original copotan unit, cell aman no kembung.",
    "drone_model_id": null,
    "model_name": null,
    "sub_model_id": null,
    "sub_model_name": null,
    "drone_name": null,
    "completeness": null,
    "location": null,
    "seller_reputation": null,
    "accessory_id": 12,
    "accessory_name": "Intelligent Flight Battery Mini 2",
    "condition": "Bekas",
    "condition_score": 4,
    "notes": "Voltase normal",
    "fair_price": 550000,
    "price_score": 5,
    "analysis_condition_score": 4,
    "completeness_score": null,
    "profit_prediction": 100000,
    "buy_recommendation": "BUY",
    "image_urls": [
      "https://i.ibb.co/example3/battery.jpg"
    ],
    "created_at": "2026-08-23T23:15:00.000Z"
  }
]
```

---

## 2. GET Detail Item (Detail View)
Mengambil detail lengkap 1 item berdasarkan `id`.

- **Endpoint:** `GET /api/v1/buy-assistant/:id`
- **Method:** `GET`

### Contoh Request
```http
GET /api/v1/buy-assistant/82 HTTP/1.1
Host: api.markasdrone.com
Accept: application/json
```

### Contoh Response (`200 OK`)
```json
{
  "id": 82,
  "type": "Drone",
  "source_platform": "Tokopedia",
  "link": "https://www.tokopedia.com/item/123456",
  "price": 9500000,
  "status": "Active",
  "title": "DJI Mini 2 Combo Like New Fullset Mulus Normal",
  "description": "Dijual santai DJI Mini 2 kondisi mulus 98%, no crash, baterai cc 15, kelengkapan fullset tas dus.",
  "drone_model_id": 4,
  "model_name": "Mini 2",
  "sub_model_id": 3,
  "sub_model_name": "Mini 2 Fly More Combo",
  "drone_name": "Mini 2 Fly More Combo",
  "completeness": "Fly More Combo",
  "location": "Surabaya",
  "seller_reputation": "Power Merchant Pro",
  "accessory_id": null,
  "accessory_name": null,
  "condition": "Bekas",
  "condition_score": 5,
  "notes": "Unit mulus siap pakai, baterai prima",
  "fair_price": 9800000,
  "price_score": 5,
  "analysis_condition_score": 5,
  "completeness_score": 5,
  "profit_prediction": 300000,
  "buy_recommendation": "CONSIDER",
  "image_urls": [
    "https://i.ibb.co/example1/image1.jpg",
    "https://i.ibb.co/example2/image2.jpg"
  ],
  "created_at": "2026-08-23T23:03:45.503Z"
}
```

### Contoh Response Jika Tidak Ditemukan (`404 Not Found`)
```json
{
  "error": "Buy Assistant item not found"
}
```

---

## 3. POST Tambah Listing (Create)
Menambahkan listing baru ke Buy Assistant.

- **Endpoint:** `POST /api/v1/buy-assistant`
- **Method:** `POST`
- **Content-Type:** `multipart/form-data`

### Form Fields (Request Body)
| Field | Tipe Data | Wajib? | Keterangan |
|---|---|---|---|
| `type` | String | Ya | `'Drone'` atau `'Accessory'` |
| `source_platform` | String | Ya | Contoh: `'Tokopedia'`, `'Shopee'`, `'Facebook'`, dll |
| `title` | String | Opsional | Judul asli listing dari marketplace |
| `description` | String | Opsional | Deskripsi asli listing dari marketplace |
| `link` | String | Ya | URL listing marketplace |
| `price` | Number / String | Ya | Harga penawaran seller (contoh: `5200000`) |
| `status` | String | Opsional | Default: `'Active'`. Pilihan: `'Active'`, `'Watchlist'`, `'Bought'`, `'Skipped'`, `'Sold'` |
| `condition` | String | Ya | `'New'` atau `'Bekas'` |
| `condition_score`| Number / String | Ya | Skor kondisi fisik (skala `1` - `5`) |
| `notes` | String | Opsional | Catatan tambahan |
| **Khusus Drone:** | | | |
| `drone_model_id` | Number / String | Opsional | ID model drone (`drone_models.id`) |
| `sub_model_id` | Number / String | Opsional | ID sub-model / varian drone (`drone_sub_models.id`) |
| `completeness` | String | Opsional | Contoh: `'Fly More Combo'`, `'Unit Only'` |
| `location` | String | Opsional | Lokasi seller |
| `seller_reputation` | String | Opsional | Reputasi seller |
| **Khusus Aksesoris:** | | | |
| `accessory_id` | Number / String | Opsional | ID aksesoris (`accessories.id`) |
| **Data Analisis (Opsional):** | | | |
| `fair_price` | Number / String | Opsional | Estimasi harga wajar / pasaran |
| `price_score` | Number / String | Opsional | Skor harga (1-5 / 1-10) |
| `analysis_condition_score` | Number / String | Opsional | Skor kondisi analisis |
| `completeness_score` | Number / String | Opsional | Skor kelengkapan |
| `profit_prediction` | Number / String | Opsional | Estimasi potensi profit |
| `buy_recommendation` | String | Opsional | `'BUY'`, `'SKIP'`, atau `'HOLD'` |
| **Files (Gambar):** | | | |
| `images` | File[] | Opsional | Multiple image files |

### Contoh Request (Form Data)
```
type: Drone
source_platform: Tokopedia
title: DJI Mini 2 Fly More Combo Mulus Fullset
description: Dijual DJI Mini 2 kondisi istimewa, jarang pakai, baterai cc rendah.
link: https://www.tokopedia.com/item/123456
price: 5200000
status: Active
drone_model_id: 4
sub_model_id: 3
condition: Bekas
condition_score: 5
completeness: Fly More Combo
location: Jakarta Barat
seller_reputation: Official Store
fair_price: 5800000
profit_prediction: 600000
buy_recommendation: BUY
images: [image1.jpg, image2.jpg]
```

### Contoh Response (`201 Created`)
```json
{
  "message": "Data Buy Assistant berhasil disimpan",
  "market_item_id": 84,
  "type": "Drone",
  "analysis_id": 43
}
```

---

## 4. PUT Update Listing (Update)
Memperbarui listing yang sudah ada berdasarkan `id`.

- **Endpoint:** `PUT /api/v1/buy-assistant/:id`
- **Method:** `PUT`
- **Content-Type:** `multipart/form-data`

### Contoh Request (Form Data)
```
price: 4900000
status: Bought
title: DJI Mini 2 Fly More Combo Mulus (Deal 4.9jt)
notes: Transaksi berhasil dinego di angka 4.9jt
```

### Contoh Response (`200 OK`)
```json
{
  "message": "Data Buy Assistant berhasil diperbarui",
  "market_item_id": 84,
  "type": "Drone"
}
```

---

## 5. DELETE Listing (Hapus)
Menghapus listing beserta analisis dan data gambarnya.

- **Endpoint:** `DELETE /api/v1/buy-assistant/:id`
- **Method:** `DELETE`

### Contoh Response (`200 OK`)
```json
{
  "message": "Data Buy Assistant berhasil dihapus",
  "market_item_id": 84
}
```

---

## 💡 Panduan Display & Mapping Frontend

1. **Penamaan Item (`displayName`)**:
   - **Drone:** Gunakan `drone_name` (backend sudah otomatis fallback: `sub_model_name` ➔ `model_name` ➔ `title`).
   - **Aksesoris:** Gunakan `accessory_name` (backend otomatis fallback: `accessory_name` ➔ `title`).
2. **Data Asli Marketplace**:
   - `title`: Ditampilkan sebagai judul original dari listing marketplace.
   - `description`: Ditampilkan sebagai deskripsi lengkap postingan seller.
3. **Daftar Gambar (`image_urls`)**:
   - Selalu berformat Array of String murni (`string[]`), misal: `["https://..."]`.
