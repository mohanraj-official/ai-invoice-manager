<div align="center">

# AI Invoice Manager

### AI-Powered Invoice Processing · Data Automation · Expense Intelligence

**Turning invoice documents into structured, searchable financial data through a secure, automated workflow.**

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

![Google Gemini](https://img.shields.io/badge/Google_Gemini-8E75B2?style=for-the-badge&logo=googlegemini&logoColor=white)
![Google Drive](https://img.shields.io/badge/Google_Drive-4285F4?style=for-the-badge&logo=googledrive&logoColor=white)
![Google Sheets](https://img.shields.io/badge/Google_Sheets-34A853?style=for-the-badge&logo=googlesheets&logoColor=white)
![Google OAuth](https://img.shields.io/badge/Google_OAuth-4285F4?style=for-the-badge&logo=google&logoColor=white)
![Render](https://img.shields.io/badge/Render-000000?style=for-the-badge&logo=render&logoColor=white)
![GitHub](https://img.shields.io/badge/GitHub-181717?style=for-the-badge&logo=github&logoColor=white)

</div>

---

## Project Overview

AI Invoice Manager is a full-stack web application designed to reduce manual invoice entry. It accepts invoice PDFs and images, extracts structured fields using Google Gemini, verifies invoice totals, detects repeat uploads, and connects records across a PostgreSQL database, Google Drive, and Google Sheets.

The current deployment is an **internal, three-user pilot**. Google sign-in and an approved-email allowlist restrict access to the application.

## Key Features

- **Batch invoice upload:** Upload up to 10 PDF, JPG, or PNG files per request, with a 10 MB limit per file and file-content type validation.
- **AI-powered extraction:** Capture invoice numbers, dates, vendors, customers, tax details, totals, payment status, and line items where present.
- **Financial validation:** Compare invoice amounts and flag missing or mismatched totals for review.
- **Duplicate detection:** Use SHA-256 content hashes to identify previously uploaded documents.
- **Document storage:** Upload invoice originals to a designated Google Drive folder.
- **Structured records:** Persist invoice metadata, extraction results, and upload events in Neon PostgreSQL.
- **Google Sheets integration:** Create or update a corresponding spreadsheet row for extracted invoices, with scheduled retries for pending or failed synchronization.
- **Dashboard:** View invoice history, total INR expenses, duplicate counts, and links to stored documents.
- **Access controls:** Google account sign-in, verified email and domain checks, server-side sessions, and admin-only Google integration authorization.

> AI extraction depends on the document's contents and quality. Missing or ambiguous values may require manual verification; financial checks are not an accounting audit.

## How It Works

```text
PDF / JPG / PNG upload
        |
        v
File validation + SHA-256 duplicate check
        |
        v
Google Drive document storage
        |
        v
Google Gemini extraction
        |
        v
Financial validation + Neon PostgreSQL
        |
        +----> Invoice history and dashboard
        |
        +----> Google Sheets sync + retry worker
```

## Technology Stack

| Layer | Tools and technologies | Purpose |
| --- | --- | --- |
| Frontend | React, TypeScript, Vite | Responsive application interface and API integration |
| Backend | Node.js, Express, TypeScript | REST API, uploads, business logic, and access control |
| Database | PostgreSQL, Neon, `pg` | Persistent invoices, extraction records, and sessions |
| AI | Google Gemini via `@google/genai`, Zod | Invoice extraction and structured data validation |
| File processing | Multer, `file-type`, Node.js Crypto | In-memory uploads, format checks, and duplicate hashing |
| Integrations | Google Drive API, Google Sheets API, Google OAuth 2.0 | Document storage, spreadsheet sync, and delegated authorization |
| Authentication | Google Identity Services, `express-session`, `connect-pg-simple` | Restricted user sign-in and session storage |
| Hosting & development | Render, GitHub, GitHub Codespaces | Deployment, source control, and development |

## Skills Demonstrated

- Full-stack application development with React, TypeScript, Node.js, and Express
- REST API design and third-party API integration
- PostgreSQL data modeling, queries, and persistence
- Generative AI integration and structured information extraction
- File validation, content hashing, and duplicate prevention
- OAuth 2.0 integration, session management, and role-based access restrictions
- Automated document workflows and Google Workspace integration
- Retry-based synchronization, cloud deployment, and debugging

## Repository Structure

```text
ai-invoice-manager/
├── backend/
│   ├── src/
│   │   ├── db/             # Database connections
│   │   ├── middleware/     # Access-control middleware
│   │   ├── routes/         # Authentication, upload, and invoice APIs
│   │   ├── services/       # AI extraction and Google integrations
│   │   ├── types/          # Shared backend types
│   │   └── validators/     # Financial validation
│   └── migrations/         # Database migration scripts
├── frontend/
│   └── src/                # React application
└── README.md
```

## Local Development

**Prerequisites:** Node.js, npm, a PostgreSQL database, and credentials for the required Google integrations.

1. Clone the repository:

   ```bash
   git clone https://github.com/mohanraj-official/ai-invoice-manager.git
   cd ai-invoice-manager
   ```

2. Install dependencies:

   ```bash
   cd backend && npm ci
   cd ../frontend && npm ci
   ```

3. Configure environment variables in `backend/.env` and `frontend/.env`. The application uses variables such as:

   | Backend | Frontend |
   | --- | --- |
   | `DATABASE_URL`, `SESSION_SECRET` | `VITE_GOOGLE_CLIENT_ID` |
   | `GEMINI_API_KEY` | |
   | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI` | |
   | `GOOGLE_DRIVE_FOLDER_ID`, `GOOGLE_SHEET_ID`, `GOOGLE_SHEET_TAB` | |
   | `GOOGLE_TOKEN_ENCRYPTION_KEY` | |
   | `ALLOWED_USER_EMAILS`, `ADMIN_USER_EMAIL`, `FRONTEND_ORIGIN` | |

   Apply the SQL migration scripts in `backend/migrations/` as appropriate for a new database. Google Cloud OAuth credentials must include the intended local origins and callback URL.

4. Start the backend and frontend in separate terminals:

   ```bash
   cd backend
   npm run dev
   ```

   ```bash
   cd frontend
   npm run dev
   ```

   The default development URLs are `http://localhost:3001` (API) and `http://localhost:5173` (web app).

5. Verify the API:

   ```bash
   curl http://localhost:3001/api/health
   ```

**Security:** Never commit `.env` files, OAuth tokens, service credentials, invoice PDFs, or database backups. The hosted app is restricted to approved accounts; access to the live dashboard is not public.

## Deployment

The application is deployed as a Node.js web service on Render, backed by Neon PostgreSQL. In production, the Express server serves the compiled React application and the protected API from the same origin. Runtime configuration and secrets are supplied through Render environment variables.

**Live application:** [AI Invoice Manager](https://ai-invoice-manager-rxj7.onrender.com) (authorized users only).

## Project Status

**Current stage:** Functional internal pilot.

Implemented flows include uploads, AI extraction, financial checks, duplicate detection, PostgreSQL persistence, Google Drive storage, Google Sheets synchronization, and protected dashboard access.

Potential future improvements include automated backup recovery testing, additional concurrency safeguards for simultaneous uploads, expanded monitoring, advanced filtering, and reporting exports.

---

<div align="center">

**Designed and developed by [Mohanraj S](https://github.com/mohanraj-official)**

[GitHub Profile](https://github.com/mohanraj-official) · [Live Application](https://ai-invoice-manager-rxj7.onrender.com)

</div>
