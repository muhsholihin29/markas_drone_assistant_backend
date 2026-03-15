const axios = require("axios");
const fs = require("fs");
const FormData = require("form-data");

const IMGBB_API_KEY = process.env.IMGBB_API_KEY;

async function uploadToImgBB(filePath) {
    try {
        const base64 = fs.readFileSync(filePath, { encoding: "base64" });

        const form = new FormData();
        form.append("image", base64);

        const res = await axios.post(
            `https://api.imgbb.com/1/upload?key=${IMGBB_API_KEY}`,
            form,
            {
                headers: form.getHeaders()
            }
        );

        return res.data.data.url;
    } catch (err) {
        console.error("ImgBB error:", err.response?.data || err.message);
        throw err;
    }
}

module.exports = uploadToImgBB;
