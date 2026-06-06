require('dotenv').config();
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const crypto = require('crypto');
const path = require('path');
const connectDB = require('../lib/db');
const Shop = require('../models/Shop');
const AlertSettings = require('../models/AlertSettings');
const ProductThreshold = require('../models/ProductThreshold');
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
  // Use rawBody for verification if available, otherwise fallback to stringified body
  const body = req.rawBody ? req.rawBody : JSON.stringify(req.body);
  const hash = crypto
    .createHmac('sha256', SHOPIFY_API_SECRET)
    .update(body, 'utf8')
    .digest('base64');
  
  console.log('--- Webhook Verification ---');
  console.log('Received HMAC:', hmac);
  console.log('Calculated Hash:', hash);
  
  return hash === hmac;
};

const app = express();
app.use(express.json({
  verify: (req, res, buf) => {
    req.rawBody = buf;
  }
}));
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

// Middleware to ensure DB is connected (Remove this or use once)
// app.use(async (req, res, next) => {
//   try {
//     await connectDB();
//     next();
//   } catch (err) {
//     console.error('Database connection error:', err);
//     res.status(500).send('Internal Server Error');
//   }
// });

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
      return res.status(500).send(`Internal Server Error: ${err.message}`);
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

    console.log('✅ Shop found, fetching from Shopify GraphQL API...');

    // Use GraphQL for faster, more efficient fetching
    const graphqlQuery = {
      query: `
        {
          products(first: 50) {
            nodes {
              id
              title
              variants(first: 20) {
                nodes {
                  id
                  title
                  sku
                  inventoryQuantity
                  inventoryItem {
                    id
                  }
                }
              }
            }
          }
        }
      `
    };

    const response = await axios.post(
      `https://${shopDoc.shop}/admin/api/2026-04/graphql.json`,
      graphqlQuery,
      {
        headers: {
          'X-Shopify-Access-Token': shopDoc.accessToken,
          'Content-Type': 'application/json'
        }
      }
    ).catch(async err => {
      if (err.response?.status === 401) {
        await Shop.deleteOne({ shop: shopDoc.shop });
        res.status(401).json({ 
          error: 'App needs to be reinstalled',
          reinstallUrl: `${HOST}/auth?shop=${shopDoc.shop}`
        });
        return null;
      }
      throw err;
    });

    if (!response) return;

    const products = response.data.data.products.nodes.map(product => ({
      id: product.id,
      title: product.title,
      variants: product.variants.nodes.map(variant => ({
        id: variant.id,
        title: variant.title,
        sku: variant.sku,
        inventory_quantity: variant.inventoryQuantity,
        inventory_item_id: variant.inventoryItem.id
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

// Save per-product threshold
app.post('/threshold/:shop', async (req, res) => {
  const { variantId, threshold } = req.body;
  try {
    await ProductThreshold.findOneAndUpdate(
      { shop: req.params.shop, variantId },
      { shop: req.params.shop, variantId, threshold },
      { upsert: true, new: true }
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get all thresholds for a shop
app.get('/threshold/:shop', async (req, res) => {
  try {
    const thresholds = await ProductThreshold.find({ shop: req.params.shop });
    // Return as a map: { variantId: threshold }
    const map = {};
    thresholds.forEach(t => map[t.variantId] = t.threshold);
    res.json(map);
  } catch (err) {
    res.status(500).json({ error: err.message });
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
  
  if (!verifyWebhook(req)) {
    return res.status(401).send('Unauthorized');
  }

  const { inventory_item_id, available } = req.body;

  try {
    const settings = await AlertSettings.findOne({ shop });
    if (!settings || !settings.email) return res.status(200).send('No settings found');

    const shopDoc = await Shop.findOne({ shop });
    if (!shopDoc) return res.status(200).send('Shop not found');

    // Fetch product and variant titles
    const productsRes = await axios.get(
      `https://${shop}/admin/api/2026-04/products.json?limit=250`,
      { headers: { 'X-Shopify-Access-Token': shopDoc.accessToken } }
    );

    let productTitle = 'Unknown Product';
    let variantTitle = '';
    let sku = 'N/A';
    let variantId = null;

    // Find the matching variant
    productsRes.data.products.some(p => {
      const variant = p.variants.find(v => v.inventory_item_id === inventory_item_id);
      if (variant) {
        productTitle = p.title;
        variantTitle = variant.title === 'Default Title' ? '' : ` - ${variant.title}`;
        sku = variant.sku || 'N/A';
        variantId = variant.id;
        return true;
      }
      return false;
    });

    // Get per-product threshold or fall back to global
    let threshold = settings.globalThreshold;
    if (variantId) {
      const productThreshold = await ProductThreshold.findOne({
        shop,
        variantId: String(variantId)
      });
      if (productThreshold) {
        threshold = productThreshold.threshold;
      }
    }

    if (available <= threshold) {
      // Send email
      await resend.emails.send({
        from: 'onboarding@resend.dev',
        to: settings.email,
        subject: `⚠️ Low Stock Alert for ${shop}`,
        html: `
          <h2>Low Stock Warning</h2>
          <p>The following item in your store <strong>${shop}</strong> is running low:</p>
          <div style="padding: 16px; border: 1px solid #e2e8f0; border-radius: 8px; background-color: #f7fafc;">
            <p style="margin: 0; font-size: 18px; font-weight: bold;">${productTitle}${variantTitle}</p>
            <p style="margin: 8px 0 0 0; color: #4a5568;">SKU: ${sku}</p>
            <p style="margin: 8px 0 0 0; font-size: 20px; color: #c53030; font-weight: bold;">${available} remaining (Threshold: ${threshold})</p>
          </div>
          <p style="margin-top: 24px;">Log in to your Shopify store to restock.</p>
        `
      });
      console.log(`📧 Low stock alert sent to ${settings.email} for ${productTitle} (Threshold: ${threshold})`);
    }

    res.status(200).send('Webhook processed');
  } catch (err) {
    console.error('Error processing webhook:', err.response?.data || err.message);
    res.status(500).send('Internal Server Error');
  }
});

// Only start the server if this file is run directly
if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  connectDB().then(() => {
    app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
    });
  }).catch(err => {
    console.error('Failed to connect to DB on startup:', err);
  });
}

module.exports = app;

