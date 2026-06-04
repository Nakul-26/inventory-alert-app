import { useEffect, useState } from "react";
import axios from "axios";

// Helper to remove trailing slash
const cleanUrl = (url) => url?.replace(/\/+$/, "");
const BACKEND_URL = cleanUrl(import.meta.env.VITE_BACKEND_URL) || "http://localhost:3000";

function App() {
  const [shop, setShop] = useState(null);
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [backendStatus, setBackendStatus] = useState("checking");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const shopParam = params.get("shop");
    setShop(shopParam);

    // Always check backend connection regardless of shop param
    checkBackendHealth();

    if (!shopParam) {
      setError("No shop parameter found. This app must be opened from within the Shopify Admin.");
      setLoading(false);
      return;
    }

    fetchProducts(shopParam);
  }, []);

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

  const fetchProducts = async (shopName) => {
    try {
      const res = await axios.get(`${BACKEND_URL}/inventory/${shopName}`);
      setProducts(res.data.products || []);
      setLoading(false);
    } catch (err) {
      console.error("Fetch Error:", err);
      setError("Failed to fetch products. Check if the app is correctly installed.");
      setLoading(false);
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

      {loading ? (
        <div style={styles.center}>Loading your inventory...</div>
      ) : error ? (
        <div style={styles.errorBox}>
          <p>{error}</p>
          <p style={{fontSize: '12px'}}>URL: {BACKEND_URL}/inventory/{shop}</p>
        </div>
      ) : (
        <div style={styles.productList}>
          {products.length === 0 ? (
            <p>No products found or check your Shopify permissions.</p>
          ) : (
            products.map((product) => (
              <div key={product.id} style={styles.card}>
                <h3 style={styles.productName}>{product.title}</h3>
                <p style={styles.stock}>
                  Variants: {product.variants.length}
                </p>
              </div>
            ))
          )}
        </div>
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
    color: "#666",
    marginBottom: "24px",
  },
  productList: {
    display: "flex",
    flexDirection: "column",
    gap: "12px",
  },
  card: {
    border: "1px solid #e0e0e0",
    borderRadius: "8px",
    padding: "16px",
    backgroundColor: "#fff",
  },
  productName: {
    margin: "0 0 8px 0",
    fontSize: "16px",
  },
  stock: {
    margin: 0,
    color: "#444",
    fontSize: "14px",
  },
  center: {
    textAlign: "center",
    padding: "40px",
    color: "#666",
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
