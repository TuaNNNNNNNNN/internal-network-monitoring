const SPREADSHEET_ID = '1wwjXmvOrNn4G7uNdAGPwwa2RpTvfYrRASzAD5PNpbEE';
const MAIL_SHEET_ID = '1Eea0RMfjsrv_JrCadKxdVWvYdsm14riZYtNcuUWOii0'; // Sheet chứa email được cấp quyền
const HISTORY_SHEET_ID = '1FPGkvvNqombNGdRbDoZHIRVtIqgsjmeYhl7bEhp5uTo'; // Trung tâm coding
const ALLOWED_DOMAIN = 'yody.vn';

const SHEET_STORES = 'Stores';
const SHEET_EVENTS = 'Events';
const SHEET_HIGHLIGHT = 'Highlight';
const SHEET_ACCESS_LOG = 'History'; // User calls it History in their snippet

const COL_EVENT_ID = 0;      
const COL_STORE_ID = 1;      
const COL_TYPE = 3;          
const COL_DESCRIPTION = 4;   

// ======== WEB APP ENTRY POINT ========
function doGet(e) {
  const userProperties = PropertiesService.getUserProperties();
  const loggedInEmail = userProperties.getProperty('loggedInEmail');
  
  const templateName = loggedInEmail ? 'Dashboard' : 'Login';
  return HtmlService.createTemplateFromFile(templateName)
    .evaluate()
    .setTitle('Thư viện Quản trị rủi ro')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

// ======== AUTHENTICATION ========
function handleLogin(email, ip) {
  try {
    const normalizedEmail = email.trim().toLowerCase();
    
    // Check if email ends with @yody.vn
    if (!normalizedEmail.endsWith("@yody.vn")) {
      return { status: "error", message: "Chỉ chấp nhận email @yody.vn" };
    }

    // Open White-list sheet
    const mailSheet = SpreadsheetApp.openById(MAIL_SHEET_ID).getSheetByName("Mail YODY");
    const mailList = mailSheet.getRange("C:C").getValues().flat().map(e => (e || "").toString().trim().toLowerCase());

    const isAuthorized = mailList.includes(normalizedEmail);
    const currentUserEmail = Session.getActiveUser().getEmail(); // GAS Active User (might be blank for external)

    // Log Access
    logAccess(normalizedEmail, currentUserEmail, ip, isAuthorized ? "Đăng nhập thành công" : "Email không có quyền truy cập");

    if (isAuthorized) {
      const userProperties = PropertiesService.getUserProperties();
      userProperties.setProperty('loggedInEmail', normalizedEmail);
      return { 
        status: "ok", 
        redirectUrl: ScriptApp.getService().getUrl() // Redirect to current app to show dashboard
      };
    } else {
      return { 
        status: "error", 
        message: "Email không có quyền truy cập. Vui lòng liên hệ Admin." 
      };
    }
  } catch (error) {
    return { status: 'error', message: 'Lỗi hệ thống: ' + error.message };
  }
}

function logAccess(email, activeUser, ip, message) {
  try {
    const ss = SpreadsheetApp.openById(HISTORY_SHEET_ID);
    let sheet = ss.getSheetByName("History") || ss.insertSheet("History");
    const now = new Date();
    sheet.appendRow([
      Utilities.formatDate(now, "Asia/Ho_Chi_Minh", "dd/MM/yyyy HH:mm:ss"),
      email,
      activeUser || 'N/A',
      ip || 'N/A',
      message
    ]);
  } catch (e) {
    Logger.log('Log error: ' + e.toString());
  }
}

// ======== DATA API ========
function getStoresData() {
  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const storesSheet = ss.getSheetByName(SHEET_STORES);
    if (!storesSheet) return { error: 'Sheet "Stores" not found' };
    
    const storesRows = storesSheet.getDataRange().getValues();
    const headers = storesRows.shift();
    
    const colIdx = {
      id: findColumn(headers, ['ID', 'id']),
      name: findColumn(headers, ['Store_Name', 'Name']),
      address: findColumn(headers, ['Address']),
      lat: findColumn(headers, ['Latitude', 'Lat']),
      lng: findColumn(headers, ['Longitude', 'Lng'])
    };

    const counts = { violations: {}, rewards: {} };
    countRecords(ss, SHEET_EVENTS, counts.violations);
    countRecords(ss, SHEET_HIGHLIGHT, counts.rewards);

    const stores = storesRows.map(row => {
      const id = row[colIdx.id];
      const v = counts.violations[id] || 0;
      const r = counts.rewards[id] || 0;
      return {
        id, name: row[colIdx.name], address: row[colIdx.address],
        lat: parseFloat(row[colIdx.lat]), lng: parseFloat(row[colIdx.lng]),
        violations: v, rewards: r,
        riskLevel: v >= 5 ? 'high' : (v >= 3 ? 'medium' : (v >= 1 ? 'low' : 'none'))
      };
    }).filter(s => !isNaN(s.lat) && !isNaN(s.lng));

    return { success: true, stores };
  } catch (e) { return { error: e.message }; }
}

function getStoreDetails(storeId) {
  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const violations = getRecordsForStore(ss, SHEET_EVENTS, storeId, true);
    const rewards = getRecordsForStore(ss, SHEET_HIGHLIGHT, storeId, false);
    
    return { success: true, violations, rewards };
  } catch (e) { return { error: e.message }; }
}

// ======== HELPERS ========
function countRecords(ss, sheetName, countObj) {
  const sheet = ss.getSheetByName(sheetName);
  if (!sheet) return;
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    const sId = data[i][COL_STORE_ID];
    if (sId) countObj[sId] = (countObj[sId] || 0) + 1;
  }
}

function getRecordsForStore(ss, sheetName, storeId, isViolation) {
  const sheet = ss.getSheetByName(sheetName);
  if (!sheet) return [];
  const data = sheet.getDataRange().getValues();
  return data.slice(1)
    .filter(row => row[COL_STORE_ID] == storeId)
    .map(row => ({
      id: row[COL_EVENT_ID],
      type: row[COL_TYPE],
      desc: sanitizeDescription(row[COL_DESCRIPTION]),
      severity: isViolation ? extractSeverity(row[COL_DESCRIPTION]) : null
    }));
}

function extractSeverity(desc) {
  if (!desc) return 2;
  const d = desc.toString().toLowerCase();
  if (d.includes('4.1.2') || d.includes('trộm cắp')) return 5;
  if (d.includes('4.1.7') || d.includes('trục lợi') || d.includes('gian lận')) return 4;
  if (d.includes('4.4.2') || d.includes('4.4.5')) return 3;
  return 2;
}

function sanitizeDescription(desc) {
  if (!desc) return 'Chưa có mô tả.';
  let clean = desc.toString().replace(/\[.*?\]/g, ''); 
  const reps = [
    { f: /vi phạm/gi, t: 'tình huống rủi ro' },
    { f: /xử phạt|kỷ luật/gi, t: 'xử lý hệ thống' },
    { f: /sai trái/gi, t: 'sai lệch quy trình' }
  ];
  reps.forEach(r => clean = clean.replace(r.f, r.t));
  return clean.trim();
}

function findColumn(headers, names) {
  for (let n of names) {
    let idx = headers.indexOf(n);
    if (idx !== -1) return idx;
  }
  return 0;
}
