const mongoose = require('mongoose');

const alertSettingsSchema = new mongoose.Schema({
  shop: { type: String, unique: true, required: true },
  email: { type: String, required: true },
  globalThreshold: { type: Number, default: 10 },
  updatedAt: { type: Date, default: Date.now }
});

module.exports = mongoose.models.AlertSettings || mongoose.model('AlertSettings', alertSettingsSchema);
