const express = require('express');
const { Pool } = require('pg');
const bodyParser = require('body-parser');

const app = express();
const port = process.env.PORT || 3000;
app.use(bodyParser.json());

// إعداد الاتصال بقاعدة البيانات (Neon)
const pool = new Pool({
  connectionString: 'postgresql://neondb_owner:npg_OR9T8AcWPmDh@ep-snowy-wave-a2cvo4j8-pooler.eu-central-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require'
});

// إنشاء الجداول وإضافة بيانات أولية
(async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        phone TEXT UNIQUE NOT NULL,
        identifier TEXT UNIQUE,
        balance REAL DEFAULT 0,
        edupay_activated INTEGER DEFAULT 0,
        edupaynumber TEXT
      );

      CREATE TABLE IF NOT EXISTS logs (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id),
        amount REAL,
        timestamp TEXT
      );
    `);

    const result = await pool.query('SELECT COUNT(*) FROM users');
    if (parseInt(result.rows[0].count) === 0) {
      await pool.query(`
        INSERT INTO users (name, phone, identifier, balance, edupay_activated) VALUES
        ('علي ناصر', '714069727', '2002', 1500, 1),
        ('ريم سالم', '733112233', '2005', 900, 0)
      `);
    }

    console.log("✅ Database initialized and seed data inserted.");
  } catch (err) {
    console.error('❌ Error initializing database:', err.message);
  }
})();

// 🟢 الواجهة الرئيسية
app.get("/", (_, res) => res.send("✅ Mock Kuraimi API with PostgreSQL is running..."));

// 🟢 تسجيل الدخول
app.post('/login', async (req, res) => {
  const { phone } = req.body;
  try {
    const result = await pool.query('SELECT * FROM users WHERE phone = $1', [phone]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'رقم الهاتف غير مسجل' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'DB Error' });
  }
});

// 🟢 إنشاء مستخدم بدون معرف
app.post('/create-user', async (req, res) => {
  const { name, phone } = req.body;
  if (!name || !phone) return res.status(400).json({ error: 'الاسم ورقم الهاتف مطلوبان' });
  try {
    const result = await pool.query(
      'INSERT INTO users (name, phone) VALUES ($1, $2) RETURNING id',
      [name, phone]
    );
    res.json({ status: 'success', message: 'تم إنشاء المستخدم بنجاح', id: result.rows[0].id });
  } catch (err) {
    res.status(400).json({ error: 'فشل الإدخال: الرقم مستخدم بالفعل' });
  }
});

// 🟢 إنشاء معرف جديد
app.post('/create-identifier', async (req, res) => {
  const { name, phone, identifier, balance } = req.body;
  try {
    const result = await pool.query(
      'INSERT INTO users (name, phone, identifier, balance, edupay_activated) VALUES ($1, $2, $3, $4, $5) RETURNING id',
      [name, phone, identifier, balance, 0]
    );
    res.json({ status: 'success', message: 'تم تسجيل العميل بنجاح', user_id: result.rows[0].id });
  } catch (err) {
    res.status(400).json({ error: 'فشل إنشاء العميل أو الرقم مستخدم بالفعل' });
  }
});

// 🟢 تعبئة رصيد
app.post('/recharge', async (req, res) => {
  const { phone, amount } = req.body;

  const numericAmount = Number(amount);
  if (!phone || isNaN(numericAmount) || numericAmount <= 0)
    return res.status(400).json({ error: 'البيانات غير صالحة' });

  try {
    const result = await pool.query('SELECT * FROM users WHERE phone = $1', [phone]);
    if (result.rows.length === 0)
      return res.status(404).json({ error: 'المستخدم غير موجود' });

    const newBalance = Number(result.rows[0].balance || 0) + numericAmount;
    await pool.query('UPDATE users SET balance = $1 WHERE phone = $2', [newBalance, phone]);

    res.json({ status: 'success', message: 'تمت التعبئة بنجاح', new_balance: newBalance });
  } catch (err) {
    res.status(500).json({ error: 'فشل تحديث الرصيد' });
  }
});

// 🟢 تحديث الرمز التعريفي
app.post('/update-identifier', async (req, res) => {
  const { phone, identifier } = req.body;

  try {
    const result = await pool.query('SELECT identifier FROM users WHERE phone = $1', [phone]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'المستخدم غير موجود' });

    if (result.rows[0].identifier === identifier) {
      return res.json({ status: 'nochange', message: 'الرمز مطابق للرمز السابق، لم يتم التحديث' });
    }

    await pool.query('UPDATE users SET identifier = $1 WHERE phone = $2', [identifier, phone]);
    res.json({ status: 'success', message: 'تم تحديث الرمز التعريفي بنجاح' });
  } catch (err) {
    res.status(500).json({ error: 'فشل التحديث' });
  }
});

// 🟢 تفعيل أو إلغاء تفعيل EduPay مع رقم
app.post('/toggle-edupay', async (req, res) => {
  const { phone, edupaynumber } = req.body;
  try {
    const result = await pool.query('SELECT edupay_activated FROM users WHERE phone = $1', [phone]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'المستخدم غير موجود' });

    const newStatus = result.rows[0].edupay_activated === 1 ? 0 : 1;

    if (newStatus === 1 && edupaynumber) {
      await pool.query('UPDATE users SET edupay_activated = $1, edupaynumber = $2 WHERE phone = $3', [newStatus, edupaynumber, phone]);
    } else {
      await pool.query('UPDATE users SET edupay_activated = $1 WHERE phone = $2', [newStatus, phone]);
    }

    res.json({
      status: 'success',
      message: newStatus === 1 ? 'تم تفعيل EduPay' : 'تم إلغاء التفعيل',
      edupay_activated: newStatus
    });
  } catch (err) {
    res.status(500).json({ error: 'فشل التحديث' });
  }
});

// 🟢 خصم رصيد
app.post('/charge', async (req, res) => {
  const { identifier, amount, student_phone } = req.body;

  if (!identifier || !student_phone || amount <= 0) {
    return res.status(400).json({ status: 'error', message: 'البيانات غير مكتملة أو غير صالحة' });
  }

  try {
    const result = await pool.query('SELECT * FROM users WHERE identifier = $1', [identifier]);

    if (result.rows.length === 0)
      return res.status(404).json({ status: 'error', message: 'الرمز غير مسجل' });

    const user = result.rows[0];

    if (user.edupay_activated !== 1)
      return res.status(403).json({ status: 'error', message: 'يجب تفعيل EduPay أولاً' });

    if (user.edupaynumber !== student_phone)
      return res.status(403).json({ status: 'error', message: 'رقم الهاتف غير مطابق للرقم المفعل به EduPay' });

    if (user.balance < amount)
      return res.status(400).json({ status: 'error', message: 'الرصيد غير كافٍ' });

    const newBalance = user.balance - amount;
    await pool.query('UPDATE users SET balance = $1 WHERE id = $2', [newBalance, user.id]);

    const timestamp = new Date().toISOString();
    await pool.query(
      'INSERT INTO logs (user_id, amount, timestamp) VALUES ($1, $2, $3)',
      [user.id, amount, timestamp]
    );

    res.json({
      status: 'success',
      message: 'تم الخصم بنجاح',
      receipt_id: `MOCK-${Date.now()}`,
      name: user.name,
      amount,
      remaining_balance: newBalance,
      timestamp
    });

  } catch (err) {
    console.error(err.message);
    res.status(500).json({ status: 'error', message: 'خطأ داخلي في الخادم' });
  }
});

// 🟢 عرض كل المستخدمين
app.get('/users', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM users');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'DB Error' });
  }
});

// 🟢 تشغيل الخادم
app.listen(port, () => {
  console.log(`✅ Mock Kuraimi API running on port ${port}`);
});
