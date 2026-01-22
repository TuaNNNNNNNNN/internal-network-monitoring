# YODY Security Map - Cloud Migration

This folder contains the optimized, cloud-ready version of the Internal Network Monitoring portal.

## 🚀 Deployment Instructions (Cloudflare Pages)

1.  **Log in** to your Cloudflare Dashboard.
2.  Go to **Workers & Pages** > **Create Application** > **Pages** > **Upload Assets**.
3.  **Drag and drop** this entire `WEBSITE CLOUD` folder (containing `index.html`) into the upload area.
4.  Click **Deploy**.
5.  **Success!** Your site is live.

## ⚡ Architecture Changes

*   **Hosting**: Static HTML/CSS/JS (Fast, Free, Secure).
*   **Data**: Fetches directly from Google Sheets via JSON Proxy (`opensheet.elk.sh`).
*   **Caching**: Static assets are cached at the Edge. Data is cached for ~30 seconds by the proxy.

## 🛠 Data Management

All data is still managed via the existing Google Sheet:
`https://docs.google.com/spreadsheets/d/1wwjXmvOrNn4G7uNdAGPwwa2RpTvfYrRASzAD5PNpbEE`

*   **Stores**: Manage in `Stores` tab.
*   **Events**: Manage in `Events` tab (Columns: ID, Store_ID, Date, Type, Description).
*   **News**: Manage in `Home` tab.
*   **Access**: Manage emails in the Email Whitelist sheet.

## ⚠️ Important Note

If you change the **structure** (column names) of the Google Sheet, the JSON API might break.
*   Keep column headers consistent (`ID`, `Store_Name`, `Store_ID`, etc.).
*   New columns are fine, but renaming core columns requires updating `js/app.js`.

**Technical Support**:
If the map fails to load, check the Console (F12) for "Fetch Error". It usually means the Google Sheet is private or the Proxy is down.
