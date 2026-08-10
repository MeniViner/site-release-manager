# מעבר ל-v0.2.0 — Universal dist

הגרסה הזאת מבטלת את בניית Site Builder בתוך Release Manager.

## אם מעדכנים התקנה קיימת מ-v0.1.2

1. עצור `npm run dev`.
2. חלץ את קובץ ה-Patch מעל תיקיית `site-release-manager`.
3. הרץ:

```bash
npm run upgrade:v0.2
```

4. אין צורך להתקין תלויות חדשות.
5. הרץ:

```bash
npm run dev
```

ריליסים ישנים שנשמרו כ-Source אינם ניתנים לפריסה במודל החדש. יש להעלות מחדש את `dist` האוניברסלי שלהם.

## העלאת ריליס חדש

ב-Site Builder:

```bash
npm run build
```

לאחר מכן גרור ל-Release Manager את `dist`.

אפשר גם לגרור את תיקיית הפרויקט עצמה; Chrome יאתר את `dist` הישירה ויקרא רק אותה כאשר File System Access API זמין.
