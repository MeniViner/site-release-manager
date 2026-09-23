const { SP_ERROR } = require("./sharepointErrors.js");

const USER_MESSAGES = Object.freeze({
  [SP_ERROR.AUTH_FAILURE]: {
    message: 'החיבור ל-SharePoint אינו תקף או שהפריסה נפתחה מאתר אחר.',
    nextAction: 'התחבר מחדש ופתח את Release Manager מתוך אתר היעד.',
  },
  [SP_ERROR.PERMISSION_DENIED]: {
    message: 'אין לך הרשאה להשלים את הפעולה באתר היעד.',
    nextAction: 'בקש הרשאות כתיבה לספריות היעד ונסה שוב.',
  },
  [SP_ERROR.PATH_COLLISION]: {
    message: 'נמצא ב-SharePoint אובייקט אחר שאינו תואם לנתיב הפריסה.',
    nextAction: 'בדוק את אבחון הריצה ותקן ידנית את התנגשות הנתיב; המערכת לא תשנה אובייקט לא קשור.',
  },
  [SP_ERROR.INVALID_PATH]: {
    message: 'אחד מנתיבי או שמות SharePoint אינו חוקי.',
    nextAction: 'תקן את הגדרת האתר או שם התיקייה ונסה שוב.',
  },
  [SP_ERROR.NON_DOCUMENT_LIBRARY]: {
    message: 'קיימת רשימה בשם שהוגדר, אך היא אינה ספריית מסמכים.',
    nextAction: 'בחר ספריית מסמכים תקינה או שם אחר.',
  },
  [SP_ERROR.MISSING]: {
    message: 'האובייקט הנדרש לא נמצא ב-SharePoint.',
    nextAction: 'בדוק את יעד הפריסה ואת אבחון הריצה.',
  },
  [SP_ERROR.TRANSIENT_NOT_READY]: {
    message: 'SharePoint עדיין לא הציג מצב עקבי עבור הפעולה.',
    nextAction: 'נסה להמשיך את הריצה לאחר זמן קצר.',
  },
  [SP_ERROR.PERMANENT_FAILURE]: {
    message: 'לא ניתן להשלים את פריסת SharePoint.',
    nextAction: 'פתח את אבחון הריצה לקבלת פרטים טכניים.',
  },
  [SP_ERROR.UNKNOWN]: {
    message: 'אירעה שגיאה לא צפויה בפריסת SharePoint.',
    nextAction: 'פתח את אבחון הריצה לקבלת פרטים טכניים.',
  },
});

const OWNERSHIP_MESSAGES = Object.freeze({
  LEASE_HELD: 'הפריסה כבר מתבצעת בלשונית אחרת.',
  LEASE_RACE: 'לשונית אחרת קיבלה בעלות על הפריסה.',
  LEASE_LOST: 'הפריסה הועברה ללשונית אחרת.',
  JOB_SETTLED: 'הריצה כבר הסתיימה.',
});

const PROVISIONING_MESSAGES = Object.freeze({
  FOLDER_RECONCILIATION_REQUIRED: {
    message: 'נמצאה תיקייה היסטורית ב-SharePoint, אך זהותה אינה שלמה ולכן אי אפשר להשתמש בה בבטחה.',
    nextAction: 'בדוק את נתיב התיקייה באבחון הריצה. השלם או תקן אותה ידנית ב-SharePoint, ואז הפעל את הריצה מחדש.',
  },
  FOLDER_IDENTITY_CONFLICT: {
    message: 'תיקייה קיימת אינה תואמת לספריית המסמכים או לנתיב שהוגדרו לפריסה.',
    nextAction: 'תקן את התנגשות התיקייה ב-SharePoint או את הגדרת האתר, ואז נסה שוב.',
  },
});

function userFacingSharePointFailure(value = {}) {
  const source = value?.failureInfo || value || {};
  const apiCode = value?.apiCode || source.apiCode || '';
  if (OWNERSHIP_MESSAGES[apiCode]) {
    return { message: OWNERSHIP_MESSAGES[apiCode], nextAction: '' };
  }
  if (value?.cancelled || value?.name === 'CancelledError') {
    return { message: 'הפריסה בוטלה.', nextAction: '' };
  }
  const provisioningCode = source.code || value?.code || '';
  if (PROVISIONING_MESSAGES[provisioningCode]) return PROVISIONING_MESSAGES[provisioningCode];
  const errorClass = source.errorClass || value?.sharePoint?.errorClass || value?.errorClass || SP_ERROR.UNKNOWN;
  const mapped = USER_MESSAGES[errorClass] || USER_MESSAGES[SP_ERROR.UNKNOWN];
  return {
    message: mapped.message,
    nextAction: source.nextAction || mapped.nextAction,
  };
}

module.exports = { userFacingSharePointFailure };
