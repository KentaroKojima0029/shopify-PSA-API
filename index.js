require('dotenv').config();
const express = require('express');
const basicAuth = require('express-basic-auth');
const multer = require('multer');
const csvParser = require('csv-parser');
const fs = require('fs');
const { isAlreadyFetched, saveCert, getCert, getAllCerts } = require('./db/database');
const psa = require('./services/psa');
const shopify = require('./services/shopify');

const path = require('path');
const upload = multer({ dest: path.join(__dirname, 'uploads') });

const app = express();

// Basic認証
app.use(basicAuth({
  users: { [process.env.BASIC_AUTH_USER]: process.env.BASIC_AUTH_PASS },
  challenge: true,
  realm: 'PSA Card Manager',
}));

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// cert番号でPSA情報を取得 → Shopify商品作成
app.post('/api/cert/:certNumber', async (req, res) => {
  const { certNumber } = req.params;

  // 重複チェック
  if (isAlreadyFetched(certNumber)) {
    const existing = getCert(certNumber);
    return res.json({ message: '取得済みの番号です', cert: existing });
  }

  try {
    // PSA cert情報を取得
    const certData = await psa.getCert(certNumber);
    if (!certData.PSACert) {
      return res.status(404).json({ message: 'カード情報が見つかりません' });
    }

    const c = certData.PSACert;

    // 画像を取得
    let frontImageUrl = null;
    let backImageUrl = null;
    try {
      const images = await psa.getImages(certNumber);
      if (Array.isArray(images)) {
        const front = images.find((img) => img.IsFrontImage);
        const back = images.find((img) => !img.IsFrontImage);
        frontImageUrl = front?.ImageURL || null;
        backImageUrl = back?.ImageURL || null;
      }
    } catch {
      // 画像が無い場合はスキップ
    }

    const certRecord = {
      certNumber: c.CertNumber,
      grade: c.CardGrade,
      subject: c.Subject,
      year: c.Year,
      brand: c.Brand,
      cardNumber: c.CardNumber,
      category: c.Category,
      variety: c.Variety || '',
      frontImageUrl,
      backImageUrl,
    };

    // Shopify: 同一商品名があればバリアント追加、なければ新規作成
    const result = await shopify.registerCert(certRecord);
    certRecord.shopifyProductId = String(result.product.id);

    // DBに保存
    saveCert(certRecord);

    const action = result.isNew ? '新規商品を作成' : '既存商品にバリアントを追加';
    res.json({ message: `${action}しました`, cert: certRecord, shopifyProductId: result.product.id });
  } catch (e) {
    console.error('エラー:', e.response?.data || e.message);
    res.status(500).json({ message: 'エラーが発生しました', error: e.message });
  }
});

// CSVアップロード → 鑑定番号を抽出
app.post('/api/csv/upload', upload.single('csvfile'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ message: 'CSVファイルが必要です' });
  }

  const certNumbers = [];
  const CERT_COLUMN_NAMES = ['cert number', 'certnumber', 'cert #', 'cert no', 'certno', 'certification number', 'cert'];

  try {
    await new Promise((resolve, reject) => {
      fs.createReadStream(req.file.path)
        .pipe(csvParser())
        .on('headers', (headers) => {
          const matched = headers.find(h => CERT_COLUMN_NAMES.includes(h.toLowerCase().trim()));
          if (!matched) {
            reject(new Error(`鑑定番号の列が見つかりません。列名: ${headers.join(', ')}`));
          }
        })
        .on('data', (row) => {
          const key = Object.keys(row).find(k => CERT_COLUMN_NAMES.includes(k.toLowerCase().trim()));
          if (key && row[key]) {
            const num = row[key].toString().trim();
            if (num) certNumbers.push(num);
          }
        })
        .on('end', resolve)
        .on('error', reject);
    });
  } catch (e) {
    fs.unlinkSync(req.file.path);
    return res.status(400).json({ message: e.message });
  }

  fs.unlinkSync(req.file.path);

  // 重複を除外
  const unique = [...new Set(certNumbers)];
  const alreadyFetched = unique.filter(n => isAlreadyFetched(n));
  const toFetch = unique.filter(n => !isAlreadyFetched(n));

  res.json({
    message: `${unique.length}件の鑑定番号を検出`,
    total: unique.length,
    alreadyFetched: alreadyFetched.length,
    toFetch: toFetch.length,
    certNumbers: toFetch,
  });
});

// CSVから抽出した番号を一括処理
app.post('/api/csv/process', async (req, res) => {
  const { certNumbers } = req.body;
  if (!Array.isArray(certNumbers) || certNumbers.length === 0) {
    return res.status(400).json({ message: '処理する番号がありません' });
  }

  const results = [];
  for (const certNumber of certNumbers) {
    if (isAlreadyFetched(certNumber)) {
      results.push({ certNumber, status: 'skipped', message: '取得済み' });
      continue;
    }

    try {
      const certData = await psa.getCert(certNumber);
      if (!certData.PSACert) {
        results.push({ certNumber, status: 'not_found', message: 'データなし' });
        continue;
      }

      const c = certData.PSACert;
      let frontImageUrl = null;
      let backImageUrl = null;
      try {
        const images = await psa.getImages(certNumber);
        if (Array.isArray(images)) {
          const front = images.find((img) => img.IsFrontImage);
          const back = images.find((img) => !img.IsFrontImage);
          frontImageUrl = front?.ImageURL || null;
          backImageUrl = back?.ImageURL || null;
        }
      } catch {}

      const certRecord = {
        certNumber: c.CertNumber,
        grade: c.CardGrade,
        subject: c.Subject,
        year: c.Year,
        brand: c.Brand,
        cardNumber: c.CardNumber,
        category: c.Category,
        variety: c.Variety || '',
        frontImageUrl,
        backImageUrl,
      };

      const result = await shopify.registerCert(certRecord);
      certRecord.shopifyProductId = String(result.product.id);
      saveCert(certRecord);

      const action = result.isNew ? '新規作成' : 'バリアント追加';
      results.push({ certNumber, status: 'success', message: action });
    } catch (e) {
      results.push({ certNumber, status: 'error', message: e.message });
    }
  }

  const success = results.filter(r => r.status === 'success').length;
  const skipped = results.filter(r => r.status === 'skipped').length;
  const failed = results.filter(r => r.status === 'error' || r.status === 'not_found').length;

  res.json({ message: `完了: ${success}件登録, ${skipped}件スキップ, ${failed}件失敗`, results });
});

// 取得済み一覧
app.get('/api/certs', (req, res) => {
  const certs = getAllCerts();
  res.json({ count: certs.length, certs });
});

// 取得済みチェック
app.get('/api/cert/:certNumber', (req, res) => {
  const cert = getCert(req.params.certNumber);
  if (cert) {
    return res.json({ fetched: true, cert });
  }
  res.json({ fetched: false });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`サーバー起動: http://localhost:${PORT}`);
});
