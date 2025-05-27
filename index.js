const express = require('express');
const { Pool } = require('pg');
const bodyParser = require('body-parser');

const app = express();
const port = process.env.PORT || 3000;
app.use(bodyParser.json());

// إعداد الاتصال بقاعدة البيانات
const pool = new Pool({
  user: 'postgres',
  password: 'GNWkTYRADqWZLnDbsJJAWKFYTVjIqKSM',
  host: 'postgres.railway.internal',
  port: 5432,
  database: 'railway',
  ssl: { rejectUnauthorized: false }
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
        edupay_activated INTEGER DEFAULT 0
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
  if (amount <= 0) return res.status(400).json({ error: 'المبلغ غير صالح' });
  try {
    const result = await pool.query('SELECT * FROM users WHERE phone = $1', [phone]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'المستخدم غير موجود' });

    const newBalance = result.rows[0].balance + amount;
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
    const result = await pool.query('UPDATE users SET identifier = $1 WHERE phone = $2', [identifier, phone]);
    if (result.rowCount === 0) return res.status(404).json({ error: 'المستخدم غير موجود' });
    res.json({ status: 'success', message: 'تم تحديث الرمز التعريفي بنجاح' });
  } catch (err) {
    res.status(500).json({ error: 'فشل التحديث' });
  }
});

// 🟢 تفعيل أو إلغاء تفعيل EduPay
app.post('/toggle-edupay', async (req, res) => {
  const { phone } = req.body;
  try {
    const result = await pool.query('SELECT edupay_activated FROM users WHERE phone = $1', [phone]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'المستخدم غير موجود' });

    const newStatus = result.rows[0].edupay_activated === 1 ? 0 : 1;
    await pool.query('UPDATE users SET edupay_activated = $1 WHERE phone = $2', [newStatus, phone]);

    res.json({
      status: 'success',
      message: newStatus === 1 ? 'تم تفعيل EduPay' : 'تم إلغاء التفعيل',
      edupay_activated: newStatus
    });
  } catch (err) {
    res.status(500).json({ error: 'فشل التحديث' });
  }
});

// 🟢 خصم رصيد بناءً على الرمز التعريفي
app.post('/charge', async (req, res) => {
  const { identifier, amount } = req.body;
  if (amount <= 0) return res.status(400).json({ status: 'error', message: 'المبلغ غير صالح' });

  try {
    const result = await pool.query('SELECT * FROM users WHERE identifier = $1', [identifier]);
    if (result.rows.length === 0) return res.status(404).json({ status: 'error', message: 'المستخدم غير موجود' });

    const user = result.rows[0];
    if (user.edupay_activated !== 1)
      return res.status(403).json({ status: 'error', message: 'يجب تفعيل EduPay أولاً' });

    if (user.balance < amount)
      return res.status(400).json({ status: 'error', message: 'الرصيد غير كافٍ' });

    const newBalance = user.balance - amount;
    await pool.query('UPDATE users SET balance = $1 WHERE id = $2', [newBalance, user.id]);

    const timestamp = new Date().toISOString();
    await pool.query('INSERT INTO logs (user_id, amount, timestamp) VALUES ($1, $2, $3)', [user.id, amount, timestamp]);

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
    res.status(500).json({ status: 'error', message: 'خطأ في الخصم' });
  }
});

// 🟢 عرض جميع المستخدمين (اختياري)
app.get('/users', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM users');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'DB Error' });
  }
});

// تشغيل الخادم
app.listen(port, () => {
  console.log(`✅ Mock Kuraimi API running on port ${port}`);
});
