// 後台介面統一使用繁體中文（台灣）；伺服器代碼只用於判斷。
export class AdminInputError extends Error {}
const messages = {
 MENU_DRAFT_CONFLICT: '目前有未發布的菜單草稿，快速售完未套用，也未覆蓋草稿。請先處理草稿，再更新已發布品項。',
 INVALID_TRANSITION: '訂單狀態已改變或不符合操作條件，請更新訂單後核對。',
 ORDER_CONFLICT: '此操作的防重紀錄不一致，請重新讀取訂單並核對收款紀錄。',
 INVALID_CREDENTIALS: '帳號或密碼不正確，請確認後再試。',
 INVALID_PASSWORD: '密碼需為 8–256 個字元。',
 INVALID_USER: '帳號限英文字母、數字、底線、點與連字號，最多 64 個字元。',
 USERNAME_EXISTS: '此帳號已存在，請使用其他帳號名稱。',
 USER_NOT_FOUND: '找不到此帳號，請重新載入帳號清單。',
 LAST_ADMIN: '至少必須保留一個啟用中的管理員帳號。',
 RATE_LIMITED: '操作過於頻繁，請稍後再試。',
 INVALID_CATALOG: '菜單資料不符合規則，請檢查價格、數量與商品設定。',
 PASSWORD_CHANGE_REQUIRED: '請先變更密碼，再使用後台功能。',
 FORBIDDEN: '您目前無法執行這項操作，請重新登入；若仍無法操作，請聯絡管理員。',
 INVALID_REPORT_FILTER: '查詢條件不正確，請確認日期範圍與訂單來源。',
 INVALID_REQUEST: '輸入資料不正確，請檢查後再試。',
 INVALID_IMPORT_SUMMARY: '歷史資料摘要格式不正確，請聯絡管理員確認。',
 INVALID_PAIR_CODE: '配對碼不正確或已過期，請重新產生配對碼。',
 DEVICE_NOT_FOUND: '找不到此裝置，請重新載入裝置清單。',
 BODY_TOO_LARGE: '資料量超過上限，請減少內容後再試。',
 NOT_FOUND: '找不到指定資料，請重新載入後再試。',
 INVALID_RESPONSE: '伺服器回傳的資料不完整，請稍後重新載入。',
 STORAGE_UNAVAILABLE: '目前無法儲存資料，請稍後重新載入，確認操作是否完成。',
 PICKUP_SCHEDULE_CHANGED: '預約設定已更新，請重新讀取最新設定後再編輯。',
};
export function adminErrorMessage(error) {
 if (error instanceof AdminInputError) return error.message;
 if (Object.hasOwn(messages,error?.code)) return messages[error.code];
 if (error?.status===401 || error?.code==='UNAUTHORIZED') return '登入已逾時，請重新登入。尚未儲存的菜單修改仍保留在此頁。';
 if (error?.status===409 || error?.code==='REVISION_CONFLICT') return '資料已更新或操作與目前狀態不符。您的菜單修改已保留，請核對後重新讀取。';
 if (error instanceof TypeError) return '連線或資料讀取失敗，請確認網路連線，稍後再試。';
 return '操作未完成，請稍後重新載入，確認資料是否已更新；若持續發生，請聯絡管理員。';
}
export function sourceLabel(source) {
 return ({POS:'現場 POS',LINE_LIFF:'LINE 點餐',IDOO:'IDoo／QuickClick 歷史訂單',QUICKCLICK_EAA:'IDoo／QuickClick 歷史訂單',ALL:'全部來源'})[source]??'來源待核對';
}
export function fieldValidationMessage(field) {
 const v=field.validity;
 if(v.valueMissing)return '此欄位為必填，請填寫或選擇。';
 if(v.tooShort)return `至少需輸入 ${field.minLength} 個字元。`;
 if(v.tooLong)return `最多可輸入 ${field.maxLength} 個字元。`;
 if(v.rangeUnderflow)return `請輸入大於或等於 ${field.min} 的數值。`;
 if(v.rangeOverflow)return `請輸入小於或等於 ${field.max} 的數值。`;
 if(v.patternMismatch)return field.title||'輸入格式不正確，請檢查後再試。';
 if(v.stepMismatch)return `請依 ${field.step||1} 的間隔輸入數值。`;
 if(v.badInput)return '請輸入有效的數值或日期。';
 return '輸入格式不正確，請檢查後再試。';
}
