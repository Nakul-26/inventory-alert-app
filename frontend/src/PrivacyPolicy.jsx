function PrivacyPolicy() {
  return (
    <div style={styles.container}>
      <h1 style={styles.heading}>Privacy Policy</h1>
      <p style={styles.date}>Last updated: June 2026</p>

      <section style={styles.section}>
        <h2 style={styles.subheading}>1. Introduction</h2>
        <p>StockAlert is a Shopify application developed by NB Apps. This privacy policy explains what data we collect, how we use it, and how we protect it.</p>
      </section>

      <section style={styles.section}>
        <h2 style={styles.subheading}>2. Data We Collect</h2>
        <p>When you install our app, we collect and store:</p>
        <ul>
          <li>Your Shopify store domain name</li>
          <li>A Shopify access token to read your store's product and inventory data</li>
          <li>Your notification email address and alert threshold settings</li>
        </ul>
        <p>We do not collect or store your customers' personal information.</p>
      </section>

      <section style={styles.section}>
        <h2 style={styles.subheading}>3. How We Use Your Data</h2>
        <p>We use your data solely to:</p>
        <ul>
          <li>Monitor your store's inventory levels</li>
          <li>Send you email alerts when inventory drops below your set threshold</li>
        </ul>
        <p>We do not sell, share, or use your data for any other purpose.</p>
      </section>

      <section style={styles.section}>
        <h2 style={styles.subheading}>4. Data Storage</h2>
        <p>Your store credentials and settings are stored securely in an encrypted database. We use industry-standard security practices to protect your data.</p>
      </section>

      <section style={styles.section}>
        <h2 style={styles.subheading}>5. Third Party Services</h2>
        <p>We use the following third party services:</p>
        <ul>
          <li><strong>MongoDB Atlas</strong> — for secure data storage</li>
          <li><strong>Resend</strong> — for sending alert emails</li>
        </ul>
      </section>

      <section style={styles.section}>
        <h2 style={styles.subheading}>6. Data Retention</h2>
        <p>We retain your data for as long as your app is installed. When you uninstall the app, you may contact us to request deletion of your data.</p>
      </section>

      <section style={styles.section}>
        <h2 style={styles.subheading}>7. Your Rights</h2>
        <p>You have the right to:</p>
        <ul>
          <li>Access the data we hold about your store</li>
          <li>Request deletion of your data</li>
          <li>Uninstall the app at any time</li>
        </ul>
      </section>

      <section style={styles.section}>
        <h2 style={styles.subheading}>8. Contact</h2>
        <p>For any privacy related questions, contact us at: <a href="mailto:nakul123426@gmail.com">nakul123426@gmail.com</a></p>
      </section>
    </div>
  );
}

const styles = {
  container: {
    maxWidth: '800px',
    margin: '0 auto',
    padding: '40px 16px',
    fontFamily: 'sans-serif',
    lineHeight: '1.7',
    color: '#333',
  },
  heading: {
    fontSize: '32px',
    fontWeight: 'bold',
    marginBottom: '4px',
  },
  date: {
    color: '#888',
    marginBottom: '32px',
  },
  section: {
    marginBottom: '28px',
  },
  subheading: {
    fontSize: '18px',
    fontWeight: 'bold',
    marginBottom: '8px',
  },
};

export default PrivacyPolicy;
