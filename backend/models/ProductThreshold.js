const mongoose = require('mongoose');

const productThresholdSchema = new mongoose.Schema({
  shop: { type: String, required: true },
  variantId: { type: String, required: true },
  threshold: { type: Number, required: true },
});

// Compound unique index so each variant has one threshold per shop
productThresholdSchema.index({ shop: 1, variantId: 1 }, { unique: true });

module.exports = mongoose.models.ProductThreshold || mongoose.model('ProductThreshold', productThresholdSchema);
