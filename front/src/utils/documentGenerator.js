// src/utils/documentGenerator.js
// Lightweight, dependency-free export: opens a print-friendly window so users can "Save as PDF".
// Works for both Rent and NDA contract objects passed from the UI.
export class DocumentGenerator {
  static generatePDF(contractData) {
    if (!contractData) return;

    const now = new Date();
    const fmt = (d) => d ? String(d) : '—';
    const short = (addr) => (addr && addr.length > 12) ? `${addr.slice(0, 8)}...${addr.slice(-6)}` : fmt(addr);

    const isRent = !!(contractData.landlord && contractData.tenant);
    const isNDA = !!(contractData.partyA && contractData.partyB);
    const title = isRent ? 'Rental Agreement' : (isNDA ? 'NDA Agreement' : 'Contract Summary');
    const filename = `${title.replace(/\s+/g, '-')}-${short(contractData.address)}`;

    const transactions = Array.isArray(contractData.transactions) ? contractData.transactions : [];

    const legalHTML = (() => {
      if (isRent) {
        return rentLegalText(contractData);
      } else if (isNDA) {
        return ndaLegalText(contractData);
      }
      return genericLegalText(contractData);
    })();

    const html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${title} - ${short(contractData.address)}</title>
  <style>
    @media print {
      @page { size: A4; margin: 16mm; }
    }
    :root {
      --fg: #0f172a; --muted: #475569; --border: #e2e8f0; --accent: #2563eb; --bg: #ffffff;
    }
    body { font-family: system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif; color: var(--fg); background: var(--bg); }
    .wrap { max-width: 800px; margin: 0 auto; padding: 24px; }
    h1 { font-size: 24px; margin: 0 0 8px; }
    .sub { color: var(--muted); margin-bottom: 24px; }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px 16px; margin: 16px 0 24px; }
    .item { padding: 10px 12px; border: 1px solid var(--border); border-radius: 8px; }
    .label { font-size: 12px; color: var(--muted); display: block; margin-bottom: 4px; }
    .value { font-weight: 600; }
    .section { margin: 24px 0; }
    table { width: 100%; border-collapse: collapse; }
    th, td { text-align: left; padding: 8px 10px; border-bottom: 1px solid var(--border); font-size: 14px; }
    th { color: var(--muted); font-weight: 600; }
    .badge { display: inline-block; padding: 4px 10px; border-radius: 999px; font-size: 12px; font-weight: 600; }
    .badge.active { background: #dcfce7; color: #166534; }
    .badge.inactive { background: #fee2e2; color: #991b1b; }
    .footer { margin-top: 32px; color: var(--muted); font-size: 12px; }
  .rtl { direction: rtl; text-align: right; }
  </style>
  <script>
    // Ensure images/fonts loaded before print
    window.onload = () => setTimeout(() => window.print(), 200);
  </script>
  </head>
  <body>
    <div class="wrap">
      <h1>${title}</h1>
      <div class="sub">Generated ${now.toLocaleString()}</div>
      <div class="grid">
        <div class="item"><span class="label">Contract Address</span><div class="value">${fmt(contractData.address)}</div></div>
        <div class="item"><span class="label">Status</span><div class="value"><span class="badge ${contractData.isActive ? 'active' : 'inactive'}">${contractData.isActive ? 'Active' : 'Inactive'}</span></div></div>
        ${isRent ? `
          <div class="item"><span class="label">Landlord</span><div class="value">${short(contractData.landlord)}</div></div>
          <div class="item"><span class="label">Tenant</span><div class="value">${short(contractData.tenant)}</div></div>
          <div class="item"><span class="label">Rent Amount (ETH)</span><div class="value">${fmt(contractData.rentAmount || contractData.amount)}</div></div>
          <div class="item"><span class="label">Price Feed</span><div class="value">${short(contractData.priceFeed)}</div></div>
        ` : ''}
        ${isNDA ? `
          <div class="item"><span class="label">Party A</span><div class="value">${short(contractData.partyA)}</div></div>
          <div class="item"><span class="label">Party B</span><div class="value">${short(contractData.partyB)}</div></div>
          <div class="item"><span class="label">Expiry Date</span><div class="value">${fmt(contractData.expiryDate)}</div></div>
          <div class="item"><span class="label">Min Deposit (ETH)</span><div class="value">${fmt(contractData.minDeposit || contractData.amount)}</div></div>
        ` : ''}
      </div>

      <div class="section">
        <h2 style="font-size:18px;margin:0 0 8px;">Parties</h2>
        <div class="grid" style="grid-template-columns:1fr;">
          ${(contractData.parties || []).map((p, i) => `
            <div class="item"><span class="label">Party ${i + 1}</span><div class="value">${fmt(p)}</div></div>
          `).join('') || '<div class="item"><div class="value">—</div></div>'}
        </div>
      </div>

      <div class="section">
        <h2 style="font-size:18px;margin:0 0 8px;">Payment History</h2>
        ${transactions.length === 0 ? '<div class="item">No payments yet</div>' : `
          <table>
            <thead><tr><th>Date</th><th>Payer</th><th>Amount (ETH)</th><th>Tx Hash</th></tr></thead>
            <tbody>
              ${transactions.map(tx => `
                <tr>
                  <td>${fmt(tx.date)}</td>
                  <td>${short(tx.payer)}</td>
                  <td>${fmt(tx.amount)}</td>
                  <td>${tx.hash ? short(tx.hash) : '—'}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        `}
      </div>

  <div class="section rtl" dir="rtl">
        <h2 style="font-size:18px;margin:0 0 8px;">תנאים משפטיים (נוסח כללי)</h2>
        ${legalHTML}
      </div>

      <div class="footer">
        This document is a generated summary for convenience only and does not replace the on-chain contract.
      </div>
    </div>
  </body>
</html>`;

    try {
      const printWin = window.open('', '_blank', 'width=900,height=1200');
      if (!printWin) throw new Error('Popup blocked');
      printWin.document.open();
      printWin.document.write(html);
      printWin.document.close();
      // Try set the filename via title; user selects Save as PDF.
      printWin.document.title = filename;
    } catch (e) {
      // Graceful fallback: download an HTML file, users can print to PDF manually.
      const blob = new Blob([html], { type: 'text/html' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${filename}.html`;
      a.click();
      URL.revokeObjectURL(url);
    }
  }
}

function rentLegalText(data) {
  const landlord = safeAddr(data.landlord);
  const tenant = safeAddr(data.tenant);
  const amount = data.rentAmount || data.amount || '—';
  return `
  <ol style="margin:0;padding-left:18px;line-height:1.5;">
    <li><strong>הצדדים:</strong> המשכיר (${landlord}) והשוכר (${tenant}) מתקשרים בהסכם שכירות זה.</li>
    <li><strong>המושכר:</strong> פרטי המושכר, הכתובת והשימוש בו ייקבעו בין הצדדים ויצורפו כנספח להסכם.</li>
    <li><strong>דמי שכירות:</strong> דמי השכירות החודשיים יעמדו על ${amount} ETH (כפי שמחושב לפי מנגנון ההמרה במחירון on-chain). התשלום יתבצע עד לתאריך שייקבע בין הצדדים.</li>
    <li><strong>איחור בתשלום:</strong> במקרה של איחור, ייתכן חיוב בתוספת פיגורים בהתאם לאחוז הפיגור המוגדר בחוזה החכם.</li>
    <li><strong>בטחונות:</strong> ככל שנקבעו בטחונות (ערבויות/פיקדון), יפורטו בנספח וינוהלו בהתאם להוראות הדין.</li>
    <li><strong>תקופה וסיום:</strong> ההסכם יעמוד בתוקף עד לסיומו על פי ההסכמות בין הצדדים. כל צד רשאי לבטל את ההסכם בהתאם לזכויות המקבילות בחוזה החכם (on-chain) ובכפוף להוראות הדין.</li>
    <li><strong>הצהרות הצדדים:</strong> כל צד מצהיר כי הוא כשיר משפטית וכי אין מניעה להתקשר בהסכם זה.</li>
    <li><strong>שונות:</strong> הודעות יימסרו בכתב; הדין החל וסמכות השיפוט יקבעו על ידי הצדדים. במקרה של סתירה בין נוסח זה לבין פעולות החוזה החכם – יגבר המבוצע על גבי הבלוקצ׳יין.</li>
  </ol>`;
}

function ndaLegalText(data) {
  const a = safeAddr(data.partyA);
  const b = safeAddr(data.partyB);
  const exp = data.expiryDate || '—';
  return `
  <ol style="margin:0;padding-left:18px;line-height:1.5;">
    <li><strong>הצדדים:</strong> צד א׳ (${a}) וצד ב׳ (${b}) מתקשרים בהסכם סודיות זה.</li>
    <li><strong>מידע סודי:</strong> כל מידע עסקי/טכני/מסחרי שייחשף בין הצדדים במסגרת ההתקשרות, לרבות אך לא רק מסמכים, נתונים ותוצרים.</li>
    <li><strong>התחייבות לשמירה:</strong> כל צד מתחייב לשמור בסודיות את המידע, לא לעשות בו שימוש אלא למטרת ההתקשרות, ולא להעבירו לצדדים שלישיים ללא הסכמה מראש ובכתב.</li>
    <li><strong>חריגים:</strong> מידע שהפך לנחלת הכלל ללא הפרת ההסכם, מידע שהיה ברשות המקבל כדין לפני חשיפתו, או מידע שנדרש לחשוף לפי דין – לא ייחשב כהפרה.</li>
    <li><strong>תקופה:</strong> ההתחייבויות לפי הסכם זה יעמדו בתוקף עד לתום תקופת ההסכם או עד ${exp}, המוקדם מביניהם, אלא אם נקבע אחרת על גבי החוזה החכם.</li>
    <li><strong>השבה והשמדה:</strong> לבקשת הצד החושף או בתום ההסכם, ישיב הצד המקבל או ישמיד את המידע הסודי וכל העתקיו, בכפוף לנהלים ולדין.</li>
    <li><strong>תרופות:</strong> לצד החושף עומדות כל התרופות לפי דין, לרבות צווי מניעה, בגין הפרת ההתחייבויות.</li>
    <li><strong>שונות:</strong> הדין החל וסמכות השיפוט יקבעו על ידי הצדדים. בכל מקרה של סתירה, יגבר המבוצע על גבי הבלוקצ׳יין.</li>
  </ol>`;
}

function genericLegalText() {
  return `
  <ol style="margin:0;padding-left:18px;line-height:1.5;">
    <li><strong>מבוא:</strong> מסמך זה מהווה תמצית ידידותית לשימוש בלבד ואינו מחליף ייעוץ משפטי או את פעולת החוזה החכם.</li>
    <li><strong>הקדימות ל-on-chain:</strong> במקרה של אי-התאמה בין מסמך זה לבין פעולת החוזה על הרשת – המצב על הרשת הוא הקובע.</li>
    <li><strong>שונות:</strong> מומלץ לעגן תנאים מסחריים ומשפטיים מלאים בהסכם מפורט, ולצרף נספחים רלוונטיים.</li>
  </ol>`;
}

function safeAddr(addr) {
  if (!addr) return '—';
  return `${addr}`;
}