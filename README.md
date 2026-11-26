<div align="center">

# AI Invoice Manager

### AI-Powered Invoice Processing · Data Automation · Expense Intelligence

[![Live Application](https://img.shields.io/badge/LIVE_APPLICATION-Open_Dashboard-2563EB?style=for-the-badge&logo=render&logoColor=white)](https://ai-invoice-manager-rxj7.onrender.com)
[![Source Code](https://img.shields.io/badge/GITHUB-Source_Code-181717?style=for-the-badge&logo=github&logoColor=white)](https://github.com/mohanraj-official/ai-invoice-manager)

<br />

**Frontend & Language**

![React](https://img.shields.io/badge/React-20232A?style=for-the-badge&logo=react&logoColor=61DAFB)
![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white)
![Vite](https://img.shields.io/badge/Vite-646CFF?style=for-the-badge&logo=vite&logoColor=white)

**Backend & Database**

![Node.js](https://img.shields.io/badge/Node.js-339933?style=for-the-badge&logo=nodedotjs&logoColor=white)
![Express](https://img.shields.io/badge/Express-000000?style=for-the-badge&logo=express&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-4169E1?style=for-the-badge&logo=postgresql&logoColor=white)
![Neon](https://img.shields.io/badge/Neon-00E599?style=for-the-badge&logo=postgresql&logoColor=111111)

**AI, Integrations & Deployment**

![OpenRouter](https://img.shields.io/badge/OpenRouter-6558A6?style=for-the-badge)
![Google Drive](https://img.shields.io/badge/Google_Drive-4285F4?style=for-the-badge&logo=googledrive&logoColor=white)
![Google Sheets](https://img.shields.io/badge/Google_Sheets-34A853?style=for-the-badge&logo=googlesheets&logoColor=white)
![Google OAuth](https://img.shields.io/badge/Google_OAuth-4285F4?style=for-the-badge&logo=google&logoColor=white)
![Render](https://img.shields.io/badge/Render-000000?style=for-the-badge&logo=render&logoColor=white)
![GitHub](https://img.shields.io/badge/GitHub-181717?style=for-the-badge&logo=github&logoColor=white)

</div>

<br>
<br>





<div align="center">

<table align="center">
  <tr>
    <th>Project Overview</th>
  </tr>
  <tr>
    <td align="center">
      AI Invoice Manager is a full-stack, AI-powered application that automates
      invoice processing, data extraction, expense tracking, and cloud storage.
    </td>
  </tr>
</table>

<br>



<br>

| Application Workflow |
|----------------------|
| Invoice or Receipt Upload → OpenRouter Extraction → Validation and Matching → PostgreSQL → Google Drive and Sheets |

<br>



<br>

<table align="center">
  <tr>
    <th>Technology Stack</th>
    <th>Technologies</th>
  </tr>
  <tr>
    <td align="center">Frontend</td>
    <td align="center">React, TypeScript, Vite</td>
  </tr>
  <tr>
    <td align="center">Backend</td>
    <td align="center">Node.js, Express.js, TypeScript</td>
  </tr>
  <tr>
    <td align="center">Database</td>
    <td align="center">PostgreSQL, Neon</td>
  </tr>
  <tr>
    <td align="center">Artificial Intelligence</td>
    <td align="center">OpenRouter</td>
  </tr>
  <tr>
    <td align="center">Cloud Integrations</td>
    <td align="center">Google Drive API, Google Sheets API</td>
  </tr>
  <tr>
    <td align="center">Authentication</td>
    <td align="center">Google OAuth 2.0, Express Session</td>
  </tr>
  <tr>
    <td align="center">Deployment</td>
    <td align="center">Render</td>
  </tr>
</table>

</div>



<br>

[AI Invoice Manager](https://ai-invoice-manager-rxj7.onrender.com) -  [Developer](https://github.com/mohanraj-official) 

## Invoice and receipt workflow

- Upload an invoice to create an unpaid record. The Drive filename and Sheets row use the same internal invoice ID.
- Upload payment proof separately, or open an invoice and use **Upload receipt**. A clear match attaches automatically. Ambiguous proofs remain available for review.
- The app stores individual verified payments, including multiple payments for the same invoice. The original invoice amount stays fixed. The balance and overpayment are calculated from those payments.
- Google Drive stores invoices and receipts in `Merchant Payment Invoices / Vendor / Invoice Year`. The same invoice month and ID appear on both filenames. Google Sheets syncs one row per invoice. A failed Drive or Sheets sync retries from PostgreSQL.

## Configure and run

Use a separate Neon database or branch, Drive folder, and Sheet tab for testing. Copy `backend/.env.example` to `backend/.env` for local development, or set the matching variables on Render. Set `VITE_GOOGLE_CLIENT_ID` in the frontend build environment. Connect Drive and Sheets from the app with the admin account and make sure it has write access to the configured folder and tab.

From `backend`, run `npm ci`, `npm run build`, `npm run migrate`, then `npm run start`. For local frontend development, run `npm ci` and `npm run dev` from `frontend`. For Render, build the frontend with the production client ID and run the backend with `NODE_ENV=production`.

OpenRouter is configured to use endpoints that support structured output, zero data retention, and restricted data collection. Choose a compatible provider with native PDF and image support.

## Reset invoice records

Pause the live app before applying a reset so uploads and retries cannot write during the operation. From the configured backend, run `npm run reset:invoices -- --plan` to check the Neon host, invoice tab, and record counts. After verifying those targets, use `npm run reset:invoices -- --apply <database-host> <sheet-id> <tab>`.

The reset clears the app's invoice, payment, and pending upload records and the invoice tab's data rows. It preserves the Drive originals, sheet header, invoice ID sequence, and login and Google authorization records.

