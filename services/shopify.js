const axios = require('axios');

function getClient() {
  const baseURL = `https://${process.env.SHOPIFY_STORE_URL}/admin/api/2024-01`;
  return axios.create({
    baseURL,
    headers: { 'X-Shopify-Access-Token': process.env.SHOPIFY_ACCESS_TOKEN },
  });
}

// 商品名で既存商品を検索
async function findProductByTitle(title) {
  const client = getClient();
  const res = await client.get('/products.json', {
    params: { title, limit: 1 },
  });
  const products = res.data.products;
  if (products.length > 0 && products[0].title === title) {
    return products[0];
  }
  return null;
}

// 既存商品にバリアント（鑑定番号）を追加
async function addVariant(productId, certNumber) {
  const client = getClient();
  const res = await client.post(`/products/${productId}/variants.json`, {
    variant: {
      option1: certNumber,
      inventory_management: 'shopify',
      inventory_quantity: 1,
    },
  });
  return res.data.variant;
}

// 既存商品に画像を追加
async function addImages(productId, cert) {
  const client = getClient();
  const added = [];
  if (cert.frontImageUrl) {
    const res = await client.post(`/products/${productId}/images.json`, {
      image: { src: cert.frontImageUrl, alt: `Cert# ${cert.certNumber} Front`, filename: `${cert.certNumber}_front.jpg` },
    });
    added.push(res.data.image);
  }
  if (cert.backImageUrl) {
    const res = await client.post(`/products/${productId}/images.json`, {
      image: { src: cert.backImageUrl, alt: `Cert# ${cert.certNumber} Back`, filename: `${cert.certNumber}_back.jpg` },
    });
    added.push(res.data.image);
  }
  return added;
}

// 新規商品を作成（バリアント = 鑑定番号、オプション名 = Cert Number）
async function createProduct(cert) {
  const client = getClient();
  const images = [];
  if (cert.frontImageUrl) images.push({ src: cert.frontImageUrl, alt: `Cert# ${cert.certNumber} Front`, filename: `${cert.certNumber}_front.jpg` });
  if (cert.backImageUrl) images.push({ src: cert.backImageUrl, alt: `Cert# ${cert.certNumber} Back`, filename: `${cert.certNumber}_back.jpg` });

  const product = {
    product: {
      title: `${cert.subject} - ${cert.grade}`,
      body_html: `
        <p><strong>Year:</strong> ${cert.year}</p>
        <p><strong>Brand:</strong> ${cert.brand}</p>
        <p><strong>Card Number:</strong> ${cert.cardNumber}</p>
        <p><strong>Category:</strong> ${cert.category}</p>
        <p><strong>Grade:</strong> ${cert.grade}</p>
        ${cert.variety ? `<p><strong>Variety:</strong> ${cert.variety}</p>` : ''}
      `.trim(),
      vendor: 'PSA',
      product_type: cert.category,
      tags: [cert.grade, cert.year, cert.brand].filter(Boolean).join(', '),
      options: [{ name: 'Cert Number' }],
      variants: [
        {
          option1: cert.certNumber,
          inventory_management: 'shopify',
          inventory_quantity: 1,
        },
      ],
      images,
    },
  };

  const res = await client.post('/products.json', product);
  return res.data.product;
}

// メイン処理: 同一商品名があればバリアント追加、なければ新規作成
async function registerCert(cert) {
  const title = `${cert.subject} - ${cert.grade}`;
  const existing = await findProductByTitle(title);

  if (existing) {
    // 既存商品にバリアント＋画像を追加
    const variant = await addVariant(existing.id, cert.certNumber);
    await addImages(existing.id, cert);
    return { product: existing, variant, isNew: false };
  } else {
    // 新規商品を作成
    const product = await createProduct(cert);
    return { product, variant: product.variants[0], isNew: true };
  }
}

module.exports = { registerCert };
