const axios = require('axios');

const BASE_URL = 'https://api.psacard.com/publicapi';

function getHeaders() {
  return { Authorization: `bearer ${process.env.PSA_API_TOKEN}` };
}

async function getCert(certNumber) {
  const res = await axios.get(`${BASE_URL}/cert/GetByCertNumber/${certNumber}`, {
    headers: getHeaders(),
  });
  return res.data;
}

async function getImages(certNumber) {
  const res = await axios.get(`${BASE_URL}/cert/GetImagesByCertNumber/${certNumber}`, {
    headers: getHeaders(),
  });
  return res.data;
}

module.exports = { getCert, getImages };
