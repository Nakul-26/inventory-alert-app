import { useEffect, useState } from "react";
import axios from "axios";

const BACKEND_URL = "https://inventory-alert-app-two.vercel.app";

function App() {
  const [shop, setShop] = useState(null);
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    // Get shop from URL params
    const params = new URLSearchParams(window.location.search);
    const shopParam = params.get("shop");

    if (!shopParam) {
      setError("No shop found. Please install the app from your Shopify store.");
      setLoading(false);
      return;
    }

    setShop(shopParam);
    fetchProducts(shopParam);
  }, []);

  const fetchProducts = async (shopName) => {
    try {
      const res = await axios.get(`${BACKEND_URL}/inventory/${shopName}`);
      setProducts(res.data.products);
      setLoading(false);
    } catch (err) {
      setError("Failed to fetch products. Please reinstall the app.");
      setLoading(false);
    }
  };

  if (loading) return <div style={styles.center}>Loading your inventory...</div>;
  if (error) return <div style={styles.center}>{error}</div>;

  return (
    <div style={styles.container}>
      <h1 style={styles.heading}>Inventory Alerts</h1>
      <p style={styles.subtext}>Store: {shop}</p>

      <div style={styles.productList}>
        {products.map((product) => (
          <div key={product.id} style={styles.card}>
            <h3 style={styles.productName}>{product.title}</h3>
            <p style={styles.stock}>
              Variants: {product.variants.length}
            </p>
          </div>
        ))}
      </div>
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
  heading: {
    fontSize: "28px",
    fontWeight: "bold",
    marginBottom: "4px",
  },
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
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
    height: "100vh",
    fontFamily: "sans-serif",
  }
};

export default App;
