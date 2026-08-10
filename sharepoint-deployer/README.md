# SharePoint Deployer

דף סטטי שמותקן פעם אחת בכל SharePoint Host. הוא משתמש ב-session של המשתמש המחובר כדי ליצור Document Libraries, תיקיות וקובצי TXT, ולאחר מכן מעלה את קובצי הריליס האוניברסלי ישירות ל-`siteDB/dist` יחד עם Runtime Config שנוצר לאתר.

```bash
npm run build
```

יש להעלות את תוכן `client/dist` לנתיב שהוגדר ב-`SHAREPOINT_DEPLOYER_PATH` בכל Host.
