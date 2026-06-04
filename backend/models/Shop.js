const mongoose = require('mongoose');

const shopSchema = new mongoose.Schema({
  shop: { type: String, unique: true, required: true },
  accessToken: { type: String, required: true },
  installedAt: { type: Date, default: Date.now }
});

module.exports = mongoose.models.Shop || mongoose.model('Shop', shopSchema);
