require('dotenv').config();
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const crypto = require('crypto');
const path = require('path');
const connectDB = require('../lib/db');
const Shop = require('../models/Shop');
const AlertSettings = require('../models/AlertSettings');
const { Resend } = require('resend');

const resend = new Resend(process.env.RESEND_API_KEY);

// Helper to fetch data from Shopify and handle 401s
const fetchShopifyData = async (shopDoc, url, res) => {
  try {
    const response = await axios.get(url, {
      headers: { 'X-Shopify-Access-Token': shopDoc.accessToken }
    });
    return response;
  } catch (err) {
    if (err.response?.status === 401) {
      // Token is invalid - delete it and force reinstall
      await Shop.deleteOne({ shop: shopDoc.shop });
      console.log(`🔴 Invalid token for ${shopDoc.shop} - deleted, needs reinstall`);
      
      if (res) {
        res.status(401).json({ 
          error: 'App needs to be reinstalled',
          reinstallUrl: `${HOST}/auth?shop=${shopDoc.shop}`
        });
      }
      return null;
    }
    throw err;
  }
};

// Helper to verify Shopify Webhooks
const verifyWebhook = (req) => {
  const hmac = req.headers['x-shopify-hmac-sha256'];
  // In some environments, JSON.stringify(req.body) might differ slightly from raw body.
  // For now, let's log the comparison to debug.
  const body = JSON.stringify(req.body);
  const hash = crypto
    .createHmac('sha256', SHOPIFY_API_SECRET)
    .update(body, 'utf8')
    .digest('base64');
  
  console.log('--- Webhook Verification ---');
  console.log('Received HMAC:', hmac);
  console.log('Calculated Hash:', hash);
  console.log('Body snippet:', body.substring(0, 100));
  
  return hash === hmac;
};

const app = express();
app.use(express.json());
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

// Health check endpoint
app.get('/status', (req, res) => {
  res.json({ status: 'ok', message: 'Backend is reachable' });
});

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

    // Register Webhook (Inventory Update)
    try {
      await axios.post(
        `https://${shop}/admin/api/2026-04/webhooks.json`,
        {
          webhook: {
            topic: 'inventory_levels/update',
            address: `${HOST}/webhooks/inventory-update`,
            format: 'json',
          },
        },
        { headers: { 'X-Shopify-Access-Token': accessToken } }
      );
      console.log(`📡 Registered inventory webhook for ${shop}`);
    } catch (webhookErr) {
      console.error(`❌ Failed to register webhook for ${shop}:`, webhookErr.response?.data || webhookErr.message);
    }

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
  const { shop } = req.params;
  try {
    console.log('🔍 Fetching inventory for:', shop);
    const shopDoc = await Shop.findOne({ shop });
    
    if (!shopDoc) {
      console.warn(`⚠️ Shop not found in DB: ${shop}`);
      return res.status(401).json({ 
        error: 'App needs to be reinstalled',
        reinstallUrl: `${HOST}/auth?shop=${shop}`
      });
    }

    console.log('✅ Shop found, fetching from Shopify API...');

    const response = await fetchShopifyData(
      shopDoc,
      `https://${shopDoc.shop}/admin/api/2026-04/products.json?limit=50`,
      res
    );

    if (!response) return; // 401 already handled

    const products = (response.data.products || []).map(product => ({
      id: product.id,
      title: product.title,
      variants: product.variants.map(variant => ({
        id: variant.id,
        title: variant.title,
        sku: variant.sku,
        inventory_quantity: variant.inventory_quantity,
        inventory_item_id: variant.inventory_item_id
      }))
    }));

    res.json({ products });
  } catch (err) {
    console.error(`❌ Inventory Fetch Error for ${shop}:`, err.message);
    res.status(500).json({ error: err.message });
  }
});

// Save settings for a shop
app.post('/settings/:shop', async (req, res) => {
  const { email, globalThreshold } = req.body;
  try {
    await AlertSettings.findOneAndUpdate(
      { shop: req.params.shop },
      { shop: req.params.shop, email, globalThreshold, updatedAt: new Date() },
      { upsert: true, new: true }
    );
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to save settings' });
  }
});

// Get settings for a shop
app.get('/settings/:shop', async (req, res) => {
  try {
    const settings = await AlertSettings.findOne({ shop: req.params.shop });
    res.json(settings || { email: '', globalThreshold: 10 });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch settings' });
  }
});

// Test alert route
app.get('/test-alert/:shop', async (req, res) => {
  try {
    const settings = await AlertSettings.findOne({ shop: req.params.shop });
    if (!settings || !settings.email) {
      return res.status(400).send('No alert settings found. Save your email first in the app.');
    }

    await resend.emails.send({
      from: 'onboarding@resend.dev',
      to: settings.email,
      subject: `⚠️ Test Low Stock Alert for ${req.params.shop}`,
      html: `
        <h2>Test Alert ✅</h2>
        <p>This is a test alert for <strong>${req.params.shop}</strong>.</p>
        <p>Your inventory alerts are working correctly!</p>
      `
    });

    res.send('✅ Test email sent! Check your inbox.');
  } catch (err) {
    console.error(err);
    res.status(500).send('Failed to send test email: ' + err.message);
  }
});

// Shopify Webhook for low stock
app.post('/webhooks/inventory-update', async (req, res) => {
  const shop = req.headers['x-shopify-shop-domain'];
  console.log(`📡 Incoming webhook from ${shop}`);
  
  if (!verifyWebhook(req)) {
    console.error('⚠️ Webhook verification failed');
    return res.status(401).send('Unauthorized');
  }

  const { inventory_item_id, available } = req.body;
  console.log(`📦 Item ID: ${inventory_item_id}, New Stock: ${available}`);

  try {
    const settings = await AlertSettings.findOne({ shop });
    if (!settings || !settings.email) {
      console.log('ℹ️ No settings found for this shop');
      return res.status(200).send('No settings found');
    }

    console.log(`🎯 Threshold: ${settings.globalThreshold}, Stock: ${available}`);

    if (available <= settings.globalThreshold) {
      const shopDoc = await Shop.findOne({ shop });
      if (!shopDoc) {
        console.error('❌ Shop doc missing during webhook');
        return res.status(200).send('Shop not found');
      }

      // Fetch variant details to get product name
      const productRes = await axios.get(
        `https://${shop}/admin/api/2026-04/inventory_items/${inventory_item_id}.json`,
        { headers: { 'X-Shopify-Access-Token': shopDoc.accessToken } }
      );
      
      const sku = productRes.data.inventory_item.sku;

      // Send email
      await resend.emails.send({
        from: 'onboarding@resend.dev',
        to: settings.email,
        subject: `⚠️ Low Stock Alert for ${shop}`,
        html: `
          <h2>Low Stock Warning</h2>
          <p>An item in your store <strong>${shop}</strong> is running low:</p>
          <p><strong>SKU:</strong> ${sku || 'N/A'}</p>
          <p><strong>Stock Remaining:</strong> <span style="color:red; font-weight:bold;">${available}</span></p>
          <p>Log in to your Shopify store to restock.</p>
        `
      });
      console.log(`📧 Low stock alert sent to ${settings.email} for SKU: ${sku}`);
    } else {
      console.log('✅ Stock is still above threshold');
    }

    res.status(200).send('Webhook processed');
  } catch (err) {
    console.error('Error processing webhook:', err.response?.data || err.message);
    res.status(500).send('Internal Server Error');
  }
});

// Debug: List webhooks for a shop
app.get('/debug/webhooks/:shop', async (req, res) => {
  try {
    const shopDoc = await Shop.findOne({ shop: req.params.shop });
    if (!shopDoc) return res.status(404).send('Shop not found');

    const response = await axios.get(
      `https://${shopDoc.shop}/admin/api/2026-04/webhooks.json`,
      { headers: { 'X-Shopify-Access-Token': shopDoc.accessToken } }
    );
    res.json(response.data);
  } catch (err) {
    res.status(500).json(err.response?.data || err.message);
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

