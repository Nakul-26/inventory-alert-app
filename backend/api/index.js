require('dotenv').config();
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const crypto = require('crypto');
const path = require('path');
const connectDB = require('../lib/db');
const Shop = require('../models/Shop');

const app = express();
app.use(cors({
  origin: [
    'https://inventory-alert-app.pages.dev',
    'http://localhost:5173'
  ],
  credentials: true
}));

// Fix SameSite cookie issue and CSP for embedded apps
app.use((req, res, next) => {
  res.setHeader('Content-Security-Policy', "frame-ancestors https://admin.shopify.com https://*.myshopify.com");
  next();
});

const { SHOPIFY_API_KEY, SHOPIFY_API_SECRET, SCOPES, HOST } = process.env;

// Middleware to ensure DB is connected
app.use(async (req, res, next) => {
  try {
    await connectDB();
    next();
  } catch (err) {
    console.error('Database connection error:', err);
    res.status(500).send('Internal Server Error');
  }
});

// Root route
app.get('/', async (req, res) => {
  const { shop, host } = req.query;
  if (shop) {
    try {
      const shopDoc = await Shop.findOne({ shop });
      const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
      if (shopDoc) {
        return res.redirect(`${frontendUrl}/?shop=${shop}&host=${host}`);
      }
      return res.redirect(`/auth?shop=${shop}&host=${host}`);
    } catch (err) {
      console.error('Error checking shop:', err);
      return res.status(500).send('Internal Server Error');
    }
  }
  res.send('App is running!');
});

app.use(express.static(path.join(__dirname, '..', 'public')));

// Step 1: Redirect to Shopify login
app.get('/auth', (req, res) => {
  const { shop, host } = req.query;
  if (!shop) return res.status(400).send('Missing shop parameter');

  const redirectUri = `${HOST}/auth/callback`;
  const installUrl = `https://${shop}/admin/oauth/authorize?client_id=${SHOPIFY_API_KEY}&scope=${SCOPES}&redirect_uri=${redirectUri}`;

  // Use App Bridge to redirect
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <script src="https://unpkg.com/@shopify/app-bridge@3"></script>
      <script>
        document.addEventListener('DOMContentLoaded', function() {
          const AppBridge = window['app-bridge'];
          const createApp = AppBridge.default;
          const Redirect = AppBridge.actions.Redirect;

          const host = "${host}";

          const app = createApp({
            apiKey: '${SHOPIFY_API_KEY}',
            host: host,
          });

          const redirect = Redirect.create(app);
          redirect.dispatch(
            Redirect.Action.REMOTE,
            '${installUrl}'
          );
        });
      </script>
    </head>
    <body>Redirecting to install...</body>
    </html>
  `);
});

// Step 2: Handle callback and save token
app.get('/auth/callback', async (req, res) => {
  const { shop, code, hmac } = req.query;

  // Verify request is from Shopify
  const params = Object.keys(req.query)
    .filter(k => k !== 'hmac')
    .sort()
    .map(k => `${k}=${req.query[k]}`)
    .join('&');

  const hash = crypto
    .createHmac('sha256', SHOPIFY_API_SECRET)
    .update(params)
    .digest('hex');

  if (hash !== hmac) return res.status(403).send('Request not verified');

  try {
    // Exchange code for access token
    const response = await axios.post(`https://${shop}/admin/oauth/access_token`, {
      client_id: SHOPIFY_API_KEY,
      client_secret: SHOPIFY_API_SECRET,
      code,
    });

    const accessToken = response.data.access_token;

    // Save to MongoDB
    await Shop.findOneAndUpdate(
      { shop },
      { shop, accessToken },
      { upsert: true, new: true }
    );

    console.log(`✅ Saved token for ${shop}`);
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
    res.redirect(`${frontendUrl}/?shop=${shop}&host=${req.query.host}`);

  } catch (err) {
    console.error(err);
    res.status(500).send('Error during installation');
  }
});

// Fetch inventory for a shop
app.get('/inventory/:shop', async (req, res) => {
  try {
    const shopDoc = await Shop.findOne({ shop: req.params.shop });
    if (!shopDoc) return res.status(404).send('Shop find error or Shop not found');

    const response = await axios.get(
      `https://${shopDoc.shop}/admin/api/2026-04/products.json`,
      { headers: { 'X-Shopify-Access-Token': shopDoc.accessToken } }
    );

    res.json(response.data);
  } catch (err) {
    console.error(err);
    res.status(500).send('Error fetching inventory');
  }
});

// Only start the server if this file is run directly
if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
}

module.exports = app;

