const axios = require('axios');
const { findExistingShopifyProductId } = require('../db/database');

function getClient() {
  const baseURL = `https://${process.env.SHOPIFY_STORE_URL}/admin/api/2024-01`;
  return axios.create({
    baseURL,
    headers: { 'X-Shopify-Access-Token': process.env.SHOPIFY_ACCESS_TOKEN },
  });
}

// グレードをPSA表記に変換
function formatGrade(grade) {
  if (!grade) return 'Other';
  const upper = grade.toUpperCase();
  if (upper.includes('10')) return 'PSA 10';
  if (upper.includes('9') && !upper.includes('19')) return 'PSA 9';
  if (upper.includes('8') && !upper.includes('18')) return 'PSA 8';
  if (upper.includes('7') && !upper.includes('17')) return 'PSA 7';
  if (upper.includes('6') && !upper.includes('16')) return 'PSA 6';
  if (upper.includes('5') && !upper.includes('15')) return 'PSA 5';
  if (upper.includes('4') && !upper.includes('14')) return 'PSA 4';
  if (upper.includes('3') && !upper.includes('13')) return 'PSA 3';
  if (upper.includes('2') && !upper.includes('12')) return 'PSA 2';
  if (upper.includes('1')) return 'PSA 1';
  return 'Other';
}

// 既存商品にバリアント（グレード + 鑑定番号）を追加
async function addVariant(productId, cert) {
  const client = getClient();
  try {
    const res = await client.post(`/products/${productId}/variants.json`, {
      variant: {
        option1: formatGrade(cert.grade),
        option2: cert.certNumber,
        inventory_management: 'shopify',
        inventory_quantity: 1,
      },
    });
    return res.data.variant;
  } catch (err) {
    // バリアントが既に存在する場合はスキップ
    if (err.response && err.response.data && err.response.data.errors) {
      const errMsg = JSON.stringify(err.response.data.errors);
      if (errMsg.includes('already exists')) {
        return null;
      }
    }
    throw err;
  }
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

// 新規商品を作成（バリアント = グレード + 鑑定番号）
async function createProduct(cert) {
  const client = getClient();
  const images = [];
  if (cert.frontImageUrl) images.push({ src: cert.frontImageUrl, alt: `Cert# ${cert.certNumber} Front`, filename: `${cert.certNumber}_front.jpg` });
  if (cert.backImageUrl) images.push({ src: cert.backImageUrl, alt: `Cert# ${cert.certNumber} Back`, filename: `${cert.certNumber}_back.jpg` });

  const product = {
    product: {
      title: `${formatGrade(cert.grade)} ${cert.subject} ${cert.year} ${cert.brand}`,
      body_html: `
        <p><strong>Year:</strong> ${cert.year}</p>
        <p><strong>Brand:</strong> ${cert.brand}</p>
        <p><strong>Card Number:</strong> ${cert.cardNumber}</p>
        <p><strong>Category:</strong> ${cert.category}</p>
        ${cert.variety ? `<p><strong>Variety:</strong> ${cert.variety}</p>` : ''}
        <div>
          <h2>Product Information</h2>
          <p>The item shown in the photos will be shipped.</p>
          <h3>Packing &amp; Shipping</h3>
          <p>
            The item will be packed with cushioning materials to prevent damage during transit.<br>
            Shipping will be handled by Japan Post or FedEx.<br>
            After payment is confirmed, the item will be shipped within 3 to 5 days.<br>
          </p>
          <p>
            FedEx shipping includes the following services:<br>
            • Express delivery service<br>
            • Insurance against damage or loss<br>
            <span style="color: #888;">*If you prefer cheaper shipping, please let us know via message.<br>
            We can lower the shipping cost by using a slower delivery service.</span>
          </p>
          <h3>Returns &amp; Customs</h3>
          <p>
            If the item has any defects, returns are accepted according to our policy.<br>
            Depending on the shipping destination, customs duties may be charged.<br>
            Any customs fees are the buyer's responsibility.
          </p>
          <h3>Combined Shipping for Multiple Items</h3>
          <p>
            On our kanucard website, all products have set shipping fees.<br>
            If you wish to purchase multiple items, we can combine them into one shipment to save on shipping costs.<br>
            This helps reduce your overall shipping fee. Please let us know via message!<br>
            <strong>If you purchase two or more items, please pay the shipping cost only once.</strong><br>
            All selected items will be shipped together in a single package.<br>
            <span style="color: #888;">*The highest shipping fee among the selected items will be applied.</span>
          </p>
          <h3>About PSA Card Material</h3>
          <p>
            Please note: As of July 2024, PSA cards are made with a new medical-grade plastic.<br>
            There is no need to worry if you own cards from before this change.
          </p>
          <h3>Card Size</h3>
          <ul>
            <li>Height: 5.31 inches</li>
            <li>Width: 3.15 inches</li>
            <li>Thickness: 0.197 inches</li>
          </ul>
        </div>
      `.trim(),
      vendor: 'PSA',
      product_type: cert.category,
      tags: [cert.year, cert.brand, cert.category].filter(Boolean).join(', '),
      options: [{ name: 'Grade' }, { name: 'Cert Number' }],
      variants: [
        {
          option1: formatGrade(cert.grade),
          option2: cert.certNumber,
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

// メイン処理: 同一カード名があればバリアント追加、なければ新規作成
async function registerCert(cert) {
  const client = getClient();

  // DBから同じカード（subject/year/brand）の既存Shopify商品IDを取得
  const existingProductId = findExistingShopifyProductId(cert.subject, cert.year, cert.brand);

  if (existingProductId) {
    // 既存商品の情報を取得
    const res = await client.get(`/products/${existingProductId}.json`);
    const existing = res.data.product;
    // バリアント（グレード + 鑑定番号）＋画像を追加
    const variant = await addVariant(existing.id, cert);
    await addImages(existing.id, cert);
    return { product: existing, variant, isNew: false };
  } else {
    // 新規商品を作成
    const product = await createProduct(cert);
    return { product, variant: product.variants[0], isNew: true };
  }
}

// Shopify上に商品が存在するか確認
async function productExists(productId) {
  const client = getClient();
  try {
    await client.get(`/products/${productId}.json`);
    return true;
  } catch (err) {
    if (err.response && err.response.status === 404) {
      return false;
    }
    throw err;
  }
}

// 鑑定番号がShopifyのバリアントとして存在するか確認
async function variantExistsByCertNumber(certNumber) {
  const client = getClient();
  // Shopify全商品からバリアントを検索（鑑定番号はoption2に格納）
  let url = '/products.json?limit=250';
  while (url) {
    const res = await client.get(url);
    for (const product of res.data.products) {
      for (const variant of product.variants) {
        if (variant.option2 === certNumber || variant.option1 === certNumber) {
          return true;
        }
      }
    }
    // ページネーション
    const link = res.headers['link'];
    if (link && link.includes('rel="next"')) {
      const match = link.match(/<([^>]+)>;\s*rel="next"/);
      if (match) {
        url = match[1].replace(/^https?:\/\/[^/]+\/admin\/api\/[^/]+/, '');
      } else {
        url = null;
      }
    } else {
      url = null;
    }
  }
  return false;
}

module.exports = { registerCert, productExists, variantExistsByCertNumber };
