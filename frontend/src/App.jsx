import { useEffect, useState } from "react";
import axios from "axios";

// Helper to remove trailing slash
const cleanUrl = (url) => url?.replace(/\/+$/, "");
const BACKEND_URL = cleanUrl(import.meta.env.VITE_BACKEND_URL) || "http://localhost:3000";

function App() {
  const [shop] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get("shop");
  });
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    return !!params.get("shop");
  });
  const [error, setError] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get("shop") ? null : "No shop parameter found. This app must be opened from within the Shopify Admin.";
  });
  const [backendStatus, setBackendStatus] = useState("checking");
  
  // Settings state
  const [email, setEmail] = useState("");
  const [threshold, setThreshold] = useState(10);
  const [savingSettings, setSavingSettings] = useState(false);
  const [saved, setSaved] = useState(false);
  
  // Per-product threshold state
  const [thresholds, setThresholds] = useState({});
  const [savingThreshold, setSavingThreshold] = useState(null);

  const checkBackendHealth = async () => {
    try {
      const statusRes = await axios.get(`${BACKEND_URL}/status`);
      if (statusRes.data.status === "ok") {
        setBackendStatus("connected");
      } else {
        setBackendStatus("error");
      }
    } catch (err) {
      console.error("Health Check Error:", err);
      setBackendStatus("failed");
    }
  };

  const saveThreshold = async (variantId, value) => {
    setSavingThreshold(variantId);
    try {
      await axios.post(`${BACKEND_URL}/threshold/${shop}`, {
        variantId: String(variantId),
        threshold: Number(value)
      });
      setThresholds(prev => ({ ...prev, [variantId]: Number(value) }));
    } catch (err) {
      console.error('Failed to save threshold', err);
      alert("Failed to save product-specific threshold.");
    } finally {
      setSavingThreshold(null);
    }
  };

  const fetchInitialData = async (shopName) => {
    try {
      // Fetch products, settings, and product-specific thresholds in parallel
      const [inventoryRes, settingsRes, thresholdsRes] = await Promise.all([
        axios.get(`${BACKEND_URL}/inventory/${shopName}`),
        axios.get(`${BACKEND_URL}/settings/${shopName}`).catch(() => ({ data: {} })),
        axios.get(`${BACKEND_URL}/threshold/${shopName}`).catch(() => ({ data: {} }))
      ]);

      setProducts(inventoryRes.data.products || []);
      
      if (settingsRes.data) {
        setEmail(settingsRes.data.email || "");
        setThreshold(settingsRes.data.globalThreshold ?? 10);
      }

      setThresholds(thresholdsRes.data || {});
      
      setLoading(false);
    } catch (err) {
      console.error("Data Fetch Error:", err);
      
      if (err.response?.status === 401 && err.response.data.reinstallUrl) {
        // Redirect the top-level window to the reinstall URL
        window.top.location.href = err.response.data.reinstallUrl;
        return;
      }

      setError("Failed to fetch data. Check if the app is correctly installed.");
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!shop) return;

    // Use setTimeout to avoid synchronous state updates in effect
    const timer = setTimeout(() => {
      checkBackendHealth();
      fetchInitialData(shop);
    }, 0);
    
    return () => clearTimeout(timer);
  }, [shop]);

  const handleSaveSettings = async (e) => {
    e.preventDefault();
    setSavingSettings(true);
    try {
      await axios.post(`${BACKEND_URL}/settings/${shop}`, {
        email,
        globalThreshold: parseInt(threshold, 10)
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (err) {
      console.error("Save Settings Error:", err);
      alert("Failed to save settings.");
    } finally {
      setSavingSettings(false);
    }
  };

  return (
    <div style={styles.container}>
      <header style={styles.header}>
        <h1 style={styles.heading}>Inventory Alerts</h1>
        <div style={styles.statusBadge(backendStatus)}>
          Backend: {backendStatus.toUpperCase()}
        </div>
      </header>
      
      <p style={styles.subtext}>Store: {shop || "Detecting..."}</p>

      {shop && (
        <section style={styles.settingsSection}>
          <h2 style={styles.sectionHeading}>Alert Settings</h2>
          <form onSubmit={handleSaveSettings} style={styles.form}>
            <div style={styles.inputGroup}>
              <label style={styles.label}>Notification Email</label>
              <input 
                type="email" 
                value={email} 
                onChange={(e) => setEmail(e.target.value)}
                placeholder="email@example.com"
                style={styles.input}
                required
              />
            </div>
            <div style={styles.inputGroup}>
              <label style={styles.label}>Global Low Stock Threshold</label>
              <input 
                type="number" 
                value={threshold} 
                onChange={(e) => setThreshold(e.target.value)}
                style={styles.input}
                min="0"
                required
              />
            </div>
            <button type="submit" disabled={savingSettings} style={styles.button}>
              {savingSettings ? "Saving..." : saved ? "✅ Saved!" : "Save Settings"}
            </button>
          </form>
        </section>
      )}

      {loading ? (
        <div style={styles.center}>Loading your inventory...</div>
      ) : error ? (
        <div style={styles.errorBox}>
          <p>{error}</p>
          <p style={{fontSize: '12px'}}>URL: {BACKEND_URL}/inventory/{shop}</p>
        </div>
      ) : (
        <section>
          <h2 style={styles.sectionHeading}>Current Inventory</h2>
          <div style={styles.productList}>
            {products.length === 0 ? (
              <p>No products found or check your Shopify permissions.</p>
            ) : (
              products.map((product) => (
                <div key={product.id} style={styles.card}>
                  <h3 style={styles.productName}>{product.title}</h3>
                  {product.variants.map((variant) => {
                    const variantThreshold = thresholds[variant.id] ?? threshold;
                    const isLow = variant.inventory_quantity <= variantThreshold;
                    
                    return (
                      <div key={variant.id} style={styles.variant}>
                        <div style={styles.variantInfo}>
                          <span style={{ color: isLow ? '#c53030' : '#4a5568' }}>
                            {variant.title} {variant.sku ? `(${variant.sku})` : ""}
                          </span>
                          <span style={{
                            color: isLow ? '#c53030' : '#2f855a',
                            fontWeight: 'bold',
                            marginLeft: '8px'
                          }}>
                            {variant.inventory_quantity} in stock {isLow && "⚠️"}
                          </span>
                        </div>
                        
                        <div style={styles.thresholdContainer}>
                          <label style={styles.miniLabel}>Threshold:</label>
                          <input 
                            type="number"
                            defaultValue={thresholds[variant.id] ?? ""}
                            placeholder={threshold}
                            onBlur={(e) => {
                              if (e.target.value !== "") {
                                saveThreshold(variant.id, e.target.value);
                              }
                            }}
                            style={styles.miniInput}
                          />
                          {savingThreshold === variant.id && (
                            <span style={styles.savingText}>Saving...</span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ))
            )}
          </div>
        </section>
      )}
    </div>
  );
}

const styles = {
  container: {
    maxWidth: "800px",
    margin: "0 auto",
    padding: "32px 16px",
    fontFamily: "sans-serif",
    backgroundColor: "#f9fafb",
    minHeight: "100vh",
  },
  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: "8px",
  },
  heading: {
    fontSize: "28px",
    fontWeight: "bold",
    margin: 0,
    color: "#1a202c",
  },
  sectionHeading: {
    fontSize: "18px",
    fontWeight: "600",
    marginBottom: "16px",
    color: "#2d3748",
  },
  statusBadge: (status) => ({
    padding: "4px 8px",
    borderRadius: "4px",
    fontSize: "12px",
    fontWeight: "bold",
    backgroundColor: status === "connected" ? "#e6fffa" : "#fff5f5",
    color: status === "connected" ? "#2c7a7b" : "#c53030",
    border: `1px solid ${status === "connected" ? "#81e6d9" : "#feb2b2"}`,
  }),
  subtext: {
    color: "#718096",
    marginBottom: "24px",
  },
  settingsSection: {
    backgroundColor: "#fff",
    padding: "20px",
    borderRadius: "8px",
    border: "1px solid #e2e8f0",
    marginBottom: "32px",
  },
  form: {
    display: "flex",
    flexWrap: "wrap",
    gap: "16px",
    alignItems: "flex-end",
  },
  inputGroup: {
    display: "flex",
    flexDirection: "column",
    gap: "4px",
    flex: "1",
    minWidth: "200px",
  },
  label: {
    fontSize: "14px",
    fontWeight: "500",
    color: "#4a5568",
  },
  input: {
    padding: "8px 12px",
    borderRadius: "4px",
    border: "1px solid #cbd5e0",
    fontSize: "14px",
  },
  button: {
    padding: "10px 20px",
    backgroundColor: "#3182ce",
    color: "#fff",
    border: "none",
    borderRadius: "4px",
    fontWeight: "600",
    cursor: "pointer",
    fontSize: "14px",
    minWidth: "120px",
  },
  productList: {
    display: "flex",
    flexDirection: "column",
    gap: "12px",
  },
  card: {
    border: "1px solid #e2e8f0",
    borderRadius: "8px",
    padding: "16px",
    backgroundColor: "#fff",
  },
  productName: {
    margin: "0 0 12px 0",
    fontSize: "16px",
    fontWeight: "600",
    color: "#2d3748",
  },
  variant: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "12px 0",
    fontSize: "14px",
    borderTop: "1px solid #edf2f7",
    color: "#4a5568",
    flexWrap: "wrap",
    gap: "8px",
  },
  variantInfo: {
    display: "flex",
    alignItems: "center",
    flex: "1",
    minWidth: "200px",
  },
  thresholdContainer: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
  },
  miniLabel: {
    fontSize: "12px",
    color: "#718096",
  },
  miniInput: {
    width: "60px",
    padding: "4px 8px",
    borderRadius: "4px",
    border: "1px solid #cbd5e0",
    fontSize: "13px",
  },
  savingText: {
    fontSize: "11px",
    color: "#3182ce",
  },
  stock: {
    margin: 0,
    fontWeight: "bold",
  },
  center: {
    textAlign: "center",
    padding: "40px",
    color: "#718096",
  },
  errorBox: {
    padding: "16px",
    backgroundColor: "#fff5f5",
    border: "1px solid #feb2b2",
    borderRadius: "8px",
    color: "#c53030",
  }
};

export default App;
